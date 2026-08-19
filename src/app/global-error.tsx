"use client";

import { useEffect, useState } from "react";

function detectFr(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.language?.toLowerCase().startsWith("fr");
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [fr] = useState(detectFr);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
    }
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>{fr ? "Erreur système" : "系统发生错误"}</h2>
          <p style={{ color: "#666" }}>{fr ? "Une erreur inattendue est survenue. Veuillez réessayer." : "抱歉，页面出现了意外错误，请重试或稍后再试。"}</p>
          <button onClick={reset} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #ccc", background: "#f7f5f2", cursor: "pointer" }}>
            {fr ? "Réessayer" : "重试"}
          </button>
        </div>
      </body>
    </html>
  );
}