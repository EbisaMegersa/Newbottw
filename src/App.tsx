/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Coins, Wallet, Users, LayoutDashboard, Rocket, ChevronRight, User, Share2, Copy, CheckCircle2 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  serverTimestamp, 
  runTransaction 
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

declare global {
  interface Window {
    Telegram?: {
      WebApp: any;
    };
  }
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
}

interface UserData {
  username: string;
  balance: number;
  referralCount: number;
  referredBy?: string;
  createdAt: any;
}

type View = 'tap' | 'friends';

export default function App() {
  const [balance, setBalance] = useState<number>(0);
  const [username, setUsername] = useState<string>('Guest');
  const [referralCount, setReferralCount] = useState<number>(0);
  const [view, setView] = useState<View>('tap');
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const tapRef = useRef<HTMLDivElement>(null);
  const incrementValue = 1;
  const referralBonus = 100;

  // Telegram helper
  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation();
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          await syncUser(firebaseUser.uid);
        } else {
          await signInAnonymously(auth).catch((err) => {
            if (err.code === 'auth/admin-restricted-operation') {
              console.warn("Anonymous auth restricted. Falling back to Local Mode.");
              handleLocalModeSync();
            } else {
              throw err;
            }
          });
        }
      } catch (error: any) {
        console.error("Auth process error:", error);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLocalModeSync = () => {
    const tgUser = tg?.initDataUnsafe?.user;
    const userId = tgUser?.id ? `tg_${tgUser.id}` : 'guest_pilot';
    const stored = localStorage.getItem(`etb_local_data_${userId}`);
    
    if (stored) {
      const data = JSON.parse(stored);
      setBalance(data.balance || 0);
      setReferralCount(data.referralCount || 0);
    }
    setUsername(tgUser?.username || tgUser?.first_name || 'Guest Pilot');
    setLoading(false);
  };

  const syncUser = async (uid: string) => {
    try {
      const userDocRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userDocRef);
      
      const tgUser = tg?.initDataUnsafe?.user;
      const startParam = tg?.initDataUnsafe?.start_param; 
      const currentUsername = tgUser?.username || tgUser?.first_name || 'Pilot';
      setUsername(currentUsername);

      if (!userDoc.exists()) {
        const userData: UserData = {
          username: currentUsername,
          balance: 0,
          referralCount: 0,
          createdAt: serverTimestamp(),
        };

        if (startParam && startParam !== uid && startParam !== tgUser?.id?.toString()) {
          userData.referredBy = startParam;
          await handleReferral(startParam);
        }

        await setDoc(userDocRef, userData);
        setBalance(0);
        setReferralCount(0);
      } else {
        const data = userDoc.data() as UserData;
        setBalance(data.balance);
        setReferralCount(data.referralCount);
        
        if (data.username !== currentUsername) {
          await updateDoc(userDocRef, { username: currentUsername });
        }
      }
    } catch (error) {
      console.error("Error syncing user:", error);
      handleLocalModeSync(); // Fallback on firestore error
    } finally {
      setLoading(false);
    }
  };

  const handleReferral = async (referrerId: string) => {
    try {
      const referrerRef = doc(db, 'users', referrerId);
      await updateDoc(referrerRef, {
        balance: increment(referralBonus),
        referralCount: increment(1),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Referral credit failed:", error);
    }
  };

  const handleTap = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      const target = e.currentTarget as HTMLElement;
      target.style.transform = 'scale(0.95)';
      setTimeout(() => {
        target.style.transform = 'scale(1)';
      }, 100);
    }

    setBalance((prev) => prev + incrementValue);
    
    const newText: FloatingText = {
      id: Date.now(),
      x: e.clientX,
      y: e.clientY,
    };
    setFloatingTexts((prev) => [...prev, newText]);

    // Update persistence
    const uid = auth.currentUser?.uid;
    if (uid) {
      const userRef = doc(db, 'users', uid);
      updateDoc(userRef, { 
        balance: increment(incrementValue),
        updatedAt: serverTimestamp()
      }).catch(() => {
        // Silent fail for debounced/rapid taps
      });
    } else {
      // Local fallback saving
      const tgUser = tg?.initDataUnsafe?.user;
      const userId = tgUser?.id ? `tg_${tgUser.id}` : 'guest_pilot';
      const localData = { balance: balance + incrementValue, referralCount };
      localStorage.setItem(`etb_local_data_${userId}`, JSON.stringify(localData));
    }

    if (tg?.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('light');
    }

    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter(t => t.id !== newText.id));
    }, 1000);
  }, [balance, referralCount]);

  const copyReferralLink = () => {
    const tgUser = tg?.initDataUnsafe?.user;
    const userId = tgUser?.id || auth.currentUser?.uid;
    if (!userId) return;
    
    // Your actual bot username
    const botUser = "Ebbbbbisabot"; 
    const link = `https://t.me/${botUser}?startapp=${userId}`;
    
    if (tg?.openTelegramLink) {
      // In TG WebApp, we can provide a button to share directly
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Join me on ETB TAP and start earning! 🚀")}`);
    } else {
      navigator.clipboard.writeText(link);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-black flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm font-mono animate-pulse">Initializing Flight Systems...</p>
      </div>
    );
  }

  // Check if auth failed due to settings
  const isAuthRestricted = !auth.currentUser && !loading;
  if (isAuthRestricted) {
    return (
      <div className="h-screen bg-black flex flex-col items-center justify-center p-8 text-center bg-[radial-gradient(circle_at_center,_#1e1b4b_0%,_#000_100%)]">
        <div className="w-20 h-20 rounded-3xl bg-red-500/20 flex items-center justify-center border border-red-500/30 mb-6">
          <Rocket className="w-10 h-10 text-red-500 rotate-180" />
        </div>
        <h2 className="text-2xl font-black text-white mb-4 font-display">System Restriction</h2>
        <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
          The game cannot connect to the server. Please ensure <span className="text-white font-bold">Anonymous Authentication</span> is enabled in your Firebase Project settings.
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="px-8 py-3 bg-white text-black font-black rounded-xl uppercase tracking-widest text-xs"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const tgUserId = tg?.initDataUnsafe?.user?.id;
  const referralLink = `https://t.me/Ebbbbbisabot?startapp=${tgUserId || auth.currentUser?.uid}`;

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto relative select-none touch-none bg-black overflow-hidden font-sans">
      {/* Header */}
      <header className="p-4 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md border-b border-zinc-800 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-rose-700 flex items-center justify-center border border-red-400/30">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Active Pilot</p>
            <p className="text-sm font-black text-white font-display tracking-tight truncate max-w-[120px]">{username}</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 bg-red-500/10 px-3 py-1.5 rounded-xl border border-red-500/20">
            <Coins className="w-4 h-4 text-red-400 fill-red-400/20" />
            <span className="text-sm font-black font-mono text-red-400 tracking-tighter">
              {Math.floor(balance).toLocaleString()}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-24">
        {view === 'tap' ? (
          <div className="flex flex-col items-center justify-center min-h-full py-12 px-6">
            <div className="absolute inset-0 z-0 pointer-events-none">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-red-600/10 blur-[120px] rounded-full" />
              <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-rose-600/10 blur-[80px] rounded-full animate-pulse" />
            </div>

            <motion.div 
              key={Math.floor(balance)}
              initial={{ scale: 1 }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 0.1 }}
              className="z-10 mb-12 text-center"
            >
              <h2 className="text-6xl font-black font-display tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-zinc-200 to-zinc-600 drop-shadow-2xl">
                {Math.floor(balance).toLocaleString()}
              </h2>
              <div className="mt-2 flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <p className="text-zinc-500 font-mono text-[10px] uppercase tracking-[0.3em]">Tokens Collected</p>
              </div>
            </motion.div>

            <div 
              ref={tapRef}
              onPointerDown={handleTap}
              className="relative w-64 h-64 cursor-pointer group active:scale-90 transition-transform duration-75 z-20"
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-red-400 via-red-600 to-rose-900 p-1.5 coin-shadow shadow-red-500/30">
                <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-tr from-red-500/5 to-transparent" />
                  <Rocket className="w-32 h-32 text-red-400 drop-shadow-[0_0_20px_rgba(239,68,68,0.6)] group-active:rotate-12 transition-transform" />
                </div>
              </div>
              <div className="absolute inset-x-0 inset-y-0 rounded-full border-4 border-red-500/10 animate-ping opacity-20" />
            </div>

            <a 
              href="https://t.me/etb_tap_community" 
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-16 z-10 flex items-center gap-4 bg-zinc-900/50 backdrop-blur-md border border-zinc-800 p-4 rounded-2xl hover:bg-zinc-800/80 transition-all w-full group overflow-hidden relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-red-600/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
              <div className="w-12 h-12 rounded-xl bg-red-600/20 flex items-center justify-center border border-red-500/30">
                <Users className="w-6 h-6 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black text-white tracking-widest uppercase italic">Join Fleet</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase">Community & Roadmap</p>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-red-400 transition-colors" />
            </a>
          </div>
        ) : (
          <div className="flex flex-col p-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h2 className="text-3xl font-black text-white mb-2 font-display">Invite Friends</h2>
            <p className="text-zinc-500 text-sm mb-8">Earn <span className="text-red-400 font-bold">100 ETB</span> for every friend you invite to the mission.</p>

            <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl mb-8">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Your Referrals</p>
                <span className="bg-red-600 text-white text-xs font-black px-3 py-1 rounded-full uppercase italic">Lv.1 Pilot</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black text-white font-display tracking-tight">{referralCount}</span>
                <span className="text-zinc-500 font-bold">friends invited</span>
              </div>
              <div className="mt-6 flex items-center gap-2 bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                <Coins className="w-5 h-5 text-red-400" />
                <p className="text-sm font-bold text-red-400 font-mono tracking-tighter">Total Bonus: {(referralCount * 100).toLocaleString()} ETB</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="relative group">
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <button 
                    onClick={copyReferralLink}
                    className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-red-400"
                  >
                    {isCopied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl pr-14 overflow-hidden">
                  <p className="text-xs text-zinc-500 mb-1 font-bold uppercase">Referral Link</p>
                  <p className="text-sm text-zinc-300 font-mono truncate opacity-60">
                    {referralLink}
                  </p>
                </div>
              </div>

              <button 
                onClick={() => {
                  const link = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join me on ETB TAP and start earning now! 🚀")}`;
                  tg?.openTelegramLink(link);
                }}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-red-600/20"
              >
                <Share2 className="w-5 h-5" />
                INVITE A FRIEND
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 p-4 pb-8 flex justify-around items-center bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-800/50 z-50 h-24">
        <button 
          onClick={() => setView('tap')}
          className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${view === 'tap' ? 'text-red-500 scale-110' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <LayoutDashboard className={`w-6 h-6 ${view === 'tap' ? 'fill-red-500/10' : ''}`} />
          <span className="text-[10px] font-black uppercase tracking-tighter italic">Tap</span>
        </button>
        
        <button 
          onClick={() => setView('friends')}
          className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${view === 'friends' ? 'text-red-500 scale-110' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Users className={`w-6 h-6 ${view === 'friends' ? 'fill-red-500/10' : ''}`} />
          <span className="text-[10px] font-black uppercase tracking-tighter italic">Friends</span>
        </button>

        <button 
          onClick={() => alert("Withdrawal System opening in 7 days!")}
          className="flex flex-col items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-all"
        >
          <Wallet className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-tighter italic">Bank</span>
        </button>
      </nav>

      {/* Floating Indicators */}
      <AnimatePresence>
        {floatingTexts.map((text) => (
          <motion.div
            key={text.id}
            initial={{ opacity: 1, y: text.y, x: text.x }}
            animate={{ opacity: 0, y: text.y - 150 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="fixed z-[100] pointer-events-none select-none"
          >
            <span className="text-3xl font-black text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.9)] italic">
              +{incrementValue}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

