'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useAppStore } from '@/app/store/useAppStore';
import ThemeToggle from './ThemeToggle';

export default function SidePanel() {
  const isSidePanelOpen = useAppStore((state) => state.isSidePanelOpen);
  const setIsSidePanelOpen = useAppStore((state) => state.setIsSidePanelOpen);

  return (
    <>
      {/* Backdrop overlay - mobile only */}
      <AnimatePresence>
        {isSidePanelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setIsSidePanelOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Side Panel */}
      <AnimatePresence>
        {isSidePanelOpen && (
          <motion.div
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ 
              type: "spring", 
              stiffness: 300, 
              damping: 30 
            }}
            className="fixed top-0 left-0 h-full w-[320px] bg-[var(--surface-elevated)] border-r border-[var(--border)] shadow-xl z-50 md:hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Settings
              </h2>
              <button
                onClick={() => setIsSidePanelOpen(false)}
                className="p-2 rounded-lg hover:bg-[var(--border-light)] transition-colors"
                aria-label="Close side panel"
              >
                <X 
                  size={20} 
                  className="text-[var(--muted-foreground)]"
                />
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 p-4">
              <p className="text-[var(--muted-foreground)] text-sm">
                More settings and features coming soon...
              </p>
            </div>

            {/* Footer with Theme Toggle */}
            <div className="flex items-center justify-between p-4 border-t border-[var(--border)] bg-[var(--surface)]">
              <span className="text-sm text-[var(--muted-foreground)]">
                Theme
              </span>
              <ThemeToggle />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}