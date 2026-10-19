// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnitWorkbench } from "@/features/units/unit-workbench";
import {
  parseUnitWorkbenchQuery,
  type UnitWorkbenchData,
  type UnitWorkbenchRecord,
} from "@/features/units/unit-workbench-model";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
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
    ({ unit }: { unit: { id: string } }) => (
      <div data-condition-target={unit.id}>原运行条件操作</div>
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
    total: 123,
    scopeTotal: 300,
    summary: { occupied: 120, attention: 40, unverified: 9 },
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
  [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
const selectFirst = async () => click(host.querySelector('[aria-label="查看资产 101"]')!);

describe("asset directory UI", () => {
  it.each([false, true])(
    "focuses and scrolls the selected asset on narrow screens, respecting reduced motion %s",
    async (reducedMotion) => {
      const frames: FrameRequestCallback[] = [];
      const frame = vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("requestAnimationFrame", frame);
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches:
            query === "(max-width: 1199px)" ||
            (query === "(prefers-reduced-motion: reduce)" && reducedMotion),
        })),
      );
      await render();
      const target = host.querySelector('[aria-label="选中资产详情区域"]') as HTMLDivElement;
      const focus = vi.spyOn(target, "focus");
      target.scrollIntoView = vi.fn();
      await selectFirst();
      expect(focus).not.toHaveBeenCalled();
      expect(frame).toHaveBeenCalledOnce();
      await act(async () => frames[0](0));
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(document.activeElement).toBe(target);
      expect(target.scrollIntoView).toHaveBeenCalledWith({
        block: "start",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    },
  );
  it("does not reposition the desktop inspector or automatically steal focus for an SSR deep link", async () => {
    const frame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", frame);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    const value = data();
    value.selected = value.rows[0];
    value.query.unit = value.selected.unit.id;
    await render(value);
    const target = host.querySelector('[aria-label="选中资产详情区域"]') as HTMLDivElement;
    const focus = vi.spyOn(target, "focus");
    expect(button("查看选中资产详情")).toBeTruthy();
    expect(frame).not.toHaveBeenCalled();
    await selectFirst();
    expect(frame).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
  it("gives a narrow-screen deep link an explicit detail jump without automatic focus on refresh", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query === "(max-width: 1199px)" })),
    );
    const value = data();
    value.selected = value.rows[0];
    value.query.unit = value.selected.unit.id;
    await render(value);
    const target = host.querySelector('[aria-label="选中资产详情区域"]') as HTMLDivElement;
    target.scrollIntoView = vi.fn();
    expect(frames).toHaveLength(0);
    const jump = button("查看选中资产详情");
    expect(jump.getAttribute("aria-controls")).toBe(target.id);
    await click(jump);
    await act(async () => frames[0](0));
    expect(document.activeElement).toBe(target);
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
  });
  it("does not focus a stale animation-frame target after a project change clears selection", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    await render();
    const target = host.querySelector('[aria-label="选中资产详情区域"]') as HTMLDivElement;
    const focus = vi.spyOn(target, "focus");
    target.scrollIntoView = vi.fn();
    await selectFirst();
    const projectSelect = host.querySelector('[aria-label="资产项目"]') as HTMLSelectElement;
    await act(async () => {
      projectSelect.value = otherProject;
      projectSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => frames[0](0));
    expect(focus).not.toHaveBeenCalled();
    expect(target.scrollIntoView).not.toHaveBeenCalled();
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
      await click(button("业务关联"));
      expect(host.textContent).toContain(`${kind === "actual" ? "实际" : "预计"} 2026-09-15`);
      const contractLink = host.querySelector(`a[href^="/leases?contract=${uuid(900)}"]`);
      expect(contractLink).not.toBeNull();
      expect(
        new URL(contractLink!.getAttribute("href")!, "https://example.invalid").searchParams.get(
          "building",
        ),
      ).toBe(building);
    },
  );
  it("shows a compact four-column catalogue with full-building summary and no eager detail/history calls", async () => {
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("资产目录");
    expect(host.querySelectorAll("th")).toHaveLength(4);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.textContent).toContain("300");
    expect(host.textContent).toContain("123 / 300");
    expect(host.textContent).toContain("选一项资产");
    expect(host.textContent).toContain("不随下方筛选变化");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("preserves concurrent sold, leased and cleaning conditions, leaving unknown occupancy unknown", async () => {
    await render();
    expect(host.querySelector("tbody")?.textContent).toContain("已售");
    expect(host.querySelector("tbody")?.textContent).toContain("长租占用");
    expect(host.querySelector("tbody")?.textContent).toContain("待保洁");
    expect(host.querySelector("tbody")?.textContent).toContain("占用待核实");
    expect(host.querySelector("tbody")?.textContent).not.toContain("可出租");
  });
  it("selects the exact asset, updates its stable URL and does not read business/history until requested", async () => {
    await render();
    await selectFirst();
    expect(host.querySelector('[aria-label="资产 101 的档案"]')).not.toBeNull();
    expect(new URL(window.location.href).searchParams.get("unit")).toBe(uuid(100));
    expect(host.textContent).toContain("已售（业务口径）");
    expect(host.textContent).toContain("业务配置待核对；不推定默认价格");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    await click(host.querySelector('[aria-label="关闭资产档案"]')!);
    expect(host.textContent).toContain("选一项资产");
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
    expect(host.querySelector('[aria-label="资产 101 的档案"]')?.textContent).toContain("0 XOF");
    expect(host.textContent).not.toContain("XOF XOF");
    expect(host.textContent).toContain("未配置价格");
  });
  it("immediately clears selected record and status editor when the project changes before the server response", async () => {
    await render(data(), true);
    await selectFirst();
    await click(button("核对 / 修改运行条件"));
    expect(
      host.querySelector("[data-condition-target]")?.getAttribute("data-condition-target"),
    ).toBe(uuid(100));
    const projectSelect = host.querySelector('[aria-label="资产项目"]') as HTMLSelectElement;
    await act(async () => {
      projectSelect.value = otherProject;
      projectSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector("[data-condition-target]")).toBeNull();
    expect(host.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining(`project=${otherProject}`), {
      scroll: false,
    });
    expect(
      new URL(mocks.push.mock.calls[0][0], "https://example.invalid").searchParams.has("unit"),
    ).toBe(false);
  });
  it("binds selection to scope/result props and does not retain the previous asset on a new scope", async () => {
    await render();
    await selectFirst();
    const next = data();
    next.query.project = otherProject;
    next.query.building = otherBuilding;
    next.building = next.buildings[1];
    next.rows = [];
    await render(next);
    expect(host.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    expect(host.textContent).toContain("选一项资产");
  });
  it("retains invalid scope/selection distinctions rather than selecting an arbitrary first row", async () => {
    const value = data();
    value.selectedUnavailable = true;
    await render(value);
    expect(host.textContent).toContain("指定资产不存在、不可见或与当前范围不符");
    expect(host.querySelector('[aria-label="资产 101 的档案"]')).toBeNull();
    await render({ ...data(), scopeUnavailable: true, building: null });
    expect(host.textContent).toContain("指定的项目或楼栋不可用");
    expect(host.querySelector("table")).toBeNull();
  });
  it("uses a labeled paginated floor index rather than claiming an architectural floor plan", async () => {
    const value = data();
    value.query.view = "floor";
    await render(value);
    expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).toContain("仅当前分页，房号排列不表示真实空间位置");
    expect(host.querySelector('[data-unknown="true"]')).not.toBeNull();
  });
  it("gates state actions to existing admin permission and hides sale setup for CIMAC", async () => {
    const value = data();
    value.building = value.buildings[1];
    value.query.building = otherBuilding;
    value.query.project = otherProject;
    await render(value);
    await selectFirst();
    expect(button("核对 / 修改运行条件")).toBeUndefined();
    expect(host.textContent).toContain("CIMAC 只租不卖");
    expect(host.querySelector('select[name="business"] option[value="sale"]')).toBeNull();
  });
  it("uses the existing status audit service only after opening history and shows explicit failures", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("offline"));
    await render();
    await selectFirst();
    await click(button("状态历史"));
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(uuid(100));
    expect(host.textContent).toContain("状态历史读取失败");
    expect(host.textContent).not.toContain("暂无可见的状态变更记录");
    await click(button("重试"));
    expect(host.textContent).toContain("暂无可见的状态变更记录");
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
    await click(button("业务关联"));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toContain(`unit=${uuid(100)}`);
    expect(fetcher.mock.calls[0][0]).toContain(`building=${building}`);
    expect(fetcher.mock.calls[0][0]).toContain(`project=${project}`);
    expect(host.textContent).toContain("实际住客 · Guest Alice");
    expect(host.textContent).toContain("代订 / 经办 · Agent Bob");
    const links = [...host.querySelectorAll("a")];
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
    await click(button("业务关联"));
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
    expect(host.querySelector('[aria-label="资产 102 的档案"]')).not.toBeNull();
    expect(host.textContent).not.toContain("合同与入住关系 · 0");
  });
  it("rejects external return links while preserving a safe source and exact complete profile link", async () => {
    const value = data();
    value.query.returnTo = "https://evil.invalid";
    await render(value);
    expect(host.textContent).not.toContain("返回来源工作区");
    value.query.returnTo = `/sales?contract=${uuid(900)}`;
    await render(value);
    await selectFirst();
    expect(host.querySelector('a[href^="/sales?"]')).not.toBeNull();
    expect(host.querySelector(`a[href^="/units/${uuid(100)}?returnTo="]`)).not.toBeNull();
  });
  it("renders the same workbench in French without granting editing", async () => {
    await render(data(), false, "fr");
    expect(host.querySelector("h1")?.textContent).toBe("Répertoire des actifs");
    expect(host.querySelector('[aria-label="Voir l’actif 101"]')).not.toBeNull();
    expect(host.querySelector("form")?.getAttribute("action")).toBe("/fr/units");
  });
});
