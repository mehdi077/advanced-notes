'use client';

import { motion } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useAppStore } from '@/app/store/useAppStore';

export default function ThemeToggle() {
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  return (
    <button
      onClick={toggleTheme}
      className="relative w-16 h-8 bg-[var(--surface-elevated)] border border-[var(--border)] rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-[var(--muted)]"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {/* Sliding circle */}
      <motion.div
        className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg"
        animate={{
          x: theme === 'light' ? 4 : 36,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 30,
        }}
      />
      
      {/* Sun icon (light mode) */}
      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
        <motion.div
          animate={{
            opacity: theme === 'light' ? 1 : 0,
            scale: theme === 'light' ? 1 : 0.5,
          }}
          transition={{ duration: 0.2 }}
        >
          <Sun 
            size={16} 
            className="text-yellow-500"
          />
        </motion.div>
      </div>
      
      {/* Moon icon (dark mode) */}
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
        <motion.div
          animate={{
            opacity: theme === 'dark' ? 1 : 0,
            scale: theme === 'dark' ? 1 : 0.5,
          }}
          transition={{ duration: 0.2 }}
        >
          <Moon 
            size={16} 
            className="text-indigo-400"
          />
        </motion.div>
      </div>
    </button>
  );
}