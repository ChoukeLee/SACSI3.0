import type { AuditLogRow } from "@/features/settings/audit-log-enrichment";

export function auditFixture(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: "audit-example", created_at: "2026-09-15T14:00:00Z",
    actor_id: "33333333-3333-4333-8333-333333333333", actor_email: "test-operator@example.invalid", actor_role: "admin",
    action: "supplementary_payment", entity_type: "daily_booking", entity_id: "booking-example", entity_label: "Room 503",
    before_data: { prepaid_amount_xof: 10000 }, after_data: { prepaid_amount_xof: 30000 },
    metadata: { channel: "external_codex", input_source: "natural_language", amount: 20000,
      booking_agent_id: "44444444-4444-4444-8444-444444444444", request_id: "request-example",
      payment_date: "2026-09-15", receipt_no: "TEST-RECEIPT", original_instruction: "登记测试房间收款两万西法",
      connector_version: "0.1.0", protocol_version: "1.0" },
    resolved_booking_agent_name: "振咏", ...overrides,
  };
}
