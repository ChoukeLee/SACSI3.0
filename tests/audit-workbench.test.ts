import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
import {
  parseAuditWorkbenchQuery,
  auditWorkbenchSearchParams,
  decodeAuditWorkbench,
  decodeAuditWorkbenchExport,
} from "@/features/settings/audit-workbench-model";
import {
  initialAuditWorkbench,
  readAuditWorkbenchDetail,
  auditWorkbenchCsv,
} from "@/features/settings/audit-workbench-service";
import { GET as list } from "@/app/api/settings/audit-logs/route";
import { GET as detail } from "@/app/api/settings/audit-logs/[id]/route";
import { GET as exportCsv } from "@/app/api/settings/audit-logs/export/route";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(extra: Record<string, unknown> = {}) {
  return {
    id: id(1),
    created_at: "2026-10-19T12:00:00Z",
    actor_id: id(2),
    actor_email: "synthetic@test.invalid",
    actor_role: "admin",
    action: "record_lease_collection",
    entity_type: "lease_collection",
    entity_id: id(3),
    entity_label: null,
    before_data: null,
    after_data: null,
    metadata: { channel: "sacsi_web", request_id: id(4) },
    resolved_actor_display_name: "Synthetic",
    resolved_booking_agent_name: null,
    ...extra,
  };
}
function result(extra: Record<string, unknown> = {}) {
  const { page: _page, ...filters } = parseAuditWorkbenchQuery();
  return {
    rows: [row()],
    total: 1,
    page: 1,
    pageSize: 30,
    filters,
    summary: { total: 1, recorded: 1, missingIdentity: 0, maintenance: 0 },
    options: {
      actions: ["record_lease_collection"],
      entityTypes: ["lease_collection"],
      actors: [{ key: id(2), label: "Synthetic" }],
    },
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: id(2), role: "admin" });
  mocks.rpc.mockResolvedValue({ data: result(), error: null });
});
it("roundtrips canonical filters without adding locale-dependent labels or guessing identity", () => {
  const query = parseAuditWorkbenchQuery({
    actor: id(2),
    search: "  408/REQ%  ",
    dateFrom: "2026-01-01",
    page: "2",
  });
  expect(query.search).toBe("408/REQ%");
  expect(query.page).toBe(2);
  expect(parseAuditWorkbenchQuery(Object.fromEntries(auditWorkbenchSearchParams(query)))).toEqual(
    query,
  );
  expect(auditWorkbenchSearchParams(parseAuditWorkbenchQuery()).toString()).toBe("");
});
it.each([
  { channel: "verified" },
  { identity: "actual_human" },
  { locale: "fr" },
  { dateFrom: "2026-02-30" },
  { dateFrom: "0000-01-01" },
  { dateTo: "2026-1-01" },
  { dateFrom: "2026-10-20", dateTo: "2026-10-19" },
  { search: "x".repeat(201) },
  { search: "a\nb" },
  { action: [] },
  { actor: null },
  { page: null },
  { page: 0 },
  { page: 100001 },
  { page: "01" },
  { page: "1.1" },
  { page: "1e2" },
  { page: NaN },
])("rejects malformed query %#", (input) => {
  expect(() => parseAuditWorkbenchQuery(input)).toThrow("invalidAuditWorkbench");
});
it("initial SSR entry uses one RPC, not unrestricted raw-table pagination", async () => {
  expect(await initialAuditWorkbench()).toEqual(result());
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("audit_workbench_read_rpc", {
    p_input: parseAuditWorkbenchQuery(),
    p_mode: "list",
    p_log_id: null,
  });
});
it.each([
  { summary: { total: 1, recorded: 0, missingIdentity: 0, maintenance: 0 } },
  { total: 31 },
  { page: 2 },
  { pageSize: 100 },
  { rows: [] },
  { rows: [row({ before_data: { raw: "must not be list" } })] },
  { rows: [row({ actor_id: null, actor_email: null, resolved_actor_display_name: "Guessed" })] },
  { filters: { search: "different" } },
  { options: { actions: [{}], entityTypes: [], actors: [] } },
])("fails closed on malformed server result %#", (extra) => {
  expect(() => decodeAuditWorkbench(result(extra), parseAuditWorkbenchQuery())).toThrow();
});
it("rejects duplicate IDs and export truncation, not silently treating partial results as complete", () => {
  expect(() =>
    decodeAuditWorkbench(
      result({
        rows: [row(), row()],
        total: 2,
        summary: { total: 2, recorded: 2, missingIdentity: 0, maintenance: 0 },
      }),
      parseAuditWorkbenchQuery(),
    ),
  ).toThrow();
  expect(() =>
    decodeAuditWorkbenchExport(result({ total: 31 }), parseAuditWorkbenchQuery()),
  ).toThrow();
});
it("details match the exact requested UUID and never accept a different record", async () => {
  mocks.rpc.mockResolvedValue({ data: { log: row() }, error: null });
  expect(await readAuditWorkbenchDetail({ rpc: mocks.rpc } as never, id(1))).toEqual({
    log: row(),
  });
  expect(mocks.rpc).toHaveBeenCalledWith("audit_workbench_read_rpc", {
    p_input: parseAuditWorkbenchQuery(),
    p_mode: "detail",
    p_log_id: id(1),
  });
  await expect(readAuditWorkbenchDetail({ rpc: mocks.rpc } as never, id(9))).rejects.toThrow();
  await expect(
    readAuditWorkbenchDetail({ rpc: mocks.rpc } as never, "invalid"),
  ).rejects.toMatchObject({ status: 400 });
});
it.each([null, { role: "finance" }, { role: "front_desk" }, { role: "rental_sales" }])(
  "protects all endpoints before DB access for unauthorized caller %#",
  async (user) => {
    mocks.user.mockResolvedValue(user);
    for (const response of [
      await list(new Request("https://test.invalid/api/settings/audit-logs")),
      await detail(new Request("https://test.invalid/api/settings/audit-logs/x"), {
        params: Promise.resolve({ id: id(1) }),
      }),
      await exportCsv(new Request("https://test.invalid/api/settings/audit-logs/export")),
    ])
      expect(response.status).toBe(user ? 403 : 401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it.each(["admin", "boss"])(
  "serves management %s a private no-store page via read RPC",
  async (role) => {
    mocks.user.mockResolvedValue({ role });
    const response = await list(new Request("https://test.invalid/api/settings/audit-logs"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(result());
  },
);
it("rejects duplicate or unknown URL keys rather than changing the requested filter scope", async () => {
  for (const search of ["?action=one&action=two", "?locale=fr", "?page=0"])
    expect(
      (await list(new Request(`https://test.invalid/api/settings/audit-logs${search}`))).status,
    ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([
  ["42501", 403],
  ["22023", 400],
  ["P0002", 404],
  ["54000", 413],
  ["XX000", 503],
])("maps read error %s without exposing DB details", async (code, status) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE DATABASE DETAILS" } });
  const response = await list(new Request("https://test.invalid/api/settings/audit-logs"));
  expect(response.status).toBe(status);
  expect(await response.text()).not.toContain("PRIVATE DATABASE DETAILS");
});
it("returns export as an explicit full-filtered attachment, including count and no raw payload", async () => {
  const response = await exportCsv(
    new Request("https://test.invalid/api/settings/audit-logs/export"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/csv");
  expect(response.headers.get("x-audit-row-count")).toBe("1");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(mocks.rpc.mock.calls[0][1].p_mode).toBe("export");
});
it("prevents CSV formulas, quotes and multiline injection in every text cell and excludes instructions/secrets", () => {
  const csv = auditWorkbenchCsv([
    row({
      entity_label: '=HYPERLINK("x")\r\nnext',
      metadata: {
        request_id: "\t=1+1",
        password: "NEVER EXPORT",
        original_instruction: "NEVER EXPORT",
      },
    }),
  ]);
  expect(csv).toContain(`"'=HYPERLINK(""x"")\nnext"`);
  expect(csv).toContain(`"'\t=1+1"`);
  expect(csv).not.toContain("NEVER EXPORT");
});
it("appends recorded business amounts without reordering existing CSV fields or converting native currency", () => {
  const values = [
    row({
      action: "supplementary_payment",
      entity_type: "daily_booking",
      metadata: { amount: 30000 },
    }),
    row({
      id: id(11),
      action: "operator_booking_refund",
      entity_type: "daily_booking",
      metadata: { plan: { amountXof: 12000 } },
    }),
    row({
      id: id(12),
      metadata: { collection_result: { success: true, currency: "USD", totalAmount: 60 } },
    }),
  ];
  const lines = auditWorkbenchCsv(values).split("\r\n");
  expect(lines[0]).toMatch(/"external_receipt_no","recorded_business_amount"$/);
  expect(lines[0].split(",").slice(0, 4)).toEqual([
    '\uFEFF"id"',
    '"time_utc"',
    '"recorded_account_id"',
    '"recorded_account_email"',
  ]);
  expect(lines[1]).toMatch(/,"30,000 XOF"$/);
  expect(lines[2]).toMatch(/,"12,000 XOF"$/);
  expect(lines[3]).toMatch(/,"60 USD"$/);
  expect(lines[3]).not.toContain("XOF");
});
