import React from "react";
import { createRoot } from "react-dom/client";
import { AuditLogViewer } from "@/features/settings/audit-log-viewer";
import { auditFixture } from "../fixtures/audit-display";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(<main style={{ padding: 24, maxWidth: 1600, margin: "0 auto" }}>
  <h1 style={{ fontSize: 24, marginBottom: 8 }}>审计日志</h1>
  <p style={{ marginBottom: 24 }}>本地验收 · 全部为虚构记录，不连接数据库</p>
  <AuditLogViewer locale="zh" logs={[
    auditFixture(),
    auditFixture({ id: "web-example", actor_id: "other-user", actor_email: "backup@example.invalid", metadata: { channel: "sacsi_web", input_source: "manual_form", amount: 15000 } }),
    auditFixture({ id: "legacy-example", actor_id: null, actor_email: null, metadata: null, before_data: null, after_data: null }),
  ]} />
</main>);
