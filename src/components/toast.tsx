"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const icons: Record<ToastType, typeof Check> = {
  success: Check, error: X, warning: AlertTriangle, info: Info,
};

const styles: Record<ToastType, string> = {
  success: "border-accentGreen-200 bg-accentGreen-50 text-accentGreen-800",
  error:   "border-accentRed-200 bg-accentRed-50 text-accentRed-800",
  warning: "border-accentAmber-200 bg-accentAmber-50 text-accentAmber-800",
  info:    "border-accentBlue-200 bg-accentBlue-50 text-accentBlue-800",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-toast flex flex-col-reverse gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = icons[t.type];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                className={cn(
                  "pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 shadow-lg text-sm font-medium min-w-[280px] max-w-[400px]",
                  styles[t.type],
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{t.message}</span>
                <button onClick={() => dismiss(t.id)} className="shrink-0 rounded-md p-0.5 hover:bg-black/5">
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
