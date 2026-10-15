"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { reservePrintWindow } from "@/features/print/print-templates";
export function useContractPrinter(scope: string, locale: "zh" | "fr", initialIdentity?: unknown) {
  const windows = useRef(new Set<Window>()),
    generation = useRef(0),
    [error, setError] = useState("");
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
      for (const w of windows.current) if (!w.closed) w.close();
      windows.current.clear();
    };
  }, [scope, initialIdentity]);
  const print = useCallback(
    <T>(load: () => Promise<T>, render: (data: T, target: Window) => void) => {
      setError("");
      const w = reservePrintWindow(locale);
      if (!w) {
        setError(
          locale === "zh"
            ? "打印窗口被浏览器拦截，请允许此网站打开弹窗后重试。"
            : "La fenêtre d’impression est bloquée. Autorisez les fenêtres puis réessayez.",
        );
        return;
      }
      const current = generation.current;
      windows.current.add(w);
      void load()
        .then((data) => {
          if (current !== generation.current || w.closed) return;
          render(data, w);
        })
        .catch(() => {
          if (!w.closed) w.close();
          if (current === generation.current)
            setError(
              locale === "zh"
                ? "完整合同读取失败，打印已取消；未使用旧金额。"
                : "Lecture complète impossible. Impression annulée, sans anciens montants.",
            );
        })
        .finally(() => {
          windows.current.delete(w);
        });
    },
    [locale],
  );
  return { print, error };
}
