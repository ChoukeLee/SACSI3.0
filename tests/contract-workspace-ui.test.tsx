// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), activate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/leases/actions", () => ({
  createLeaseContract: vi.fn(),
  activateContract: mocks.activate,
  terminateContract: vi.fn(),
  processMoveOut: vi.fn(),
  recordLeaseFinancialEntry: vi.fn(),
}));
vi.mock("@/features/sales/actions", () => ({
  createSaleContract: vi.fn(),
  recordSalePaymentAtomic: vi.fn(),
  addFlexibleInstallment: vi.fn(),
  updateTransferStatus: vi.fn(),
  terminateSaleContract: vi.fn(),
}));
vi.mock("@/features/leases/lease-request-identity", () => ({
  leaseRequestIdentity: async () => "99999999-9999-4999-8999-999999999999",
  clearLeaseRequestIdentity: vi.fn(),
}));
vi.mock("@/features/print", () => ({ printLeaseContract: vi.fn(), printSaleContract: vi.fn() }));
import { LeaseLazyView } from "../src/features/leases/lease-lazy-view";
import { SaleList } from "../src/features/sales/sale-list";
import {
  workspaceFixture,
  workspaceUnit,
  workspaceBuilding,
  workspaceProject,
} from "./fixtures/contract-workspace";
import { parseWorkspaceQuery, type WorkspaceData } from "../src/features/contracts/workspace-model";
import type { LeaseContractRow, SaleContractRow } from "../src/types/database";
import { dictionaries } from "../src/lib/i18n";
import {
  leaseScopeCookieName,
  leaseScopeStorageKey,
  LEASE_SCOPE_LEGACY_CLAIM_KEY,
  serializeLeaseScope,
  type LeaseScopePreference,
} from "../src/features/contracts/lease-scope-preference";
const viewer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  cookieName = leaseScopeCookieName(viewer)!;
let host: HTMLDivElement, root: Root;
const pause = () =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 15);
    });
  });
