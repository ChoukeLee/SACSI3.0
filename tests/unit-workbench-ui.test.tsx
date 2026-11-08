// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnitWorkbench } from "@/features/units/unit-workbench";
import {
  parseUnitWorkbenchQuery,
  UNIT_WORKBENCH_PAGE_SIZE,
  type UnitWorkbenchData,
  type UnitWorkbenchRecord,
} from "@/features/units/unit-workbench-model";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  audit: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks,
  usePathname: () => "/units",
  useSearchParams: () => mocks.params,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ unit, onClose }: { unit: { id: string }; onClose: () => void }) => (
      <div role="dialog" aria-label="运行条件维护">
        <div data-condition-target={unit.id}>原运行条件操作</div>
        <button onClick={onClose}>取消维护</button>
      </div>
    ),
}));
vi.mock("@/features/units/actions", () => ({ getUnitAuditLogs: mocks.audit }));
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString().padStart(12, "0")}`;
const project = uuid(1),
  building = uuid(2),
  otherProject = uuid(3),
  otherBuilding = uuid(4);
const row = (n: number, overrides: Partial<UnitWorkbenchRecord> = {}): UnitWorkbenchRecord => ({
  unit: {
    id: uuid(100 + n),
    building_id: building,
    code: `A-${n}`,
    unit_no: String(101 + n),
    floor_label: "1F",
    kind: "apartment",
    status: "sold",
    area_sqm: null,
    layout: "两房",
    furnishing: null,
    notes: null,
    occupancy_verified: true,
    construction_status: "operational",
    created_at: "2026-10-19",
    updated_at: "2026-10-19",
  },
  flags: [],
  position: {
    ownership: "sold",
    operational_condition: "maintenance",
    daily_occupied: false,
    lease_occupied: true,
    cleaning_pending: true,
    daily_enabled: false,
    lease_enabled: true,
  },
  ...overrides,
});
function data(): UnitWorkbenchData {
  const buildings = [
    {
      id: building,
      code: "SACSI7",
      display_name: "7#公寓",
      project_id: project,
      project_code: "SACSI",
      project_name: "公寓项目",
      allows_sale: true,
    },
    {
      id: otherBuilding,
      code: "CIMAC",
      display_name: "商铺区",
      project_id: otherProject,
      project_code: "CIMAC",
      project_name: "建材城",
      allows_sale: false,
    },
  ];
  return {
    query: parseUnitWorkbenchQuery({ project, building }),
    building: buildings[0],
    buildings,
    scopeUnavailable: false,
    rows: [row(0), row(1, { position: null })],
    selected: null,
    selectedUnavailable: false,
    floors: ["1F", "2F"],
    total: 2,
    scopeTotal: 2,
    summary: { occupied: 1, attention: 2, unverified: 1 },
  };
}
let host: HTMLDivElement, root: Root, fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = new URLSearchParams();
  mocks.audit.mockResolvedValue([]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState(null, "", "/units");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (value = data(), canEdit = false, locale: "zh" | "fr" = "zh") =>
  act(async () => root.render(<UnitWorkbench data={value} locale={locale} canEdit={canEdit} />));
const click = async (element: Element) =>
  act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
const selectFirst = async () => click(host.querySelector('[aria-label="查看资产 101"]')!);
const drawer = () => document.querySelector('[role="dialog"]');
const card = (id: string) => host.querySelector(`[data-unit-card-id="${id}"]`);
async function openDetails(label: string) {
  const details = [...document.querySelectorAll("details")].find(
    (item) => item.querySelector(":scope > summary")?.textContent === label,
  );
  expect(details).toBeTruthy();
  if (!details!.open) await click(details!.querySelector("summary")!);
  return details!;
}
async function openMaintenance() {
  await openDetails("更多操作");
  await click(button("核对 / 修改运行条件"));
}

describe("asset directory UI", () => {
  it.each([false, true])(
    "opens one focused asset drawer on narrow screens with reduced motion %s",
    async (reducedMotion) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          media: query,
          matches:
            query === "(max-width: 1199px)" ||
            (query === "(prefers-reduced-motion: reduce)" && reducedMotion),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      );
      await render();
      await selectFirst();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(drawer()?.querySelector('[aria-label="资产 101 的档案"]')).toBeTruthy();
      expect(drawer()?.contains(document.activeElement)).toBe(true);
      expect(drawer()?.querySelectorAll('button[aria-label="Close"]')).toHaveLength(1);
      expect(drawer()?.querySelector('[aria-label="关闭资产档案"]')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );
  it("opens the exact server-selected deep link in one drawer without reading unrelated business or history", async () => {
    const value = data();
    value.selected = value.rows[1];
    value.query.unit = value.selected.unit.id;
    await render(value);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(drawer()?.querySelector('[aria-label="资产 102 的档案"]')).toBeTruthy();
    expect(drawer()?.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    expect(card(uuid(101))?.getAttribute("aria-pressed")).toBe("true");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("keeps an authorized exact deep link outside the visible floor results instead of opening the first card", async () => {
    const value = data();
    value.query.floor = "1F";
    value.selected = row(98, { unit: { ...row(98).unit, floor_label: "9F" } });
    value.query.unit = value.selected.unit.id;
    await render(value);
    expect(card(value.selected.unit.id)).toBeNull();
    expect(drawer()?.querySelector('[aria-label="资产 199 的档案"]')).toBeTruthy();
    expect(drawer()?.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not reopen an explicitly closed detail after a same-scope refresh of the same version", async () => {
    const value = data();
    value.selected = value.rows[0];
    value.query.unit = value.selected.unit.id;
    await render(value);
    await click(drawer()!.querySelector('button[aria-label="Close"]')!);
    expect(drawer()).toBeNull();
    await render({ ...value, rows: [...value.rows] });
    expect(drawer()).toBeNull();
    expect(document.querySelector("[data-condition-target]")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["actual", "expected"] as const)(
    "labels the %s business end date instead of presenting every date as an actual departure",
    async (kind) => {
      fetcher.mockResolvedValue(
        new Response(
          JSON.stringify({
            unitId: uuid(100),
            buildingId: building,
            projectId: project,
            total: 1,
            page: 1,
            relations: [
              {
                id: uuid(900),
                type: "lease",
                contractNo: "L-history",
                status: "terminated",
                start: "2026-01-01",
                end: "2026-09-15",
                endDateKind: kind,
                endConfirmed: true,
                customerId: uuid(901),
                customerName: "Historical tenant",
                agentId: null,
                agentName: null,
              },
            ],
          }),
        ),
      );
      await render();
      await selectFirst();
      await click(button("业务记录"));
      expect(document.body.textContent).toContain(
        `${kind === "actual" ? "实际" : "预计"} 2026-09-15`,
      );
      const contractLink = document.querySelector(`a[href^="/leases?contract=${uuid(900)}"]`);
      expect(contractLink).not.toBeNull();
      expect(
        new URL(contractLink!.getAttribute("href")!, "https://example.invalid").searchParams.get(
          "building",
        ),
      ).toBe(building);
    },
  );
  it("defaults to full-range floor cards without opening or eagerly reading an asset detail", async () => {
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("资产总览");
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelectorAll("[data-unit-card-id]")).toHaveLength(2);
    expect(drawer()).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("preserves concurrent sold, leased and cleaning conditions, leaving unknown occupancy unknown", async () => {
    await render();
    expect(card(uuid(100))?.textContent).toContain("已售");
    expect(card(uuid(100))?.textContent).toContain("长租占用");
    expect(card(uuid(100))?.textContent).toContain("维修中");
    expect(card(uuid(101))?.textContent).toContain("待核");
    expect(card(uuid(101))?.textContent).not.toMatch(/无当前占用|可出租|空置/);
    await selectFirst();
    await openDetails("资产资料");
    expect(drawer()?.textContent).toContain("待保洁");
  });
  it("selects the exact asset, updates its stable URL and does not read business/history until requested", async () => {
    await render();
    await selectFirst();
    expect(document.querySelector('[aria-label="资产 101 的档案"]')).not.toBeNull();
    expect(new URL(window.location.href).searchParams.get("unit")).toBe(uuid(100));
    expect(drawer()?.textContent).toContain("已售");
    await openDetails("业务配置与标准价");
    expect(drawer()?.textContent).toContain("业务配置待核对；不推定默认价格");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    await click(drawer()!.querySelector('button[aria-label="Close"]')!);
    expect(drawer()).toBeNull();
  });
  it("does not fabricate a default tariff or hide an explicitly configured zero tariff", async () => {
    const value = data();
    value.rows[0].flags = [
      { unit_id: uuid(100), business_type: "long_lease", is_enabled: true, default_price_xof: 0 },
      {
        unit_id: uuid(100),
        business_type: "daily_rental",
        is_enabled: false,
        default_price_xof: null,
      },
    ];
    await render(value);
    await selectFirst();
    await openDetails("业务配置与标准价");
    expect(drawer()?.querySelector('[aria-label="资产 101 的档案"]')?.textContent).toContain(
      "0 XOF",
    );
    expect(drawer()?.textContent).not.toContain("XOF XOF");
    expect(drawer()?.textContent).toContain("未配置价格");
  });
  it("immediately clears selected record and status editor when the project changes before the server response", async () => {
    await render(data(), true);
    await selectFirst();
    await openMaintenance();
    expect(
      document.querySelector("[data-condition-target]")?.getAttribute("data-condition-target"),
    ).toBe(uuid(100));
    const projectSelect = host.querySelector('[aria-label="资产项目"]') as HTMLSelectElement;
    await act(async () => {
      projectSelect.value = otherProject;
      projectSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.querySelector("[data-condition-target]")).toBeNull();
    expect(document.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining(`project=${otherProject}`), {
      scroll: false,
    });
    expect(
      new URL(mocks.push.mock.calls[0][0], "https://example.invalid").searchParams.has("unit"),
    ).toBe(false);
  });
  it("does not carry an open operation into a different server-selected asset or version", async () => {
    await render(data(), true);
    await selectFirst();
    await openMaintenance();
    expect(
      document.querySelector("[data-condition-target]")?.getAttribute("data-condition-target"),
    ).toBe(uuid(100));
    const next = data();
    next.selected = { ...row(1), unit: { ...row(1).unit, updated_at: "2026-10-20T12:00:00Z" } };
    next.query.unit = next.selected.unit.id;
    await render(next, true);
    expect(document.querySelector('[aria-label="资产 102 的档案"]')).not.toBeNull();
    expect(document.querySelector("[data-condition-target]")).toBeNull();
  });
  it("keeps maintenance behind more actions and returns from its single dialog to the selected asset", async () => {
    await render(data(), true);
    await selectFirst();
    const initialMore = [...document.querySelectorAll("details")].find(
      (item) => item.querySelector(":scope > summary")?.textContent === "更多操作",
    )!;
    expect(initialMore.open).toBe(false);
    const more = await openDetails("更多操作");
    expect(document.querySelector("[data-condition-target]")).toBeNull();
    expect(more.open).toBe(true);
    await click(button("核对 / 修改运行条件"));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    expect(
      document.querySelector("[data-condition-target]")?.getAttribute("data-condition-target"),
    ).toBe(uuid(100));
    await click(button("取消维护"));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(drawer()?.querySelector('[aria-label="资产 101 的档案"]')).toBeTruthy();
    expect(document.querySelector("[data-condition-target]")).toBeNull();
  });
  it.each(["permission", "version"] as const)(
    "clears a maintenance dialog after a %s change without leaving the selected detail hidden",
    async (change) => {
      await render(data(), true);
      await selectFirst();
      await openMaintenance();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      const next = data();
      next.selected = next.rows[0];
      next.query.unit = next.selected.unit.id;
      if (change === "version") {
        next.selected = {
          ...next.selected,
          unit: { ...next.selected.unit, updated_at: "2026-10-20T12:00:00Z" },
        };
        next.rows[0] = next.selected;
      }
      await render(next, change !== "permission");
      expect(document.querySelector("[data-condition-target]")).toBeNull();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(drawer()?.querySelector('[aria-label="资产 101 的档案"]')).toBeTruthy();
      if (change === "permission") {
        await openDetails("更多操作");
        expect(button("核对 / 修改运行条件")).toBeUndefined();
      }
    },
  );
  it("binds selection to scope/result props and does not retain the previous asset on a new scope", async () => {
    await render();
    await selectFirst();
    const next = data();
    next.query.project = otherProject;
    next.query.building = otherBuilding;
    next.building = next.buildings[1];
    next.rows = [];
    await render(next);
    expect(document.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    expect(drawer()).toBeNull();
  });
  it("retains invalid scope/selection distinctions rather than selecting an arbitrary first row", async () => {
    const value = data();
    value.selectedUnavailable = true;
    await render(value);
    expect(host.textContent).toContain("指定资产不存在、不可见或与当前范围不符");
    expect(document.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    await render({ ...data(), scopeUnavailable: true, building: null });
    expect(host.textContent).toContain("指定的项目或楼栋不可用");
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelectorAll("[data-unit-card-id]")).toHaveLength(0);
    expect(drawer()).toBeNull();
  });
  it("renders every filtered room across floors beyond the legacy page size without inventing a tenant or rent", async () => {
    const value = data();
    value.rows = Array.from({ length: UNIT_WORKBENCH_PAGE_SIZE + 3 }, (_, index) =>
      row(index, {
        unit: { ...row(index).unit, floor_label: index < 30 ? "1F" : "2F" },
      }),
    );
    value.rows[1] = row(1, { position: null, unit: { ...row(1).unit, occupancy_verified: false } });
    value.rows[2] = row(2, {
      unit: { ...row(2).unit, status: "available" },
      position: {
        ownership: "unspecified",
        operational_condition: "normal",
        daily_occupied: false,
        lease_occupied: false,
        cleaning_pending: false,
        daily_enabled: false,
        lease_enabled: false,
      },
    });
    value.total = value.rows.length;
    value.scopeTotal = value.rows.length;
    await render(value);
    expect(host.querySelector("table")).toBeNull();
    const cards = [...host.querySelectorAll("[data-unit-card-id]")];
    expect(cards).toHaveLength(UNIT_WORKBENCH_PAGE_SIZE + 3);
    expect(new Set(cards.map((item) => item.getAttribute("data-unit-card-id"))).size).toBe(
      cards.length,
    );
    expect(card(value.rows.at(-1)!.unit.id)).toBeTruthy();
    expect(host.textContent).toContain("1F");
    expect(host.textContent).toContain("2F");
    expect(card(uuid(100))?.textContent).toContain("已售");
    expect(card(uuid(100))?.textContent).toContain("长租占用");
    expect(card(uuid(101))?.textContent).not.toMatch(/无当前占用|可出租|空置/);
    expect(card(uuid(102))?.textContent).not.toMatch(/租客|XOF|CNY|USD|可出租/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("normalizes a legacy paginated list link without presenting that partial page as the full floor view", async () => {
    const value = data();
    value.query.view = "list";
    value.query.page = 3;
    value.selected = value.rows[0];
    value.query.unit = value.selected.unit.id;
    value.query.returnTo = `/leases?contract=${uuid(900)}`;
    value.total = 123;
    await render(value);
    expect(mocks.replace).toHaveBeenCalledOnce();
    const href = new URL(mocks.replace.mock.calls[0][0], "https://example.invalid");
    expect(href.searchParams.get("view")).not.toBe("list");
    expect(href.searchParams.get("page")).toBeNull();
    expect(href.searchParams.get("unit")).toBe(uuid(100));
    expect(href.searchParams.get("returnTo")).toBe(value.query.returnTo);
    expect(host.querySelectorAll("[data-unit-card-id]")).toHaveLength(0);
    const next = data();
    next.selected = next.rows[0];
    next.query.unit = uuid(100);
    next.query.returnTo = value.query.returnTo;
    await render(next);
    expect(host.querySelectorAll("[data-unit-card-id]")).toHaveLength(2);
    expect(drawer()?.querySelector('[aria-label="资产 101 的档案"]')).toBeTruthy();
  });
  it("gates state actions to existing admin permission and hides sale setup for CIMAC", async () => {
    const value = data();
    value.building = value.buildings[1];
    value.query.building = otherBuilding;
    value.query.project = otherProject;
    await render(value);
    await selectFirst();
    expect(button("核对 / 修改运行条件")).toBeUndefined();
    await openDetails("业务配置与标准价");
    expect(drawer()?.textContent).toContain("CIMAC 只租不卖");
    expect(host.querySelector('select[name="business"] option[value="sale"]')).toBeNull();
  });
  it("uses the existing status audit service only after opening history and shows explicit failures", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("offline"));
    await render();
    await selectFirst();
    await click(button("变更记录"));
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(uuid(100));
    expect(document.body.textContent).toContain("状态历史读取失败");
    expect(document.body.textContent).not.toContain("暂无可见的状态变更记录");
    await click(button("重试"));
    expect(document.body.textContent).toContain("暂无可见的状态变更记录");
  });
  it("requests exact-scoped relations only when the business tab opens and distinguishes guest/agent links", async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          unitId: uuid(100),
          buildingId: building,
          projectId: project,
          total: 1,
          page: 1,
          relations: [
            {
              id: uuid(900),
              type: "daily",
              contractNo: null,
              status: "checked_in",
              start: "2026-10-19",
              end: null,
              endDateKind: null,
              endConfirmed: false,
              customerId: uuid(901),
              customerName: "Guest Alice",
              agentId: uuid(902),
              agentName: "Agent Bob",
            },
          ],
        }),
      ),
    );
    await render();
    await selectFirst();
    await click(button("业务记录"));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toContain(`unit=${uuid(100)}`);
    expect(fetcher.mock.calls[0][0]).toContain(`building=${building}`);
    expect(fetcher.mock.calls[0][0]).toContain(`project=${project}`);
    expect(document.body.textContent).toContain("实际住客 · Guest Alice");
    expect(document.body.textContent).toContain("代订 / 经办 · Agent Bob");
    const links = [...document.querySelectorAll("a")];
    expect(links.some((link) => link.href.includes(`customer=${uuid(901)}`))).toBe(true);
    expect(links.some((link) => link.href.includes(`customer=${uuid(902)}`))).toBe(true);
  });
  it("does not display stale late context after selecting another asset", async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    await render();
    await selectFirst();
    await click(button("业务记录"));
    await click(drawer()!.querySelector('button[aria-label="Close"]')!);
    await click(host.querySelector('[aria-label="查看资产 102"]')!);
    await act(async () =>
      resolve(
        new Response(
          JSON.stringify({
            unitId: uuid(100),
            buildingId: building,
            projectId: project,
            total: 0,
            page: 1,
            relations: [],
          }),
        ),
      ),
    );
    expect(document.querySelector('[aria-label="资产 102 的档案"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("合同与入住关系 · 0");
  });
  it("rejects external return links while preserving a safe source and exact complete profile link", async () => {
    const value = data();
    value.query.returnTo = "https://evil.invalid";
    await render(value);
    expect(host.textContent).not.toContain("返回来源工作区");
    value.query.returnTo = `/sales?contract=${uuid(900)}`;
    await render(value);
    await selectFirst();
    expect(document.querySelector('a[href^="/sales?"]')).not.toBeNull();
    await openDetails("更多操作");
    expect(document.querySelector(`a[href^="/units/${uuid(100)}?returnTo="]`)).not.toBeNull();
  });
  it("renders the same workbench in French without granting editing", async () => {
    await render(data(), false, "fr");
    expect(host.querySelector("h1")?.textContent).toBe("Vue des actifs");
    expect(host.querySelector('[aria-label="Voir l’actif 101"]')).not.toBeNull();
    expect(host.querySelector("form")?.getAttribute("action")).toBe("/fr/units");
    await click(host.querySelector('[aria-label="Voir l’actif 101"]')!);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(drawer()?.querySelector('[aria-label="Dossier de 101"]')).toBeTruthy();
    const more = await openDetails("Autres opérations");
    expect(more.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelector("[data-condition-target]")).toBeNull();
  });
});
