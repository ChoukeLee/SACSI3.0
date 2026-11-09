// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLeaseRoomOverview } from "../src/features/leases/lease-room-overview-model";
import { useContractWorkspace } from "../src/features/contracts/use-workspace";
import {
  parseWorkspaceQuery,
  type WorkspaceData,
  type WorkspaceUnit,
} from "../src/features/contracts/workspace-model";
import type { LeaseContractRow, ReceivableRow } from "../src/types/database";
import { workspaceFixture, workspaceBuilding } from "./fixtures/contract-workspace";

const uuid = (number: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`;
const fixture = workspaceFixture();
const unit = (overrides: Partial<WorkspaceUnit> = {}): WorkspaceUnit => ({
  ...fixture.units[0],
  ...overrides,
});
const lease = (overrides: Partial<LeaseContractRow> = {}): LeaseContractRow => ({
  ...(fixture.contracts[0] as LeaseContractRow),
  rent_currency: "XOF",
  paid_through_date: "2026-12-31",
  ...overrides,
});
const bill = (overrides: Partial<ReceivableRow> = {}): ReceivableRow => ({
  id: uuid(101),
  source_type: "lease_contract",
  source_id: fixture.contracts[0].id,
  building_id: workspaceBuilding,
  unit_id: fixture.units[0].id,
  customer_id: fixture.customers[0].id,
  category: "lease_rent",
  title: "SYNTHETIC",
  due_date: "2026-11-07",
  amount_xof: 100,
  paid_amount_xof: 0,
  amount_native: null,
  paid_amount_native: null,
  currency: "XOF",
  status: "pending",
  management_status: "managed",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});
const overview = (
  contracts: LeaseContractRow[],
  units = [unit()],
  receivables: ReceivableRow[] = [],
) =>
  buildLeaseRoomOverview({
    units,
    contracts,
    customers: fixture.customers,
    buildings: fixture.buildings,
    today: "2026-11-07",
    receivables,
  });

describe("independent room catalogue boundary audit", () => {
  it("retains all 1001 catalogue units including rooms without leases", () => {
    const rows = overview(
      [],
      Array.from({ length: 1001 }, (_, index) =>
        unit({
          id: uuid(index + 1),
          unit_no: `${index + 1}`,
          status: "available",
          occupancy_verified: false,
        }),
      ),
    );
    expect(rows).toHaveLength(1001);
    expect(rows.every((row) => row.occupancy === "unknown" && row.contract === null)).toBe(true);
  });
  it("requires verified availability rather than treating a missing contract as vacancy", () => {
    expect(
      overview([], [unit({ status: "available", occupancy_verified: false })])[0].occupancy,
    ).toBe("unknown");
    expect(
      overview([], [unit({ status: "available", occupancy_verified: true })])[0].occupancy,
    ).toBe("available");
    expect(overview([], [unit({ status: "leased", occupancy_verified: true })])[0].occupancy).toBe(
      "unknown",
    );
  });
  it("keeps sold managed rooms and manual lease facts without paper documents", () => {
    const row = overview(
      [lease({ contract_no: "", attachment_url: null, monthly_rent_xof: 850000 })],
      [unit({ status: "sold" })],
    )[0];
    expect(row.occupancy).toBe("leased");
    expect(row.customer?.id).toBe(fixture.customers[0].id);
    expect(row.contract?.monthly_rent_xof).toBe(850000);
    expect(row.paidThrough).toBe("2026-12-31");
    expect(row.unit.status).toBe("sold");
  });
  it("keeps one asset card and does not pick a tenant or combine balances for conflicting leases", () => {
    const rows = overview(
      [lease(), lease({ id: uuid(3), customer_id: uuid(4) })],
      [unit(), unit()],
      [bill()],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      occupancy: "conflict",
      contract: null,
      customer: null,
      paidThrough: null,
      attention: null,
    });
    expect(rows[0].records).toHaveLength(2);
  });
  it("distinguishes future rentals and historical records from current occupation", () => {
    expect(overview([lease({ start_date: "2026-12-01" })])[0].occupancy).toBe("scheduled");
    expect(overview([lease({ status: "draft" })])[0].occupancy).toBe("scheduled");
    const past = overview([lease({ status: "terminated", actual_end_date: "2026-10-31" })])[0];
    expect(past).toMatchObject({
      contract: null,
      customer: null,
      occupancy: "unknown",
      attention: null,
    });
    expect(past.records).toHaveLength(1);
  });
  it("preserves the registered tenant beyond the expected end without declaring vacancy", () => {
    const row = overview([lease({ expected_end_date: "2026-10-31", actual_end_date: null })])[0];
    expect(row.occupancy).toBe("leased");
    expect(row.paidThrough).toBe("2026-12-31");
    expect(row.reviewReasons).toContain("registered_period_needs_review");
  });
  it.each([
    ["2026-11-06", "overdue", -1],
    ["2026-11-07", "upcoming", 0],
    ["2026-11-22", "upcoming", 15],
    ["2026-11-23", null, null],
  ])(
    "honors the inclusive 15-day window and makes due day payable, not overdue (%s)",
    (due, kind, days) => {
      const attention = overview([lease()], undefined, [bill({ due_date: due })])[0].attention;
      expect(attention?.kind ?? null).toBe(kind);
      if (kind) expect(attention?.days).toBe(days);
    },
  );
  it("keeps partial overdue native rent in USD and never substitutes its zero XOF slot", () => {
    const row = overview(
      [lease({ rent_currency: "USD", monthly_rent_amount: 3200, monthly_rent_xof: 0 })],
      undefined,
      [
        bill({
          due_date: "2026-11-06",
          currency: "USD",
          amount_xof: 0,
          paid_amount_xof: 0,
          amount_native: 3200,
          paid_amount_native: 1000,
          status: "partial",
        }),
      ],
    )[0];
    expect(row.attention).toMatchObject({ kind: "overdue", amount: 2200, currency: "USD" });
  });
  it("keeps unverified historical bills pending and does not infer overdue rent from stale paid-through", () => {
    const row = overview([lease({ paid_through_date: "2026-08-31" })], undefined, [
      bill({ due_date: "2026-09-01", management_status: "historical_pending" }),
    ])[0];
    expect(row.attention).toMatchObject({ kind: "coverage", amount: null });
  });
});

describe("independent full-room context lifecycle audit", () => {
  let root: Root, host: HTMLDivElement, api: ReturnType<typeof useContractWorkspace>;
  const pending: { url: URL; finish: (response: Response) => void }[] = [];
  function Probe({ initial }: { initial: WorkspaceData }) {
    api = useContractWorkspace(initial);
    return createElement(
      "output",
      null,
      api.roomContextError ? "error" : (api.contextData?.units.length ?? "no-context"),
    );
  }
  const flush = () =>
    act(async () => {
      await vi.runAllTimersAsync();
    });
  function finish(index: number, overrides: Partial<WorkspaceData> = {}) {
    const request = pending[index],
      raw = Object.fromEntries(request.url.searchParams);
    const mode = raw.mode as WorkspaceData["mode"];
    delete raw.mode;
    const roomOverview = raw.roomOverview === "1";
    delete raw.roomOverview;
    const query = parseWorkspaceQuery(raw);
    request.finish(
      Response.json(
        workspaceFixture(
          { ...(roomOverview ? { roomReceivables: [] } : {}), ...overrides },
          query,
          mode,
        ),
      ),
    );
  }
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    pending.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolve) => {
            pending.push({ url: new URL(url, "http://local.invalid"), finish: resolve });
          }),
      ),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(Probe, {
          initial: workspaceFixture(
            {},
            parseWorkspaceQuery({
              projectId: fixture.query.projectId,
              status: "active",
              search: "guest",
              page: 2,
            }),
          ),
        }),
      ),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("shares a concurrent full-context request and removes list search/status/page restrictions", async () => {
    let first: Promise<WorkspaceData>, second: Promise<WorkspaceData>;
    await act(async () => {
      first = api.ensureRoomContext();
      second = api.ensureRoomContext();
    });
    expect(pending).toHaveLength(1);
    expect(Object.fromEntries(pending[0].url.searchParams)).toMatchObject({
      mode: "context",
      status: "all",
      search: "",
      page: "1",
    });
    const all = Array.from({ length: 1001 }, (_, index) =>
      unit({ id: uuid(index + 1), unit_no: `${index + 1}` }),
    );
    all[0].id = fixture.units[0].id;
    await act(async () => {
      finish(0, { units: all });
      await Promise.all([first!, second!]);
    });
    expect(api.contextData?.units).toHaveLength(1001);
  });
  it("rejects an old building response after scope changes and refreshes the entire room context", async () => {
    let old: Promise<unknown>;
    await act(async () => {
      old = api.ensureRoomContext().catch(() => undefined);
    });
    await act(async () => api.change({ buildingId: workspaceBuilding, page: 1 }));
    await flush();
    const current = pending.findIndex(
      (request) =>
        request.url.searchParams.get("mode") === "context" &&
        request.url.searchParams.get("buildingId") === workspaceBuilding,
    );
    expect(current).toBeGreaterThan(0);
    await act(async () => {
      finish(current);
      finish(1);
    });
    expect(api.contextData?.query.buildingId).toBe(workspaceBuilding);
    await act(async () => {
      finish(0, { units: [unit({ unit_no: "OLD" })] });
      await old!;
    });
    expect(api.contextData?.units[0].unit_no).not.toBe("OLD");
    let refresh: Promise<unknown>;
    const start = pending.length;
    await act(async () => {
      refresh = api.refresh();
    });
    expect(api.contextData).toBeUndefined();
    expect(pending.slice(start).map((request) => request.url.searchParams.get("mode"))).toContain(
      "context",
    );
    await act(async () => {
      for (let index = start; index < pending.length; index++) finish(index);
      await refresh!;
    });
    expect(api.contextData?.query.buildingId).toBe(workspaceBuilding);
  });
  it("exposes a context failure without falling back to the initial page and retries only reads", async () => {
    let read: Promise<unknown>;
    await act(async () => {
      read = api.ensureRoomContext().catch(() => undefined);
    });
    await act(async () => {
      pending[0].finish(new Response("", { status: 503 }));
      await read!;
    });
    expect(api.roomContextError).toBe(true);
    expect(api.contextData).toBeUndefined();
    await act(async () => {
      read = api.ensureRoomContext();
    });
    await act(async () => {
      finish(1);
      await read!;
    });
    expect(api.roomContextError).toBe(false);
    expect(api.contextData?.mode).toBe("context");
    expect(
      pending.every((request) => request.url.pathname.startsWith("/api/contracts/lease")),
    ).toBe(true);
  });
  it("does not accept the ordinary lease-form context as a complete room and bill cache", async () => {
    let ordinary: Promise<WorkspaceData>, room: Promise<WorkspaceData>;
    await act(async () => {
      ordinary = api.ensure("context");
    });
    expect(pending[0].url.searchParams.has("roomOverview")).toBe(false);
    await act(async () => {
      finish(0);
      await ordinary!;
    });
    expect(api.contextData?.roomReceivables).toBeUndefined();
    await act(async () => {
      room = api.ensureRoomContext();
    });
    expect(pending).toHaveLength(2);
    expect(pending[1].url.searchParams.get("roomOverview")).toBe("1");
    await act(async () => {
      finish(1);
      await room!;
    });
    expect(api.contextData?.roomReceivables).toEqual([]);
    await act(async () => {
      ordinary = api.ensure("context");
    });
    await act(async () => {
      finish(2);
      await ordinary!;
    });
    // A subsequent ordinary form read must not downgrade the stronger cache.
    expect(api.contextData?.roomReceivables).toEqual([]);
    await act(async () => {
      await api.ensureRoomContext();
    });
    expect(pending).toHaveLength(3);
  });
});