const render = (
  data: WorkspaceData,
  locale: "zh" | "fr" = "zh",
  initialProject: string | null = data.query.projectId,
  scopePreference?: LeaseScopePreference,
) =>
  root.render(
    <LeaseLazyView
      key={scopePreference?.cookieName}
      {...data}
      contracts={data.contracts as LeaseContractRow[]}
      workspace={data}
      locale={locale}
      initialProject={initialProject ?? undefined}
      scopePreference={scopePreference}
    />,
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  document.cookie = `${cookieName}=; Max-Age=0; Path=/`;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.activate.mockResolvedValue({ success: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const raw = Object.fromEntries(new URL(input, "http://local.invalid").searchParams),
        mode = raw.mode as WorkspaceData["mode"];
      delete raw.mode;
      delete raw.contractId;
      const q = parseWorkspaceQuery(raw);
      return Response.json(workspaceFixture({ total: 26 }, q, mode));
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("renders actual unchanged lease table with full-scope stats and reads the next DB page", async () => {
  await act(async () => render(workspaceFixture({ total: 26 })));
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toContain("1–25 / 26");
  expect(host.textContent).toContain("5,100");
  const next = [...host.querySelectorAll("button")].find((b) => b.textContent === "下一页")!;
  await act(async () => next.click());
  await pause();
  expect(host.textContent).toContain("26–26 / 26");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(["zh", "fr"] as const)(
  "uses the original no-preference default building SSR result without another initial read (%s)",
  async (locale) => {
    const data = workspaceFixture(
      {},
      parseWorkspaceQuery({ projectId: workspaceProject, buildingId: workspaceBuilding, locale }),
    );
    await act(async () => render(data, locale, null, { cookieName, serverResolved: false }));
    await pause();
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.textContent).toContain("Synthetic 11");
  },
);
it("migrates legacy localStorage once, then trusts the newly validated SSR cookie instead of stale storage", async () => {
  const data = workspaceFixture(
    {},
    parseWorkspaceQuery({ projectId: workspaceProject, buildingId: workspaceBuilding }),
  );
  localStorage.setItem(
    "lease-project-scope",
    JSON.stringify({
      projectId: data.query.projectId,
      buildings: { [data.query.projectId]: "all" },
    }),
  );
  await act(async () => render(data, "zh", null, { cookieName, serverResolved: false }));
  await pause();
  await pause();
  expect(fetch).toHaveBeenCalledTimes(1);
  const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string, "http://local.invalid");
  expect(url.searchParams.get("buildingId")).toBe("");
  expect(url.searchParams.get("projectId")).toBe(data.query.projectId);
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  expect(
    JSON.parse(localStorage.getItem(leaseScopeStorageKey(cookieName))!).buildings[
      data.query.projectId
    ],
  ).toBe("all");
  expect(document.cookie).toContain(`${cookieName}=${serializeLeaseScope(workspaceProject, "")}`);
  localStorage.setItem(
    "lease-project-scope",
    JSON.stringify({
      projectId: workspaceProject,
      buildings: { [workspaceProject]: workspaceBuilding },
    }),
  );
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () =>
    render(workspaceFixture(), "zh", null, { cookieName, serverResolved: true }),
  );
  await pause();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("全部楼栋合计");
});
it("does not re-read a matching saved all scope or override an explicit project link with a saved building", async () => {
  const data = workspaceFixture();
  localStorage.setItem(
    "lease-project-scope",
    JSON.stringify({
      projectId: data.query.projectId,
      buildings: { [data.query.projectId]: "all" },
    }),
  );
  await act(async () => render(data, "zh", null, { cookieName, serverResolved: true }));
  await pause();
  expect(fetch).not.toHaveBeenCalled();
  localStorage.setItem(
    "lease-project-scope",
    JSON.stringify({
      projectId: data.query.projectId,
      buildings: { [data.query.projectId]: data.buildings[0].id },
    }),
  );
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => render(data));
  await pause();
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["", workspaceBuilding])(
  "initializes from the validated SSR scope instead of the opposite stale local preference (%s)",
  async (buildingId) => {
    const data = workspaceFixture(
      {},
      parseWorkspaceQuery({ projectId: workspaceProject, buildingId }),
    );
    localStorage.setItem(
      "lease-project-scope",
      JSON.stringify({
        projectId: workspaceProject,
        buildings: { [workspaceProject]: buildingId ? "all" : workspaceBuilding },
      }),
    );
    await act(async () => render(data, "zh", null, { cookieName, serverResolved: true }));
    await pause();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(leaseScopeStorageKey(cookieName))!).buildings[
        workspaceProject
      ],
    ).toBe(buildingId || "all");
    expect(document.cookie).toContain(
      `${cookieName}=${serializeLeaseScope(workspaceProject, buildingId)}`,
    );
  },
);
it("synchronizes a new SSR scope on same-route navigation without restoring the previous local building", async () => {
  const preference = { cookieName, serverResolved: true };
  await act(async () => render(workspaceFixture(), "zh", null, preference));
  const next = workspaceFixture(
    {},
    parseWorkspaceQuery({ projectId: workspaceProject, buildingId: workspaceBuilding }),
  );
  await act(async () => render(next, "zh", null, preference));
  await pause();
  expect(fetch).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem(leaseScopeStorageKey(cookieName))!).buildings[workspaceProject],
  ).toBe(workspaceBuilding);
});
it("does not import the first viewer's claimed legacy preference into a different viewer, even after an explicit link entry", async () => {
  const legacy = JSON.stringify({
    projectId: workspaceProject,
    buildings: { [workspaceProject]: "all" },
  });
  localStorage.setItem("lease-project-scope", legacy);
  await act(async () =>
    render(workspaceFixture(), "zh", workspaceProject, { cookieName, serverResolved: true }),
  );
  expect(localStorage.getItem(LEASE_SCOPE_LEGACY_CLAIM_KEY)).toBe(cookieName);
  await act(async () => root.unmount());
  root = createRoot(host);
  const secondCookieName = leaseScopeCookieName("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
  const data = workspaceFixture(
    {},
    parseWorkspaceQuery({ projectId: workspaceProject, buildingId: workspaceBuilding }),
  );
  await act(async () =>
    render(data, "zh", null, { cookieName: secondCookieName, serverResolved: false }),
  );
  await pause();
  expect(fetch).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem(leaseScopeStorageKey(secondCookieName))!).buildings[
      workspaceProject
    ],
  ).toBe(workspaceBuilding);
  expect(localStorage.getItem("lease-project-scope")).toBe(legacy);
});
it("remounts the real lease view on same-root viewer replacement without carrying another viewer's building memory", async () => {
  const otherProject = "88888888-8888-4888-8888-888888888888";
  localStorage.setItem(
    leaseScopeStorageKey(cookieName),
    JSON.stringify({
      projectId: workspaceProject,
      buildings: {
        [workspaceProject]: "all",
        [otherProject]: "99999999-9999-4999-8999-999999999999",
      },
    }),
  );
  await act(async () =>
    render(workspaceFixture(), "zh", null, { cookieName, serverResolved: true }),
  );
  const secondCookieName = leaseScopeCookieName("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
  const next = workspaceFixture(
    {},
    parseWorkspaceQuery({ projectId: workspaceProject, buildingId: workspaceBuilding }),
  );
  await act(async () =>
    render(next, "zh", null, { cookieName: secondCookieName, serverResolved: false }),
  );
  await pause();
  expect(fetch).not.toHaveBeenCalled();
  const memory = JSON.parse(localStorage.getItem(leaseScopeStorageKey(secondCookieName))!);
  expect(memory.buildings).toEqual({ [workspaceProject]: workspaceBuilding });
});
it("still applies a new verified SSR scope when localStorage is unavailable", async () => {
  const preference = { cookieName, serverResolved: true };
  await act(async () => render(workspaceFixture(), "zh", null, preference));
  const unavailable = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("synthetic storage unavailable");
  });
  try {
    const next = workspaceFixture(
      {},
      parseWorkspaceQuery({ projectId: workspaceProject, buildingId: workspaceBuilding }),
    );
    await act(async () => render(next, "zh", null, preference));
    await pause();
    expect(fetch).not.toHaveBeenCalled();
    expect((host.querySelector('select[aria-label="选择楼栋"]') as HTMLSelectElement).value).toBe(
      workspaceBuilding,
    );
  } finally {
    unavailable.mockRestore();
  }
});
it.each(["zh", "fr"] as const)(
  "keeps sale default-building and explicit-project initial SSR scopes without duplicate requests (%s)",
  async (locale) => {
    for (const explicit of [false, true]) {
      const query = parseWorkspaceQuery({
        projectId: explicit ? workspaceProject : "",
        buildingId: explicit ? "" : workspaceBuilding,
        locale,
      });
      const data = workspaceFixture({ kind: "sale" }, query);
      data.buildings[0].code = "SACSI11";
      Object.assign(data.contracts[0], {
        signed_date: "2026-01-01",
        total_amount_xof: 100,
        total_amount_confirmed: true,
        payment_plan_type: "lump_sum",
        transfer_status: "not_started",
        transfer_date: null,
      });
      await act(async () =>
        root.render(
          <SaleList
            {...data}
            contracts={data.contracts as SaleContractRow[]}
            workspace={data}
            initialProject={explicit ? workspaceProject : undefined}
            locale={locale}
          />,
        ),
      );
      await pause();
      expect(fetch).not.toHaveBeenCalled();
      expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  },
);
it("never repeats a confirmed successful mutation when the following data refresh fails", async () => {
  const initial = workspaceFixture();
  (initial.contracts[0] as LeaseContractRow).status = "draft";
  vi.mocked(fetch).mockImplementation(async (input: any) => {
    const raw = Object.fromEntries(new URL(String(input), "http://local.invalid").searchParams),
      mode = raw.mode as WorkspaceData["mode"];
    delete raw.mode;
    delete raw.contractId;
    if (mocks.activate.mock.calls.length) return new Response("", { status: 503 });
    const data = workspaceFixture({}, parseWorkspaceQuery(raw), mode);
    (data.contracts[0] as LeaseContractRow).status = "draft";
    return Response.json(data);
  });
  await act(async () => render(initial));
  const customer = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Synthetic guest",
  )!;
  await act(async () => customer.click());
  await pause();
  const activate = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === dictionaries.zh.leases.form.activateContract,
  )!;
  expect(activate).toBeTruthy();
  await act(async () => activate.click());
  await pause();
  expect(mocks.activate).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("上一笔操作已确认成功");
  expect(document.body.textContent).not.toContain(dictionaries.zh.leases.form.activateContract);
});
it("keeps disabled historical units readable but excludes a daily-only available unit from new lease choices", async () => {
  const initial = workspaceFixture();
  initial.units[0].unit_business_flags = [
    { business_type: "long_lease", is_enabled: false, default_price_xof: null },
  ];
  await act(async () => render(initial));
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  vi.mocked(fetch).mockImplementation(async (input: any) => {
    const raw = Object.fromEntries(new URL(String(input), "http://local.invalid").searchParams);
    delete raw.mode;
    const data = workspaceFixture({ total: 0 }, parseWorkspaceQuery(raw), "context");
    data.units[0].status = "available";
    data.units[0].unit_business_flags = [
      { business_type: "daily_rental", is_enabled: true, default_price_xof: 40 },
      { business_type: "long_lease", is_enabled: false, default_price_xof: null },
    ];
    return Response.json(data);
  });
  const create = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(dictionaries.zh.leases.form.newContract),
  )!;
  await act(async () => create.click());
  await pause();
  expect(document.querySelector(`option[value="${workspaceUnit}"]`)).toBeNull();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
});
it.each(["zh", "fr"] as const)(
  "keeps CIMAC draft dates explicitly unknown in the real list, room and detail views (%s)",
  async (locale) => {
    const makeData = (
      query = parseWorkspaceQuery({ projectId: workspaceProject, locale }),
      mode: WorkspaceData["mode"] = "list",
    ) => {
      const data = workspaceFixture({}, query, mode);
      data.buildings[0].code = "CIMAC";
      data.buildings[0].display_name = "Synthetic CIMAC";
      data.buildings[0].project!.code = "CIMAC";
      Object.assign(data.contracts[0], {
        status: "draft",
        start_date: null,
        expected_end_date: null,
        paid_through_date: null,
        expected_end_confirmed: true,
      });
      return data;
    };
    vi.mocked(fetch).mockImplementation(async (input: any) => {
      const raw = Object.fromEntries(new URL(String(input), "http://local.invalid").searchParams),
        mode = raw.mode as WorkspaceData["mode"];
      delete raw.mode;
      delete raw.contractId;
      return Response.json(makeData(parseWorkspaceQuery(raw), mode));
    });
    const pending = locale === "zh" ? "待确认" : "À confirmer";
    await act(async () => render(makeData(), locale));
    expect(host.textContent).toContain(
      `${pending} → ${locale === "zh" ? "期限待确认" : "Fin à confirmer"}`,
    );
    expect(host.textContent).not.toMatch(/null|undefined|NaN|1970-01-01/);
    const rooms = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === (locale === "zh" ? "楼层房源" : "Par étage"),
    )!;
    await act(async () => rooms.click());
    await pause();
    expect(host.textContent).toContain(`${pending} →`);
    const details = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("title") === (locale === "zh" ? "查看详情" : "Voir les détails"),
    )!;
    expect(details).toBeTruthy();
    await act(async () => details.click());
    await pause();
    expect(document.body.textContent).toContain(pending);
    const inspector = host.querySelector(
      `[aria-label="${locale === "zh" ? "合同预览" : "Aperçu du contrat"}"]`,
    )!;
    for (const label of locale === "zh" ? ["起租日期", "预计到期"] : ["Début", "Fin prévue"]) {
      const fact = [...inspector.querySelectorAll("dt")].find(
        (element) => element.textContent === label,
      )?.parentElement;
      expect(fact?.querySelector("dd")?.textContent).toBe(pending);
    }
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/null|undefined|NaN|1970-01-01/);
  },
);
