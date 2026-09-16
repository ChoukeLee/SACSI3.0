import React from "react";
import { createRoot } from "react-dom/client";
import { OperatorConfirmationPanel } from "@/features/business-actions/operator-confirmation-panel";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
import { previewRequest, previewSnapshot } from "../fixtures/operator-preview";
import "@/app/globals.css";
const fixture = buildPaymentPreview(previewRequest(),previewSnapshot());
if (!fixture.success) throw new Error("invalid synthetic fixture");
// Visual QA only. No network request or database client; never import in the app.
const scenario = new URLSearchParams(location.search).get("scenario");
window.fetch = async () => {
  if (scenario === "network") throw new Error("synthetic network failure");
  return new Response(JSON.stringify(scenario === "stale" ? { code: "confirmationSnapshotChanged" } : { status: "completed" }), { status: scenario === "stale" ? 409 : 200 });
};
createRoot(document.getElementById("root")!).render(<main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
  <p style={{ marginBottom: 16 }}>本地页面验收 · 全部为虚构记录，不连接数据库</p>
  <OperatorConfirmationPanel id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" preview={fixture.preview} actor="operator@test.invalid" expiresAt="2026-09-15T23:59:00Z" />
</main>);
