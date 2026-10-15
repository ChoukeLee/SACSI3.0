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
vi.mock("@/features/leases/lease-request-identity", () => ({
  leaseRequestIdentity: async () => "99999999-9999-4999-8999-999999999999",
  clearLeaseRequestIdentity: vi.fn(),
}));
vi.mock("@/features/print", () => ({ printLeaseContract: vi.fn() }));
import { LeaseList } from "../src/features/leases/lease-list";
import { workspaceFixture, workspaceUnit } from "./fixtures/contract-workspace";
import { parseWorkspaceQuery, type WorkspaceData } from "../src/features/contracts/workspace-model";
import type { LeaseContractRow } from "../src/types/database";
import { dictionaries } from "../src/lib/i18n";
let host: HTMLDivElement, root: Root;
const pause = () =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 15);
    });
  });
const render = (data: WorkspaceData, locale: "zh" | "fr" = "zh") =>
  root.render(
    <LeaseList
      {...data}
      contracts={data.contracts as LeaseContractRow[]}
      workspace={data}
      locale={locale}
      initialProject={data.query.projectId}
    />,
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
      query = parseWorkspaceQuery({ locale }),
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
    expect(document.body.textContent).toContain(locale === "zh" ? "未确认" : "Non confirmée");
    expect(document.body.textContent).not.toMatch(/null|undefined|NaN|1970-01-01/);
  },
);
