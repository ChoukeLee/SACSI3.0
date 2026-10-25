import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import {
  readCimacAsset,
  readCimacAssets,
  readCimacCustomer,
  readCimacCustomers,
  readCimacHome,
  readCimacWorkspaceScope,
} from "@/features/cimac/cimac-workspace-read";
import { parseCimacWorkspaceQuery } from "@/features/cimac/cimac-workspace-query";

type Row = Record<string, unknown>;
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const project = id(1),
  building = id(2),
  unit = id(3),
  customer = id(4),
  contract = id(5),
  foreignProject = id(91),
  foreignBuilding = id(92),
  foreignUnit = id(93);
let tables: Record<string, Row[]>,
  errors: Record<string, { code: string }>,
  calls: {
    table: string;
    columns: string;
    filters: [string, unknown][];
    from: number;
    to: number;
  }[],
  rpcError: { code: string } | null,
  relationshipProject: string,
  customerTotal: number,
  truncate: boolean;
const unitRow = (n = 3) => ({
  id: id(n),
  building_id: building,
  code: `CIMAC-D${n}`,
  unit_no: `D${n}`,
  kind: "storefront",
  asset_subtype: "commercial_shop",
  floor_label: "G",
  area_sqm: 90,
  construction_status: "operational",
  occupancy_verified: true,
  updated_at: "2026-10-25T01:00:00Z",
  amount_xof: "DO_NOT_FORWARD",
});
const position = (n = 3) => ({
  id: id(n),
  building_id: building,
  ownership: "unspecified",
  operational_condition: "normal",
  daily_occupied: false,
  lease_occupied: true,
  cleaning_pending: false,
  daily_enabled: false,
  lease_enabled: true,
});
const summary = (selected = customer) => ({
  id: selected,
  name: "Virtual customer",
  phone: null,
  isBlacklisted: false,
  hasDocument: false,
  roles: ["lease"],
  rooms: ["D3"],
  roomCount: 1,
  relationshipCount: 1,
  lastBusinessDate: "2026-10-01",
  accountBalance: "DO_NOT_FORWARD",
});
const relation = () => ({
  id: contract,
  role: "lease",
  unitId: unit,
  unitNo: "D3",
  buildingId: relationshipProject === project ? building : foreignBuilding,
  buildingLabel: "D",
  projectId: relationshipProject,
  code: "L-DEMO",
  startDate: "2026-10-01",
  endDate: null,
  endDateKind: null,
  status: "active",
  accountBalance: "DO_NOT_FORWARD",
});
const profile = () => ({
  id: customer,
  name: "Virtual customer",
  phone: null,
  gender: null,
  document_type: null,
  notes: null,
  is_blacklisted: false,
  blacklist_reason: null,
  blacklist_operator_id: null,
  blacklist_date: null,
  blacklist_permanent: false,
  hasDocument: false,
  created_at: "2026-10-01T01:00:00Z",
  updated_at: "2026-10-01T01:00:00Z",
  accountBalance: "DO_NOT_FORWARD",
});
const rpc = vi.fn(async (name: string, input: Row) => {
  expect(name).toBe("cimac_customer_directory_read_rpc");
  if (rpcError) return { data: null, error: rpcError };
  if (input.p_customer_id && input.p_customer_id !== customer)
    return { data: null, error: { code: "P0002" } };
  const query = input.p_input as Row,
    detail = input.p_mode === "detail",
    relationPage = Number(input.p_relation_page);
  const rows = detail
    ? [summary()]
    : Array.from({ length: customerTotal }, (_, n) =>
        summary(n === 0 ? customer : id(2000 + n)),
      ).slice((Number(query.page) - 1) * 40, Number(query.page) * 40);
  return {
    data: {
      mode: input.p_mode,
      query,
      pageSize: 40,
      total: detail ? 1 : customerTotal,
      scopeCount: customerTotal,
      buildings: [
        {
          id: building,
          code: "D",
          label: "D",
          project: { id: project, code: "CIMAC", label: "CIMAC" },
        },
        {
          id: foreignBuilding,
          code: "PRIVATE_OTHER",
          label: "PRIVATE_OTHER",
          project: { id: foreignProject, code: "SACSI", label: "PRIVATE_OTHER" },
        },
      ],
      rows,
      profile: detail ? profile() : null,
      relationships: detail && relationPage === 1 ? [relation()] : [],
      relationshipPage: relationPage,
      relationshipTotal: detail ? 1 : 0,
    },
    error: null,
  };
});
const client = {
  rpc,
  from(table: string) {
    let columns = "",
      filters: [string, unknown][] = [],
      from = 0,
      to = Infinity,
      head = false;
    const result = () => {
      calls.push({ table, columns, filters: [...filters], from, to });
      const matched = (tables[table] ?? []).filter((row) =>
        filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
        ),
      );
      return {
        data: head ? null : matched.slice(from, truncate ? from + 1 : to + 1),
        count: matched.length,
        error: errors[table] ?? null,
      };
    };
    const b = {
      select(value: string, options?: { head?: boolean }) {
        columns = value;
        head = options?.head ?? false;
        return b;
      },
      eq(key: string, value: unknown) {
        filters.push([key, value]);
        return b;
      },
      in(key: string, value: unknown[]) {
        filters.push([key, value]);
        return b;
      },
      order: () => b,
      range(first: number, last: number) {
        from = first;
        to = last;
        return b;
      },
      async maybeSingle() {
        const r = result();
        return { ...r, data: r.data?.[0] ?? null };
      },
      then(
        resolve: (value: ReturnType<typeof result>) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return b;
  },
} as unknown as Pick<SupabaseClient, "from" | "rpc">;

beforeEach(() => {
  calls = [];
  errors = {};
  rpcError = null;
  relationshipProject = project;
  customerTotal = 1;
  truncate = false;
  rpc.mockClear();
  tables = {
    projects: [
      { id: project, code: "CIMAC", display_name: "CIMAC", is_active: true },
      { id: foreignProject, code: "SACSI", display_name: "PRIVATE_OTHER", is_active: true },
    ],
    buildings: [
      {
        id: building,
        project_id: project,
        code: "D",
        display_name: "D",
        is_active: true,
        construction_status: "unverified",
      },
      {
        id: foreignBuilding,
        project_id: foreignProject,
        code: "PRIVATE_OTHER",
        display_name: "PRIVATE_OTHER",
        is_active: true,
        construction_status: "operational",
      },
    ],
    units: [unitRow(), { ...unitRow(93), building_id: foreignBuilding }],
    unit_operational_position: [position(), { ...position(93), building_id: foreignBuilding }],
    lease_contracts: [
      {
        id: contract,
        unit_id: unit,
        customer_id: customer,
        contract_no: "L-DEMO",
        status: "active",
        start_date: "2026-10-01",
        actual_end_date: null,
        expected_end_date: "2027-10-01",
        expected_end_confirmed: false,
        created_at: "2026-10-01T01:00:00Z",
        customer: { name: "Virtual customer" },
      },
    ],
    sale_contracts: [],
    daily_bookings: [],
  };
});

describe("current-session scoped operational reads", () => {
  it("resolves exact active CIMAC scope and never includes another visible project", async () => {
    const scope = await readCimacWorkspaceScope(client);
    expect(scope.project).toEqual({ id: project, code: "CIMAC", displayName: "CIMAC" });
    expect(scope.buildings.map((b) => b.id)).toEqual([building]);
    expect(calls[0].filters).toEqual([
      ["code", "CIMAC"],
      ["is_active", true],
    ]);
    expect(JSON.stringify(scope)).not.toContain("PRIVATE_OTHER");
  });
  it.each(["hidden", "denied", "error"])(
    "does not fall back when CIMAC scope is %s",
    async (issue) => {
      if (issue === "hidden") tables.projects = tables.projects.slice(1);
      if (issue === "denied") errors.projects = { code: "42501" };
      if (issue === "error") errors.projects = { code: "57014" };
      await expect(readCimacWorkspaceScope(client)).rejects.toMatchObject({
        status: issue === "error" ? 503 : 403,
      });
      expect(calls.some((c) => c.table === "units")).toBe(false);
    },
  );
  it("reads home checks from actual scoped facts, not money, dummy tasks or customers N+1", async () => {
    const scope = await readCimacWorkspaceScope(client);
    tables.units[0].occupancy_verified = false;
    const data = await readCimacHome(client, scope);
    expect(data).toMatchObject({
      customerCount: 1,
      assetSummary: { total: 1, occupied: 0, occupancyUnknown: 1 },
      attentionTotal: 1,
    });
    expect(data.attention[0].attentionReasons).toContain("occupancy_unverified");
    expect(data.assetIndex).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(
      calls.some((c) =>
        ["payments", "receivables", "ledger_entries", "audit_logs"].includes(c.table),
      ),
    ).toBe(false);
    expect(JSON.stringify(data)).not.toContain("DO_NOT_FORWARD");
  });
  it("keeps a genuine authorized empty inventory distinct from inaccessible/failed inventory", async () => {
    const scope = await readCimacWorkspaceScope(client);
    tables.units = [];
    tables.unit_operational_position = [];
    expect((await readCimacAssets(client, scope)).summary.total).toBe(0);
    errors.units = { code: "57014" };
    await expect(readCimacAssets(client, scope)).rejects.toMatchObject({ status: 503 });
  });
  it("does not render missing operational evidence as vacant", async () => {
    const scope = await readCimacWorkspaceScope(client);
    tables.unit_operational_position = [];
    const data = await readCimacAssets(client, scope);
    expect(data.summary).toMatchObject({ occupied: 0, unoccupied: 0, occupancyUnknown: 1 });
    expect(data.rows[0].position).toBeNull();
  });
  it("reads every bounded light inventory page but only returns50, with no contract/money scans", async () => {
    const scope = await readCimacWorkspaceScope(client);
    tables.units = Array.from({ length: 1051 }, (_, n) => unitRow(100 + n));
    tables.unit_operational_position = Array.from({ length: 1051 }, (_, n) => position(100 + n));
    calls = [];
    const data = await readCimacAssets(client, scope, parseCimacWorkspaceQuery({ page: 2 }));
    expect(data.rows).toHaveLength(50);
    expect(data.total).toBe(1051);
    expect(calls.filter((c) => c.table === "units").map((c) => c.from)).toEqual([0, 1000]);
    expect(calls.every((c) => c.table === "units" || c.table === "unit_operational_position")).toBe(
      true,
    );
  });
  it("fails closed on truncated or excessive inventory instead of publishing partial totals", async () => {
    const scope = await readCimacWorkspaceScope(client);
    tables.units.push(unitRow(10));
    tables.unit_operational_position.push(position(10));
    truncate = true;
    await expect(readCimacAssets(client, scope)).rejects.toMatchObject({ status: 503 });
    truncate = false;
    tables.units = Array.from({ length: 10001 }, (_, n) => unitRow(100 + n));
    await expect(readCimacAssets(client, scope)).rejects.toMatchObject({ status: 413 });
  });
  it("never scans foreign asset history or silently changes explicit scope", async () => {
    const scope = await readCimacWorkspaceScope(client);
    calls = [];
    await expect(readCimacAsset(client, scope, foreignUnit)).rejects.toMatchObject({ status: 404 });
    expect(calls.map((c) => c.table)).toEqual(["units"]);
    await expect(
      readCimacAssets(client, scope, parseCimacWorkspaceQuery({ project: foreignProject })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readCimacAssets(client, scope, parseCimacWorkspaceQuery({ building: foreignBuilding })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(readCimacAsset(client, scope, "not-id")).rejects.toMatchObject({ status: 400 });
  });
  it("reads selected asset relations in an exact30-record scoped page and keeps unknown contract end", async () => {
    const scope = await readCimacWorkspaceScope(client),
      data = await readCimacAsset(client, scope, unit);
    expect(data).toMatchObject({
      asset: { id: unit, opening: { status: "unknown" }, handover: { status: "unknown" } },
      relationTotal: 1,
      pageSize: 30,
    });
    expect(data.relations[0]).toMatchObject({
      id: contract,
      end: null,
      endDateKind: null,
      customerId: customer,
    });
    expect(
      calls
        .filter((c) => ["lease_contracts", "sale_contracts", "daily_bookings"].includes(c.table))
        .every((c) => c.filters.some(([key, value]) => key === "unit_id" && value === unit)),
    ).toBe(true);
    expect(
      calls.some((c) => c.columns.includes("monthly_rent") || c.columns.includes("paid_amount")),
    ).toBe(false);
  });
  it("pins customer directory to CIMAC, returns paged identities only, and drops cross-project catalog extras", async () => {
    const scope = await readCimacWorkspaceScope(client);
    customerTotal = 41;
    const data = await readCimacCustomers(
      client,
      scope,
      parseCimacWorkspaceQuery({ page: 2 }, "customers"),
    );
    expect(data.rows).toHaveLength(1);
    expect(data.total).toBe(41);
    expect(rpc).toHaveBeenLastCalledWith(
      "cimac_customer_directory_read_rpc",
      expect.objectContaining({
        p_input: expect.objectContaining({ projectId: project, page: 2 }),
      }),
    );
    expect(JSON.stringify(data)).not.toContain("DO_NOT_FORWARD");
    expect(JSON.stringify(data)).not.toContain("PRIVATE_OTHER");
  });
  it("loads exact customer relationship page and exposes neither balances nor unrelated project properties", async () => {
    const scope = await readCimacWorkspaceScope(client),
      data = await readCimacCustomer(
        client,
        scope,
        customer,
        parseCimacWorkspaceQuery({ tab: "account", accountTab: "meters" }, "customers"),
      );
    expect(data).toMatchObject({
      profile: { id: customer },
      summary: { relationshipCount: 1 },
      relations: [{ projectId: project, unitId: unit }],
      pageSize: 25,
    });
    expect(data.query.accountTab).toBe("meters");
    expect(JSON.stringify(data)).not.toContain("DO_NOT_FORWARD");
    expect(JSON.stringify(data)).not.toContain("PRIVATE_OTHER");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects non-CIMAC customers/relations and does not present read failure as no customers", async () => {
    const scope = await readCimacWorkspaceScope(client);
    await expect(readCimacCustomer(client, scope, id(99))).rejects.toMatchObject({ status: 404 });
    relationshipProject = foreignProject;
    await expect(readCimacCustomer(client, scope, customer)).rejects.toMatchObject({ status: 503 });
    rpcError = { code: "42501" };
    await expect(readCimacCustomers(client, scope)).rejects.toMatchObject({ status: 403 });
    rpcError = { code: "57014" };
    await expect(readCimacHome(client, scope)).rejects.toMatchObject({ status: 503 });
  });
  it("keeps current/archive scoped to the CIMAC RPC and permits a membership-only customer", async () => {
    const scope = await readCimacWorkspaceScope(client);
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementationOnce(async (name, input) => {
      const result = await original(name, input);
      if (result.error) return result;
      return {
        ...result,
        data: {
          ...result.data!,
          rows: [
            {
              ...summary(),
              roles: [],
              rooms: [],
              roomCount: 0,
              relationshipCount: 0,
              membershipStatus: "archived",
            },
          ],
          profile: { ...profile(), membershipStatus: "archived" },
          relationships: [],
          relationshipTotal: 0,
        },
      };
    });
    const data = await readCimacCustomer(
      client,
      scope,
      customer,
      parseCimacWorkspaceQuery({ membershipStatus: "archived" }, "customers"),
    );
    expect(data.relationTotal).toBe(0);
    expect(data.summary.membershipStatus).toBe("archived");
    expect(rpc).toHaveBeenLastCalledWith(
      "cimac_customer_directory_read_rpc",
      expect.objectContaining({
        p_input: expect.objectContaining({ membershipStatus: "archived", projectId: project }),
      }),
    );
  });
  it("preserves per-unit brands and confirmed signing metadata on documentary relationships", async () => {
    const scope = await readCimacWorkspaceScope(client);
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementationOnce(async (name, input) => {
      const result = await original(name, input);
      if (result.error) return result;
      return {
        ...result,
        data: {
          ...result.data!,
          rows: [{ ...summary(), roles: ["park_link"] }],
          relationships: [
            {
              ...relation(),
              role: "park_link",
              status: "signed_effective",
              brand: "箭牌卫浴",
              signingState: "signed_effective",
              relationshipKind: "signed_contract",
              signedDate: null,
              sourceReference: "原合同资料",
            },
          ],
        },
      };
    });
    const data = await readCimacCustomer(client, scope, customer);
    expect(data.relations[0]).toMatchObject({
      role: "park_link",
      brand: "箭牌卫浴",
      signingState: "signed_effective",
      signedDate: null,
      sourceReference: "原合同资料",
    });
  });
  it("rejects out-of-range customer pages rather than describing a populated customer as having no relations", async () => {
    const scope = await readCimacWorkspaceScope(client);
    await expect(
      readCimacCustomers(client, scope, parseCimacWorkspaceQuery({ page: 2 }, "customers")),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      readCimacCustomer(
        client,
        scope,
        customer,
        parseCimacWorkspaceQuery({ relationPage: 2 }, "customers"),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
