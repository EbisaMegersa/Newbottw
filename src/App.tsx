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
  withdrawn: number;
  adsWatched: number;
  referralCount: number;
  completedTasks: string[];
  referredBy?: string;
  createdAt: any;
  updatedAt: any;
}

type View = 'home' | 'tasks' | 'refer' | 'wallet' | 'profile';

export default function App() {
  const [balance, setBalance] = useState<number>(0);
  const [withdrawn, setWithdrawn] = useState<number>(0);
  const [adsWatched, setAdsWatched] = useState<number>(0);
  const [username, setUsername] = useState<string>('Pilot');
  const [referralCount, setReferralCount] = useState<number>(0);
  const [completedTasks, setCompletedTasks] = useState<string[]>([]);
  const [view, setView] = useState<View>('home');
  const [loading, setLoading] = useState(true);
  
  const [notification, setNotification] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Task & Withdrawal States
  const [isJoinWaiting, setIsJoinWaiting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [withdrawalPending, setWithdrawalPending] = useState(false);
  const [withdrawalStatus, setWithdrawalStatus] = useState<'pending' | 'approved' | null>(null);

  // Telegram helper
  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation();
      tg.backgroundColor = '#000000';
    }

    let snapshotUnsubscribe: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const tgUser = tg?.initDataUnsafe?.user;
          const canonicalId = tgUser?.id?.toString() || firebaseUser.uid;
          
          await syncUser(firebaseUser.uid);

          const userDocRef = doc(db, 'users', canonicalId);
          snapshotUnsubscribe = onSnapshot(userDocRef, (snapshot) => {
            if (snapshot.exists()) {
              const data = snapshot.data() as UserData;
              setBalance(Number(data.balance) || 0);
              setWithdrawn(Number(data.withdrawn) || 0);
              setReferralCount(Number(data.referralCount) || 0);
              setAdsWatched(Number(data.adsWatched) || 0);
              setCompletedTasks(data.completedTasks || []);
            }
          }, (err) => {
            handleFirestoreError(err, OperationType.GET, `users/${canonicalId}`);
          });
        } else {
          await signInAnonymously(auth).catch(console.error);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    });

    return () => {
      unsubscribe();
      if (snapshotUnsubscribe) (snapshotUnsubscribe as () => void)();
    };
  }, []);

  const syncUser = async (uid: string) => {
    const tgUser = tg?.initDataUnsafe?.user;
    const canonicalId = tgUser?.id?.toString() || uid;
    
    try {
      const userDocRef = doc(db, 'users', canonicalId);
      let userDoc;
      try {
        userDoc = await getDoc(userDocRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${canonicalId}`);
        return;
      }
      const currentUsername = tgUser?.username || tgUser?.first_name || 'User';
      setUsername(currentUsername);

      if (!userDoc.exists()) {
        const startParam = tg?.initDataUnsafe?.start_param; 
        const userData: UserData = {
          username: currentUsername,
          balance: 0,
          withdrawn: 0,
          adsWatched: 0,
          referralCount: 0,
          completedTasks: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        if (startParam && startParam !== canonicalId) {
          userData.referredBy = startParam;
          await handleReferral奖励(startParam);
        }

        await setDoc(userDocRef, userData);
      } else {
        const cloudData = userDoc.data() as UserData;
        const updates: any = {};
        
        if (cloudData.username !== currentUsername) updates.username = currentUsername;
        if (cloudData.withdrawn === undefined) updates.withdrawn = 0;
        if (cloudData.adsWatched === undefined) updates.adsWatched = 0;
        if (cloudData.completedTasks === undefined) updates.completedTasks = [];
        
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = serverTimestamp();
          await updateDoc(userDocRef, updates);
        }
      }
    } catch (error) {
      console.error("Sync error detailed:", error);
      handleFirestoreError(error, OperationType.WRITE, `users/${canonicalId}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReferral奖励 = async (referrerId: string) => {
    try {
      const referrerRef = doc(db, 'users', referrerId);
      await updateDoc(referrerRef, {
        balance: increment(50),
        referralCount: increment(1),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Referral award failed:", error);
      handleFirestoreError(error, OperationType.WRITE, `users/${referrerId}`);
    }
  };

  const startTask = () => {
    if (completedTasks.includes('join_channel')) return;
    
    // Open channel
    window.open('https://t.me/ebisa_emoji', '_blank');
    
    setIsJoinWaiting(true);
    setCountdown(5);
    
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const checkTask = async () => {
    if (countdown > 0) return;
    
    setLoading(true);
    const tgUser = tg?.initDataUnsafe?.user;
    const canonicalId = tgUser?.id?.toString() || auth.currentUser?.uid;
    
    if (canonicalId) {
      try {
        const userRef = doc(db, 'users', canonicalId);
        await updateDoc(userRef, {
          balance: increment(200),
          completedTasks: [...completedTasks, 'join_channel'],
          updatedAt: serverTimestamp()
        });
        setNotification("✨ Verified! +200 ETB added to balance.");
        setTimeout(() => setNotification(null), 3000);
      } catch (err) {
        console.error("Task verify error:", err);
        handleFirestoreError(err, OperationType.WRITE, `users/${canonicalId}`);
      }
    }
    setIsJoinWaiting(false);
    setLoading(false);
  };

  const handleWithdrawal = async (amount: number) => {
    if (amount < 100) {
      setNotification("Minimum withdrawal is 100 ETB");
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    if (amount > balance) {
      setNotification("Insufficient balance");
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    setWithdrawalPending(true);
    setWithdrawalStatus('pending');

    setTimeout(async () => {
      const tgUser = tg?.initDataUnsafe?.user;
      const canonicalId = tgUser?.id?.toString() || auth.currentUser?.uid;
      
      if (canonicalId) {
        try {
          const userRef = doc(db, 'users', canonicalId);
          await updateDoc(userRef, {
            balance: increment(-amount),
            withdrawn: increment(amount),
            updatedAt: serverTimestamp()
          });
          setWithdrawalStatus('approved');
          setTimeout(() => {
            setWithdrawalPending(false);
            setWithdrawalStatus(null);
          }, 3000);
        } catch (err) {
          console.error("Withdrawal error:", err);
          handleFirestoreError(err, OperationType.WRITE, `users/${canonicalId}`);
          setWithdrawalPending(false);
        }
      }
    }, 5000);
  };

  const copyRefLink = () => {
    const tgUser = tg?.initDataUnsafe?.user;
    const uid = tgUser?.id?.toString() || auth.currentUser?.uid;
    const botUser = "Ebbbbbisabot";
    const link = `https://t.me/${botUser}?startapp=${uid}`;
    
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Join me on @Ebbbbbisabot and start earning ETB! 💰")}`);
    } else {
      navigator.clipboard.writeText(link);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  if (loading && !balance) {
    return (
      <div className="h-screen bg-black flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-xs font-mono animate-pulse uppercase tracking-[0.3em]">Loading Account...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-black text-white relative overflow-hidden font-sans select-none">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="p-4 flex items-center justify-between z-10 bg-zinc-900/40 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center border border-white/10">
            <User className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Welcome</p>
            <p className="text-sm font-black truncate max-w-[100px]">{username}</p>
          </div>
        </div>
        <div className="bg-white/5 px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Live</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto pb-28 pt-6 px-4 z-10">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Dashboard */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-900/60 p-4 rounded-3xl border border-white/5 flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase">Total Balance</span>
                  <span className="text-xl font-black text-blue-400">{balance.toLocaleString()} <span className="text-[10px] text-zinc-600">ETB</span></span>
                </div>
                <div className="bg-zinc-900/60 p-4 rounded-3xl border border-white/5 flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase">Withdrawn</span>
                  <span className="text-xl font-black text-purple-400">{withdrawn.toLocaleString()} <span className="text-[10px] text-zinc-600">ETB</span></span>
                </div>
                <div className="bg-zinc-900/60 p-4 rounded-3xl border border-white/5 flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase">Ads Watched</span>
                  <span className="text-xl font-black text-zinc-300">{adsWatched}</span>
                </div>
                <div className="bg-zinc-900/60 p-4 rounded-3xl border border-white/5 flex flex-col gap-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase">Referrals</span>
                  <span className="text-xl font-black text-zinc-300">{referralCount}</span>
                </div>
              </div>

              {/* Main Card */}
              <div className="bg-gradient-to-br from-blue-600 to-purple-700 p-8 rounded-[40px] text-center shadow-2xl shadow-blue-600/20 relative overflow-hidden group">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20" />
                <div className="relative z-10">
                  <Coins className="w-16 h-16 mx-auto mb-4 text-white/90 drop-shadow-lg" />
                  <h2 className="text-4xl font-black tracking-tighter mb-1">{balance.toLocaleString()}</h2>
                  <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-blue-100/60">Available ETB</p>
                </div>
              </div>

              {/* Quick Task Highlight */}
              <div onClick={() => setView('tasks')} className="bg-white/5 border border-white/10 p-4 rounded-3xl flex items-center justify-between cursor-pointer active:scale-95 transition-transform">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                    <Rocket className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Action Needed</p>
                    <p className="text-[10px] text-zinc-500">Completing tasks earns you instant ETB</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-600" />
              </div>
            </motion.div>
          )}

          {view === 'tasks' && (
            <motion.div 
              key="tasks"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-black">Tasks</h2>
              
              <div className="bg-zinc-900 border border-white/5 p-6 rounded-[32px] space-y-6">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-3xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 text-blue-400">
                    <Share2 className="w-7 h-7" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-black">Join @ebisa_emoji</h3>
                    <p className="text-xs text-zinc-500">Official Telegram Channel</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-green-400">+200</p>
                    <p className="text-[8px] text-zinc-600 uppercase font-bold">ETB</p>
                  </div>
                </div>

                {!completedTasks.includes('join_channel') ? (
                  !isJoinWaiting ? (
                    <button 
                      onClick={startTask}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl transition-all"
                    >
                      JOIN CHANNEL
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: "100%" }}
                          animate={{ width: "0%" }}
                          transition={{ duration: 5, ease: "linear" }}
                          className="h-full bg-blue-500"
                        />
                      </div>
                      <button 
                        disabled={countdown > 0}
                        onClick={checkTask}
                        className={`w-full font-black py-4 rounded-2xl transition-all ${countdown > 0 ? 'bg-zinc-800 text-zinc-600' : 'bg-white text-black'}`}
                      >
                        {countdown > 0 ? `WAITING (${countdown}S)` : 'CHECK VERIFICATION'}
                      </button>
                    </div>
                  )
                ) : (
                  <div className="w-full bg-green-500/10 border border-green-500/20 text-green-500 font-black py-4 rounded-2xl flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-5 h-5" />
                    COMPLETED
                  </div>
                )}
              </div>
              
              <div className="p-6 rounded-[32px] border border-dashed border-zinc-800 flex flex-col items-center justify-center py-12 text-center text-zinc-600">
                <LayoutDashboard className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-xs font-bold uppercase tracking-widest">More tasks coming soon</p>
              </div>
            </motion.div>
          )}

          {view === 'refer' && (
            <motion.div 
              key="refer"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-black">Invite Friends</h2>
              
              <div className="bg-zinc-900 border border-white/5 p-8 rounded-[40px] text-center space-y-4">
                <div className="w-20 h-20 bg-purple-500/10 rounded-full flex items-center justify-center border border-purple-500/20 mx-auto text-purple-400">
                  <Users className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Earn 50 ETB Per Friend</h3>
                  <p className="text-xs text-zinc-500 px-4 mt-2">Get paid instantly when your friends join through your personal link.</p>
                </div>
                
                <div className="pt-4 space-y-3">
                  <div className="bg-black/50 p-4 rounded-2xl border border-white/5 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[200px]">t.me/Ebbbbbisabot?startapp=...</span>
                    <button onClick={copyRefLink} className="text-blue-400 font-black text-xs">
                      {isCopied ? 'COPIED' : 'COPY'}
                    </button>
                  </div>
                  <button 
                    onClick={copyRefLink}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-black py-4 rounded-2xl"
                  >
                    SHARE LINK
                  </button>
                </div>
              </div>

              <div className="bg-zinc-900 border border-white/5 p-6 rounded-[32px] flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">Total Referrals</p>
                  <p className="text-2xl font-black">{referralCount}</p>
                </div>
                <div className="w-1.5 h-10 bg-zinc-800 rounded-full" />
                <div className="text-right">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">Reward Earned</p>
                  <p className="text-2xl font-black text-green-400">{(referralCount * 50).toLocaleString()} <span className="text-xs text-zinc-600">ETB</span></p>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'wallet' && (
            <motion.div 
              key="wallet"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-black">Wallet</h2>
              
              <div className="bg-zinc-900 border border-white/5 p-8 rounded-[40px] space-y-8">
                <div className="text-center">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Withdrawable Balance</p>
                  <h3 className="text-4xl font-black text-blue-400">{balance.toLocaleString()} <span className="text-sm text-zinc-600">ETB</span></h3>
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider ml-1">Select Payment Method</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button className="flex flex-col items-center justify-center p-4 rounded-2xl bg-zinc-800/50 border border-blue-500/30 text-xs font-bold gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-[10px]">TB</div>
                      Telebirr
                    </button>
                    <button className="flex flex-col items-center justify-center p-4 rounded-2xl bg-zinc-800/50 border border-white/5 text-xs text-zinc-500 font-bold gap-2 grayscale brightness-50">
                      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-[10px]">MP</div>
                      M-Pesa
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                    <p className="text-[10px] text-zinc-600 font-bold uppercase mb-1">Enter Amount (Min 100 ETB)</p>
                    <input 
                      type="number" 
                      placeholder="0.00"
                      className="bg-transparent w-full text-xl font-black outline-none placeholder:text-zinc-800"
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        // Store amount logic if needed, here we just use the whole balance for demo or a fixed 100
                      }}
                    />
                  </div>
                  <button 
                    onClick={() => handleWithdrawal(balance >= 100 ? balance : 0)}
                    disabled={balance < 100 || withdrawalPending}
                    className="w-full bg-white text-black font-black py-4 rounded-2xl disabled:opacity-50 transition-all active:scale-95"
                  >
                    WITHDRAW NOW
                  </button>
                </div>
              </div>

              {withdrawalPending && (
                <div className="bg-blue-600 p-6 rounded-[32px] flex items-center gap-5 border border-blue-400/30 animate-pulse">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 className={`w-6 h-6 text-white ${withdrawalStatus === 'approved' ? '' : 'animate-spin'}`} />
                  </div>
                  <div>
                    <h4 className="font-black text-white">
                      {withdrawalStatus === 'pending' ? 'Status: Pending (Processing...)' : 'Status: Approved ✅'}
                    </h4>
                    <p className="text-[10px] text-blue-100/60 font-bold">
                      {withdrawalStatus === 'pending' ? 'Verification with Banking systems...' : 'Money sent to your account.'}
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col items-center py-6">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-blue-600 to-purple-800 p-1 mb-4">
                  <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
                    <User className="w-10 h-10 text-white" />
                  </div>
                </div>
                <h2 className="text-xl font-black">{username}</h2>
                <p className="text-xs text-zinc-500 font-mono">Pilot ID: #{tg?.initDataUnsafe?.user?.id || 'LOCAL'}</p>
              </div>

              <div className="bg-zinc-900 border border-white/5 rounded-[40px] divide-y divide-white/5 overflow-hidden">
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Users className="w-5 h-5 text-zinc-400" />
                    <span className="text-sm font-bold">Total Friends</span>
                  </div>
                  <span className="font-black">{referralCount}</span>
                </div>
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Coins className="w-5 h-5 text-zinc-400" />
                    <span className="text-sm font-bold">Total Balance</span>
                  </div>
                  <span className="font-black text-blue-400">{balance.toLocaleString()} ETB</span>
                </div>
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Wallet className="w-5 h-5 text-zinc-400" />
                    <span className="text-sm font-bold">Total Withdrawal</span>
                  </div>
                  <span className="font-black text-purple-400">{withdrawn.toLocaleString()} ETB</span>
                </div>
              </div>

              <button 
                className="w-full bg-zinc-900 p-5 rounded-3xl text-zinc-500 text-xs font-bold uppercase tracking-widest border border-white/5 mt-4"
              >
                Logout / Switch Account
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 p-4 pb-8 flex justify-between items-center bg-zinc-950/80 backdrop-blur-3xl border-t border-white/5 z-20 h-26">
        <NavButton active={view === 'home'} icon={<LayoutDashboard />} label="Home" onClick={() => setView('home')} />
        <NavButton active={view === 'tasks'} icon={<Rocket />} label="Tasks" onClick={() => setView('tasks')} />
        <NavButton active={view === 'refer'} icon={<Users />} label="Refer" onClick={() => setView('refer')} />
        <NavButton active={view === 'wallet'} icon={<Wallet />} label="Wallet" onClick={() => setView('wallet')} />
        <NavButton active={view === 'profile'} icon={<User />} label="Profile" onClick={() => setView('profile')} />
      </nav>

      {/* Global Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 24, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="fixed top-0 inset-x-4 z-[100] bg-blue-600 text-white p-4 rounded-2xl shadow-2xl shadow-blue-500/20 border border-blue-400/30 flex items-center gap-4"
          >
            <CheckCircle2 className="w-6 h-6" />
            <p className="text-xs font-black uppercase tracking-wider">{notification}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${active ? 'text-blue-500 scale-110' : 'text-zinc-600 hover:text-zinc-400'}`}
    >
      <div className={`${active ? 'bg-blue-500/10 p-2 rounded-xl border border-blue-500/20' : ''}`}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
      </div>
      <span className="text-[9px] font-black uppercase tracking-tighter italic">{label}</span>
      {active && <motion.div layoutId="nav-dot" className="w-1 h-1 rounded-full bg-blue-500 mt-1" />}
    </button>
  );
}

