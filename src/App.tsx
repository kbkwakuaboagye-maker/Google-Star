/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Image as ImageIcon, 
  LogOut, 
  User as UserIcon, 
  Sparkles, 
  Plus, 
  Trash2,
  Loader2,
  ChevronRight
} from 'lucide-react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot,
  getDocFromServer
} from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

interface Message {
  id?: string;
  uid: string;
  role: 'user' | 'assistant';
  content: string;
  type: 'text' | 'image';
  timestamp: any;
}

// --- Error Handler ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- App Component ---
function GoogleStar() {
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Firebase Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Ensure user document exists
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            createdAt: new Date()
          }, { merge: true });
        } catch (error) {
          console.error("Error setting user doc:", error);
        }
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- Firestore Connection Test ---
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // --- Real-time Messages ---
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const messagesRef = collection(db, 'users', user.uid, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/messages`);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // --- Auto Scroll ---
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // --- AI Logic ---
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const handleSend = async (e?: React.FormEvent, forceImageType?: boolean) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading || isGeneratingImage) return;

    const userMessage: Message = {
      uid: user.uid,
      role: 'user',
      content: input,
      type: 'text',
      timestamp: new Date()
    };

    setInput('');
    setIsLoading(true);

    try {
      // Save user message
      await addDoc(collection(db, 'users', user.uid, 'messages'), userMessage);

      const isImageRequest = forceImageType || input.toLowerCase().includes('generate image') || input.toLowerCase().includes('draw') || input.toLowerCase().includes('show me a');
      
      if (isImageRequest) {
        setIsGeneratingImage(true);
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: input }] },
        });

        let imageUrl = '';
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        if (imageUrl) {
          await addDoc(collection(db, 'users', user.uid, 'messages'), {
            uid: user.uid,
            role: 'assistant',
            content: imageUrl,
            type: 'image',
            timestamp: new Date()
          });
        } else {
          throw new Error("Failed to generate image");
        }
      } else {
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: input,
        });

        const aiText = response.text || "I'm sorry, I couldn't generate a response.";
        await addDoc(collection(db, 'users', user.uid, 'messages'), {
          uid: user.uid,
          role: 'assistant',
          content: aiText,
          type: 'text',
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error("AI Error:", error);
      // Fallback message
      await addDoc(collection(db, 'users', user.uid, 'messages'), {
        uid: user.uid,
        role: 'assistant',
        content: "I encountered an error while processing your request. Please try again.",
        type: 'text',
        timestamp: new Date()
      });
    } finally {
      setIsLoading(false);
      setIsGeneratingImage(false);
    }
  };

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Sign in error:", error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin opacity-20" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 overflow-hidden relative">
        {/* Background Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="z-10 text-center max-w-lg"
        >
          <div className="mb-8 inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl">
            <Sparkles className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-6xl font-light tracking-tighter mb-4">Google Star</h1>
          <p className="text-white/40 text-lg mb-12 font-light leading-relaxed">
            Your celestial companion for infinite knowledge and visual creation. Powered by advanced intelligence.
          </p>
          <button
            onClick={handleSignIn}
            className="group relative px-8 py-4 bg-white text-black rounded-full font-medium overflow-hidden transition-all hover:scale-105 active:scale-95"
          >
            <span className="relative z-10 flex items-center gap-2">
              Sign in with Google
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col">
      {/* Header */}
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-emerald-400" />
          <span className="text-xl font-light tracking-tight">Google Star</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/10">
            <img 
              src={user.photoURL || ''} 
              alt={user.displayName || ''} 
              className="w-6 h-6 rounded-full border border-white/20"
              referrerPolicy="no-referrer"
            />
            <span className="text-xs font-medium text-white/60">{user.displayName}</span>
          </div>
          <button 
            onClick={handleSignOut}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/40 hover:text-white"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-8 space-y-8 scroll-smooth"
      >
        <div className="max-w-3xl mx-auto space-y-12">
          {messages.length === 0 && (
            <div className="py-20 text-center space-y-4">
              <h2 className="text-4xl font-light tracking-tight text-white/20">How can I help you today?</h2>
              <p className="text-white/10 text-sm tracking-widest uppercase">Ask a question or generate an image</p>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {messages.map((msg, idx) => (
              <motion.div
                key={msg.id || idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-white/5 border border-white/10' : ''} rounded-2xl p-5`}>
                  {msg.type === 'image' ? (
                    <div className="space-y-4">
                      <img 
                        src={msg.content} 
                        alt="AI Generated" 
                        className="rounded-xl w-full h-auto border border-white/10 shadow-2xl"
                        referrerPolicy="no-referrer"
                      />
                      <p className="text-xs text-white/20 italic">Generated by Google Star</p>
                    </div>
                  ) : (
                    <div className={`prose prose-invert max-w-none text-sm leading-relaxed ${msg.role === 'user' ? 'text-white/80' : 'text-white/60'}`}>
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="flex items-center gap-3 text-white/20">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs tracking-widest uppercase">
                  {isGeneratingImage ? 'Creating visual...' : 'Thinking...'}
                </span>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* Input Area */}
      <footer className="p-6 bg-gradient-to-t from-black to-transparent">
        <div className="max-w-3xl mx-auto relative">
          <form 
            onSubmit={(e) => handleSend(e)}
            className="relative group"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message Google Star..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-6 pr-32 focus:outline-none focus:border-white/20 transition-all placeholder:text-white/20 text-sm"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSend(undefined, true)}
                title="Generate Image"
                className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-emerald-400 transition-all"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-2 rounded-xl bg-white text-black hover:bg-emerald-400 transition-all disabled:opacity-20 disabled:hover:bg-white"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>
          <p className="text-[10px] text-center mt-4 text-white/10 tracking-widest uppercase">
            Google Star may provide inaccurate info. Verify important details.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GoogleStar />
    </ErrorBoundary>
  );
}
