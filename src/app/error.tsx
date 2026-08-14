"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
    }
  }, [error]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>加载失败</h2>
      <p style={{ color: "#666" }}>该页面暂时无法显示，请重试。</p>
      <button
        onClick={reset}
        style={{
          padding: "10px 20px",
          borderRadius: 8,
          border: "1px solid #ccc",
          background: "#f7f5f2",
          cursor: "pointer",
        }}
      >
        重试
      </button>
    </div>
  );
}
