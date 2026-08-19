"use client";

import { useEffect, useState } from "react";

function detectFr(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.language?.toLowerCase().startsWith("fr");
}

export default function Error({
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
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>{fr ? "Erreur de chargement" : "加载失败"}</h2>
      <p style={{ color: "#666" }}>{fr ? "Cette page ne peut pas s'afficher pour le moment. Veuillez réessayer." : "该页面暂时无法显示，请重试。"}</p>
      <button onClick={reset} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #ccc", background: "#f7f5f2", cursor: "pointer" }}>
        {fr ? "Réessayer" : "重试"}
      </button>
    </div>
  );
}