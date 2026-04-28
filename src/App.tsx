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
  onSnapshot
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Firestore Error Handling
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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error Detailed: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
  const referralBonus = 50;

  const [notification, setNotification] = useState<string | null>(null);
  const [isNewUserReferred, setIsNewUserReferred] = useState(false);

  // Telegram helper
  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation();
    }

    let snapshotUnsubscribe: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const tgUser = tg?.initDataUnsafe?.user;
          const canonicalId = tgUser?.id?.toString() || firebaseUser.uid;
          
          await syncUser(firebaseUser.uid);

          // Real-time listener for balance and referral updates
          const userDocRef = doc(db, 'users', canonicalId);
          snapshotUnsubscribe = onSnapshot(userDocRef, (snapshot) => {
            if (snapshot.exists()) {
              const data = snapshot.data();
              
              setBalance((prev) => {
                if (data.balance > prev && data.balance - prev === referralBonus) {
                  setNotification("✨ Success! Someone joined using your link. +50 points have been added to your balance!");
                  setTimeout(() => setNotification(null), 5000);
                }
                return data.balance;
              });
              
              setReferralCount(data.referralCount);
            }
          }, (err) => {
             console.error("Snapshot error:", err);
          });

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

    return () => {
      unsubscribe();
      if (snapshotUnsubscribe) (snapshotUnsubscribe as () => void)();
    };
  }, []);

  const handleLocalModeSync = () => {
    const tgUser = tg?.initDataUnsafe?.user;
    const userId = tgUser?.id || 'guest_pilot';
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
    const tgUser = tg?.initDataUnsafe?.user;
    // CRITICAL: We prioritize the Telegram ID as the document ID for stability and referrals
    const canonicalId = tgUser?.id?.toString() || uid;
    const tgId = tgUser?.id?.toString() || 'unknown';
    const path = `users/${canonicalId}`;
    
    try {
      const userDocRef = doc(db, 'users', canonicalId);
      let userDoc;
      try {
        userDoc = await getDoc(userDocRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
        return;
      }
      
      const startParam = tg?.initDataUnsafe?.start_param; 
      const currentUsername = tgUser?.username || tgUser?.first_name || 'Pilot';
      setUsername(currentUsername);

      // Load local balance as a starting point/fallback
      const localStored = localStorage.getItem(`etb_local_data_${tgId}`);
      const localDataRaw = localStored ? JSON.parse(localStored) : { balance: 0, referralCount: 0 };
      const localData = {
        balance: Number(localDataRaw.balance) || 0,
        referralCount: Number(localDataRaw.referralCount) || 0
      };

      if (!userDoc.exists()) {
        const userData: UserData = {
          username: currentUsername,
          balance: localData.balance, 
          referralCount: localData.referralCount,
          createdAt: serverTimestamp(),
        };

        // Important: startParam is the Canonical ID of the referrer
        if (startParam && startParam !== canonicalId) {
          userData.referredBy = startParam;
          setIsNewUserReferred(true);
          await handleReferral(startParam).catch((err) => console.error("Referral Error:", err));
        }

        await setDoc(userDocRef, userData);
        setBalance(userData.balance);
        setReferralCount(userData.referralCount);
      } else {
        const cloudData = userDoc.data() as UserData;
        const finalBalance = Math.max(Number(cloudData.balance) || 0, localData.balance);
        const finalRefs = Math.max(Number(cloudData.referralCount) || 0, localData.referralCount);
        
        setBalance(finalBalance);
        setReferralCount(finalRefs);
        
        if (localData.balance > (Number(cloudData.balance) || 0)) {
           await updateDoc(userDocRef, { balance: finalBalance, updatedAt: serverTimestamp() });
        }

        if (cloudData.username !== currentUsername) {
          await updateDoc(userDocRef, { 
            username: currentUsername,
            updatedAt: serverTimestamp()
          });
        }
      }
    } catch (error) {
      console.error("Error syncing user:", error);
      handleLocalModeSync(); 
    } finally {
      setLoading(false);
    }
  };

  const handleReferral = async (referrerId: string) => {
    const path = `users/${referrerId}`;
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

    setBalance((prev) => {
      const nextBalance = prev + incrementValue;
      
      // 1. ALWAYS Save locally first
      const tgUser = tg?.initDataUnsafe?.user;
      const userId = tgUser?.id || 'guest_pilot';
      localStorage.setItem(`etb_local_data_${userId}`, JSON.stringify({ 
        balance: nextBalance, 
        referralCount 
      }));

      // 2. Try to save to Cloud in background
      const canonicalId = tgUser?.id?.toString() || auth.currentUser?.uid;
      
      if (canonicalId) {
        const userRef = doc(db, 'users', canonicalId);
        updateDoc(userRef, { 
          balance: increment(incrementValue),
          updatedAt: serverTimestamp()
        }).catch(() => {
          // Cloud failed, we still have local storage backup
        });
      }
      
      return nextBalance;
    });
    
    const newText: FloatingText = {
      id: Date.now(),
      x: e.clientX,
      y: e.clientY,
    };
    setFloatingTexts((prev) => [...prev, newText]);

    if (tg?.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('light');
    }

    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter(t => t.id !== newText.id));
    }, 1000);
  }, [referralCount]);

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
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm font-mono animate-pulse">Initializing Flight Systems...</p>
      </div>
    );
  }

  // Check if auth failed due to settings
  const isAuthRestricted = !auth.currentUser && !loading;
  if (isAuthRestricted) {
    return (
      <div className="h-screen bg-black flex flex-col items-center justify-center p-8 text-center bg-[radial-gradient(circle_at_center,_#166534_0%,_#000_100%)]">
        <div className="w-20 h-20 rounded-3xl bg-green-500/20 flex items-center justify-center border border-green-500/30 mb-6">
          <Rocket className="w-10 h-10 text-green-500 rotate-180" />
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
  const canonicalId = tgUserId?.toString() || auth.currentUser?.uid;
  const referralLink = `https://t.me/Ebbbbbisabot?startapp=${canonicalId}`;

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto relative select-none touch-none bg-black overflow-hidden font-sans">
      {/* Header */}
      <header className="p-4 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md border-b border-zinc-800 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-700 flex items-center justify-center border border-green-400/30">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Active Pilot</p>
            <p className="text-sm font-black text-white font-display tracking-tight truncate max-w-[120px]">{username}</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 bg-green-500/10 px-3 py-1.5 rounded-xl border border-green-500/20">
            <Coins className="w-4 h-4 text-green-400 fill-green-400/20" />
            <span className="text-sm font-black font-mono text-green-400 tracking-tighter">
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
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-green-600/10 blur-[120px] rounded-full" />
              <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-emerald-600/10 blur-[80px] rounded-full animate-pulse" />
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
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <p className="text-zinc-500 font-mono text-[10px] uppercase tracking-[0.3em]">Points Earned</p>
              </div>
            </motion.div>

            <div 
              ref={tapRef}
              onPointerDown={handleTap}
              className="relative w-64 h-64 cursor-pointer group active:scale-90 transition-transform duration-75 z-20"
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-green-400 via-green-600 to-emerald-900 p-1.5 coin-shadow shadow-green-500/30">
                <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-tr from-green-500/5 to-transparent" />
                  <Rocket className="w-32 h-32 text-green-400 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)] group-active:rotate-12 transition-transform" />
                </div>
              </div>
              <div className="absolute inset-x-0 inset-y-0 rounded-full border-4 border-green-500/10 animate-ping opacity-20" />
            </div>

            <a 
              href="https://t.me/etb_tap_community" 
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-16 z-10 flex items-center gap-4 bg-zinc-900/50 backdrop-blur-md border border-zinc-800 p-4 rounded-2xl hover:bg-zinc-800/80 transition-all w-full group overflow-hidden relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-green-600/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
              <div className="w-12 h-12 rounded-xl bg-green-600/20 flex items-center justify-center border border-green-500/30">
                <Users className="w-6 h-6 text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black text-white tracking-widest uppercase italic">Join Fleet</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase">Community & Roadmap</p>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-green-400 transition-colors" />
            </a>
          </div>
        ) : (
          <div className="flex flex-col p-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h2 className="text-3xl font-black text-white mb-2 font-display">Invite Friends</h2>
            <p className="text-zinc-500 text-sm mb-8">Earn <span className="text-green-400 font-bold">50 Points</span> for every friend you invite to the mission.</p>

            <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl mb-8">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Your Referrals</p>
                <span className="bg-green-600 text-white text-xs font-black px-3 py-1 rounded-full uppercase italic">Lv.1 Pilot</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black text-white font-display tracking-tight">{referralCount}</span>
                <span className="text-zinc-500 font-bold">friends invited</span>
              </div>
              <div className="mt-6 flex items-center gap-2 bg-green-500/10 p-3 rounded-xl border border-green-500/20">
                <Coins className="w-5 h-5 text-green-400" />
                <p className="text-sm font-bold text-green-400 font-mono tracking-tighter">Total Bonus: {(referralCount * 50).toLocaleString()} Points</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="relative group">
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <button 
                    onClick={copyReferralLink}
                    className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-green-400"
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
                className="w-full bg-green-600 hover:bg-green-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-green-600/20"
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
          className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${view === 'tap' ? 'text-green-500 scale-110' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <LayoutDashboard className={`w-6 h-6 ${view === 'tap' ? 'fill-green-500/10' : ''}`} />
          <span className="text-[10px] font-black uppercase tracking-tighter italic">Tap</span>
        </button>
        
        <button 
          onClick={() => setView('friends')}
          className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${view === 'friends' ? 'text-green-500 scale-110' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Users className={`w-6 h-6 ${view === 'friends' ? 'fill-green-500/10' : ''}`} />
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

      {/* Referral Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 20, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-20 inset-x-4 z-[100] bg-green-600 text-white p-4 rounded-2xl shadow-lg border border-green-400/30 flex items-center gap-3"
          >
            <div className="bg-white/20 p-2 rounded-full">
              <Users className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold leading-tight">{notification}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Welcome Message for Referred Users */}
      <AnimatePresence>
        {isNewUserReferred && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-[40px] text-center max-w-sm">
              <div className="w-20 h-20 bg-green-500/20 rounded-3xl flex items-center justify-center border border-green-500/30 mx-auto mb-6">
                <Rocket className="w-10 h-10 text-green-400" />
              </div>
              <h3 className="text-2xl font-black text-white mb-2">Welcome Pilot!</h3>
              <p className="text-zinc-400 text-sm mb-8">
                Welcome to @Ebbbbbisabot! You were successfully referred and can now start earning points.
              </p>
              <button 
                onClick={() => setIsNewUserReferred(false)}
                className="w-full bg-green-600 hover:bg-green-500 text-white font-black py-4 rounded-2xl transition-all"
              >
                START EARNING
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

