"use client";
// Lightweight inline toast — no external provider needed.
// Usage: import { toast } from "@/components/ui/toast"
// Then: toast.success("Saved"), toast.error("Failed"), toast.info("Loading...")
// Add <ToastContainer /> once in app/layout.tsx

import { createContext, useContext, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (message: string, variant: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, variant: ToastVariant) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const VARIANT_STYLES: Record<ToastVariant, string> = {
    success: "bg-green-900/90 border-green-700 text-green-200",
    error:   "bg-red-900/90 border-red-700 text-red-200",
    info:    "bg-gray-800/90 border-gray-700 text-gray-200",
    warning: "bg-amber-900/90 border-amber-700 text-amber-200",
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "px-4 py-2.5 rounded-lg border text-sm font-medium shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200",
              VARIANT_STYLES[t.variant],
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return {
    success: (msg: string) => ctx.show(msg, "success"),
    error:   (msg: string) => ctx.show(msg, "error"),
    info:    (msg: string) => ctx.show(msg, "info"),
    warning: (msg: string) => ctx.show(msg, "warning"),
  };
}
