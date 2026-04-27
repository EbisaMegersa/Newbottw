/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Coins, Wallet, Users, LayoutDashboard, Rocket, ChevronRight, User } from 'lucide-react';

interface FloatingText {
  id: number;
  x: number;
  y: number;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: any;
    };
  }
}

export default function App() {
  const [balance, setBalance] = useState<number>(0);
  const [username, setUsername] = useState<string>('Guest');
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const tapRef = useRef<HTMLDivElement>(null);

  const incrementValue = 1;
  const maxBalance = 1000;

  useEffect(() => {
    // Check for Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg && tg.initDataUnsafe?.user) {
      tg.ready();
      tg.expand();
      const user = tg.initDataUnsafe.user;
      setUsername(user.username || user.first_name || 'User');
      const stored = localStorage.getItem(`etb_balance_${user.id}`);
      if (stored) setBalance(parseFloat(stored));
    } else {
      // Fallback for non-Telegram or guest mode
      const stored = localStorage.getItem('etb_balance_guest');
      if (stored) setBalance(parseFloat(stored));
    }
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const userId = tg?.initDataUnsafe?.user?.id;
    const key = userId ? `etb_balance_${userId}` : 'etb_balance_guest';
    
    // Only save if balance > 0 to avoid overwriting on initial load error
    if (balance > 0) {
      localStorage.setItem(key, balance.toString());
    }
  }, [balance]);

  const handleTap = useCallback((e: React.PointerEvent) => {
    // Prevent default to avoid scrolling/pulsing on mobile
    if (e.pointerType === 'touch') {
      const target = e.currentTarget as HTMLElement;
      target.style.transform = 'scale(0.95)';
      setTimeout(() => {
        target.style.transform = 'scale(1)';
      }, 100);
    }

    setBalance((prev) => prev + incrementValue);
    
    // Add floating text
    const newText: FloatingText = {
      id: Date.now(),
      x: e.clientX,
      y: e.clientY,
    };
    setFloatingTexts((prev) => [...prev, newText]);

    // Haptic feedback if available (Telegram)
    if (window.Telegram?.WebApp?.HapticFeedback) {
      window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }

    // Auto-remove text after animation
    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter(t => t.id !== newText.id));
    }, 1000);
  }, []);

  const progress = Math.min((balance % maxBalance) / maxBalance * 100, 100);

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto relative select-none touch-none bg-black">
      {/* Header */}
      <header className="p-4 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center border border-blue-400/30">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-xs text-zinc-400 font-medium">Player</p>
            <p className="text-sm font-bold text-white font-display uppercase tracking-wider">{username}</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 bg-zinc-800/80 px-3 py-1 rounded-full border border-zinc-700">
            <Coins className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-bold font-mono">{balance.toLocaleString()}</span>
          </div>
        </div>
      </header>

      {/* Main Game Area */}
      <main className="flex-1 flex flex-col items-center justify-center relative px-6 py-8">
        {/* Background Glow */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-blue-500/20 blur-[100px] rounded-full" />
        </div>

        {/* Balance Display Large */}
        <motion.div 
          key={balance}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 0.1 }}
          className="z-10 mb-8 text-center"
        >
          <div className="flex items-center justify-center gap-2 mb-1">
             <Coins className="w-8 h-8 text-yellow-500 fill-yellow-500/20" />
             <h2 className="text-5xl font-black font-display tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500">
              {balance.toLocaleString()}
             </h2>
          </div>
          <p className="text-zinc-500 font-mono text-sm uppercase tracking-widest">ETB Tokens Earned</p>
        </motion.div>

        {/* Tap Container */}
        <div 
          ref={tapRef}
          onPointerDown={handleTap}
          className="relative w-64 h-64 cursor-pointer group active:scale-95 transition-transform duration-75 z-20"
        >
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400 via-indigo-600 to-blue-900 p-1 coin-shadow shadow-blue-500/20">
            <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
              <div className="absolute top-0 w-full h-1/2 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
              <Rocket className="w-32 h-32 text-blue-500 drop-shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-transform group-active:scale-110" />
            </div>
          </div>
          
          {/* Animated rings */}
          <div className="absolute inset-x-0 inset-y-0 rounded-full border-4 border-blue-500/20 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
          <div className="absolute inset-x-0 inset-y-0 rounded-full border border-blue-500/40 animate-pulse" />
        </div>

        {/* Community Link */}
        <a 
          href="https://t.me/etb_tap_community" 
          target="_blank" 
          rel="noopener noreferrer"
          className="mt-12 z-10 flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-6 py-4 rounded-2xl hover:bg-zinc-800 transition-colors w-full group"
        >
          <div className="w-10 h-10 rounded-full bg-blue-900/30 flex items-center justify-center border border-blue-500/30">
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Join Community</p>
            <p className="text-xs text-zinc-500">Earn extra rewards with friends</p>
          </div>
          <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white transition-colors" />
        </a>
      </main>

      {/* Progress Footer */}
      <div className="px-6 py-4 bg-zinc-900/30">
        <div className="flex justify-between items-end mb-2">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-tighter">Energy Level</p>
          <p className="text-xs font-mono text-blue-500">{Math.round(progress)}%</p>
        </div>
        <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-4 flex justify-around items-center bg-black border-t border-zinc-800 h-20">
        <button className="flex flex-col items-center gap-1 text-blue-500">
          <LayoutDashboard className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase">Tap</span>
        </button>
        <button 
          onClick={() => alert("Withdrawal System opening in 7 days!")}
          className="flex flex-col items-center gap-1 text-zinc-500 hover:text-white transition-colors"
        >
          <Wallet className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase">Withdraw</span>
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
            className="fixed z-50 tap-indicator pointer-events-none"
          >
            <span className="text-2xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
              +{incrementValue}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
