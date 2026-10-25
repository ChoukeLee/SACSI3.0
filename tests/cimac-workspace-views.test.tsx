// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CimacHomeView } from "@/features/cimac/cimac-home-view";
import { CimacCustomerView } from "@/features/cimac/cimac-customer-view";
import { CimacAssetView } from "@/features/cimac/cimac-asset-view";
import {
  CimacAssetDirectoryView,
  CimacCustomerDirectoryView,
} from "@/features/cimac/cimac-directory-view";
import {
  CimacFacts,
  cimacConstruction,
  cimacDate,
  cimacNumber,
  cimacOccupancy,
} from "@/features/cimac/cimac-view-parts";
import { cimacAssetCounts } from "@/features/cimac/cimac-workspace-model";
import {
  cimacWorkspaceHref,
  parseCimacWorkspaceQuery,
} from "@/features/cimac/cimac-workspace-query";
import type {
  CimacAssetData,
  CimacAssetDirectoryData,
  CimacAssetSummary,
  CimacCustomerData,
  CimacCustomerDirectoryData,
  CimacHomeData,
  CimacWorkspaceScope,
} from "@/features/cimac/cimac-workspace-types";
import type { UnitRow } from "@/types/database";

vi.mock("@/features/cimac/cimac-profile-operations", () => ({
  CimacCustomerProfileOperation: ({ locale }: { locale: string }) => (
    <button>{locale === "zh" ? "编辑客户资料" : "Modifier la fiche client"}</button>
  ),
  CimacAssetConditionOperation: () => <button>维护运行条件</button>,
  CimacCustomerCreateOperation: ({ locale }: { locale: string }) => (
    <button>{locale === "zh" ? "新建客户" : "Nouveau client"}</button>
  ),
}));
vi.mock("@/features/cimac/cimac-customer-management", () => ({
  CimacCustomerManagement: () => <button>维护园区名册与铺位关联</button>,
}));

vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props} />,
}));

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-25T10:30:00Z";
const scope: CimacWorkspaceScope = {
  project: { id: id(1), code: "CIMAC", displayName: "科建建材城" },
  buildings: [
    {
      id: id(2),
      code: "B1",
      name: "商业区B1栋",
      constructionStatus: "operational",
      isActive: true,
    },
    { id: id(3), code: "A1", name: "公寓A1栋", constructionStatus: null, isActive: true },
  ],
};
const asset = (patch: Partial<CimacAssetSummary> = {}): CimacAssetSummary => ({
  id: id(4),
  code: "CIMAC-B1-101",
  unitNo: "101",
  kind: "storefront",
  assetSubtype: "commercial_shop",
  buildingId: id(2),
  buildingName: "商业区B1栋",
  buildingCode: "B1",
  floorLabel: "G",
  areaSqm: 64,
  updatedAt: stamp,
  constructionStatus: "operational",
  occupancyVerified: true,
  position: {
    ownership: "unspecified",
    operational_condition: "normal",
    daily_occupied: false,
    lease_occupied: true,
    cleaning_pending: false,
    daily_enabled: false,
    lease_enabled: true,
  },
  attentionReasons: [],
  handover: { status: "unknown", date: null },
  opening: { status: "unknown", date: null },
  ...patch,
});
const secondAsset = () =>
  asset({
    id: id(8),
    code: "CIMAC-A1-101",
    buildingId: id(3),
    buildingName: "公寓A1栋",
    buildingCode: "A1",
    kind: "apartment",
    areaSqm: null,
    constructionStatus: null,
    occupancyVerified: null,
    position: null,
    attentionReasons: ["construction_unverified", "occupancy_unverified"],
  });
const summary = () => ({
  id: id(5),
  name: "测试商户",
  phone: null,
  isBlacklisted: false,
  hasDocument: true,
  roles: ["lease" as const],
  rooms: ["B1-101"],
  roomCount: 80,
  relationshipCount: 100,
  lastBusinessDate: "2026-10-20",
});
const customer = (query = parseCimacWorkspaceQuery({}, "customers")): CimacCustomerData => ({
  scope,
  query,
  summary: summary(),
  profile: {
    id: id(5),
    name: "测试商户",
    gender: null,
    document_type: null,
    phone: null,
    notes: null,
    is_blacklisted: false,
    blacklist_reason: null,
    blacklist_operator_id: null,
    blacklist_date: null,
    blacklist_permanent: false,
    created_at: stamp,
    updated_at: stamp,
    hasDocument: true,
  },
  relations: [
    {
      id: id(6),
      role: "lease",
      unitId: id(4),
      unitNo: "101",
      buildingId: id(2),
      buildingLabel: "商业区B1栋",
      projectId: id(1),
      code: "CIMAC-L001",
      startDate: "2026-10-01",
      endDate: "2029-03-31",
      endDateKind: "expected",
      status: "active",
    },
  ],
  relationPage: query.relationPage,
  relationTotal: 100,
  pageSize: 25,
});
const assetData = (query = parseCimacWorkspaceQuery()): CimacAssetData => ({
  scope,
  query,
  asset: asset(),
  relationPage: query.relationPage,
  relationTotal: 45,
  pageSize: 30,
  relations: [
    {
      id: id(6),
      type: "lease",
      contractNo: "CIMAC-L001",
      status: "active",
      start: "2026-10-01",
      end: "2029-03-31",
      endDateKind: "expected",
      endConfirmed: false,
      customerId: id(5),
      customerName: "测试商户",
      agentId: null,
      agentName: null,
    },
  ],
});
const homeData = (): CimacHomeData => ({
  scope,
  assetSummary: { ...cimacAssetCounts([asset(), secondAsset()]), total: 120 },
  customerCount: 42,
  attentionTotal: 7,
  attention: [secondAsset()],
  assetIndex: [asset(), secondAsset()],
  readAt: stamp,
});
const customerDirectory = (
  query = parseCimacWorkspaceQuery(
    { q: "测试", building: id(2), filter: "contract", page: "2" },
    "customers",
  ),
): CimacCustomerDirectoryData => ({
  scope,
  query,
  rows: [summary()],
  total: 90,
  page: query.page,
  pageSize: 40,
});
const assetDirectory = (
  query = parseCimacWorkspaceQuery({
    q: "101",
    building: id(2),
    kind: "storefront",
    filter: "attention",
    page: "2",
  }),
): CimacAssetDirectoryData => ({
  scope,
  query,
  rows: [asset(), secondAsset()],
  summary: cimacAssetCounts([asset(), secondAsset()]),
  total: 120,
  page: query.page,
  pageSize: 50,
});
let host: HTMLDivElement;
let accountRendered = 0;
function AccountFixture() {
  accountRendered += 1;
  return <div data-testid="real-account-section">真实客户账务模块</div>;
}
function render(element: ReactElement) {
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}
function link(label: string) {
  const anchor = [...host.querySelectorAll("a")].find(
    (node) => node.textContent?.trim() === label || node.textContent?.trim().startsWith(label),
  );
  expect(anchor, `Missing link ${label}`).toBeDefined();
  return new URL(anchor!.getAttribute("href")!, "https://example.test");
}
beforeEach(() => {
  host = document.createElement("div");
  accountRendered = 0;
});

describe("CIMAC workspace home uses current scoped facts", () => {
  it("uses full totals, not limited preview lengths or mockup numbers", () => {
    render(<CimacHomeView data={homeData()} locale="zh" />);
    expect(host.textContent).toContain("120项已登记资产");
    expect(host.textContent).toContain("42位关联客户");
    expect(host.textContent).toContain("7项资产状态需核对");
    expect(host.textContent).toContain("索引展示 2 项");
    expect(host.textContent).toContain("不是已分派工单");
    expect(host.textContent).not.toMatch(/14:00|张馨月|处理完成率/);
  });
  it("identifies a room by building and preserves locale and home return", () => {
    render(<CimacHomeView data={homeData()} locale="fr" />);
    const target = link("商业区B1栋 · 101");
    expect(target.pathname).toBe(`/fr/cimac/assets/${id(4)}`);
    expect(target.searchParams.get("returnTo")).toBe("/fr/cimac");
    expect(host.textContent).toContain("公寓A1栋 · 101");
  });
  it("does not invent activity when no recorded update time exists", () => {
    const data = homeData();
    data.assetIndex = data.assetIndex.map((row) => ({ ...row, updatedAt: null }));
    render(<CimacHomeView data={data} locale="zh" />);
    expect(host.querySelectorAll("time")).toHaveLength(0);
    expect(host.textContent).toContain("不以示例动态补充");
  });
  it("labels its limited saved-record feed, not a business audit", () => {
    render(<CimacHomeView data={homeData()} locale="zh" />);
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe(stamp);
    expect(host.textContent).toContain("不是完整操作审计");
    expect(host.textContent).toContain("更新时间不表示已交付");
  });
});

describe("CIMAC directories preserve navigation context", () => {
  it("exposes a real create operation only to customer writers, not read-only directory viewers", () => {
    render(
      <CimacCustomerDirectoryView
        data={customerDirectory()}
        locale="zh"
        canEdit
        canCreateContract
      />,
    );
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "新建客户"),
    ).toBe(true);
    expect(link("办理合同").pathname).toBe("/cimac/contracts");
    expect(host.textContent).not.toContain("办理合同 / 新增客户");
    render(<CimacCustomerDirectoryView data={customerDirectory()} locale="zh" />);
    expect(host.textContent).not.toContain("新建客户");
  });
  it("does not add customer creation into a read-only account chooser", () => {
    render(
      <CimacCustomerDirectoryView data={customerDirectory()} locale="fr" canEdit accountLinks />,
    );
    expect(host.textContent).not.toContain("Nouveau client");
  });
  it("keeps identity creation separate from read-only contract access for finance", () => {
    render(
      <CimacCustomerDirectoryView
        data={customerDirectory()}
        locale="zh"
        canEdit
        canCreateContract={false}
      />,
    );
    expect(host.textContent).toContain("新建客户");
    expect(link("查看合同").pathname).toBe("/cimac/contracts");
    expect(host.textContent).not.toContain("办理合同");
  });
  it("preserves customer filters and page in detail return and pagination", () => {
    render(<CimacCustomerDirectoryView data={customerDirectory()} locale="zh" />);
    const target = link("测试商户");
    expect(target.pathname).toBe(`/cimac/customers/${id(5)}`);
    const back = new URL(target.searchParams.get("returnTo")!, "https://example.test");
    expect(Object.fromEntries(back.searchParams)).toMatchObject({
      q: "测试",
      building: id(2),
      filter: "contract",
      page: "2",
    });
    expect(link("下一页").searchParams.get("page")).toBe("3");
    expect(link("下一页").searchParams.get("q")).toBe("测试");
  });
  it("keeps finance chooser and pagination within the financial entry", () => {
    render(<CimacCustomerDirectoryView data={customerDirectory()} locale="fr" accountLinks />);
    expect(host.querySelector("h1")?.textContent).toBe("Encaissements et trésorerie");
    const target = link("测试商户");
    expect(target.searchParams.get("tab")).toBe("account");
    expect(new URL(target.searchParams.get("returnTo")!, "https://example.test").pathname).toBe(
      "/fr/cimac/finance",
    );
    expect(link("Suivant").pathname).toBe("/fr/cimac/finance");
    expect(host.querySelector("form")?.getAttribute("action")).toBe("/fr/cimac/finance");
  });
  it("does not equate an empty filter to no park customers", () => {
    render(
      <CimacCustomerDirectoryView
        data={{ ...customerDirectory(), rows: [], total: 0 }}
        locale="zh"
      />,
    );
    expect(host.textContent).toContain("不表示整个园区没有客户");
  });
  it("uses GET query controls that reset the directory page", () => {
    render(<CimacAssetDirectoryView data={assetDirectory()} locale="zh" />);
    const form = host.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/cimac/assets");
    expect([...form.querySelectorAll("[name]")].map((node) => node.getAttribute("name"))).toEqual([
      "q",
      "building",
      "kind",
      "filter",
    ]);
    expect(form.querySelector("[name=page]")).toBeNull();
    expect(link("下一页").searchParams.get("building")).toBe(id(2));
  });
  it("distinguishes identical room numbers in two buildings and asset IDs", () => {
    render(<CimacAssetDirectoryView data={assetDirectory()} locale="zh" />);
    expect(link("商业区B1栋 · 101").pathname).toBe(`/cimac/assets/${id(4)}`);
    expect(link("公寓A1栋 · 101").pathname).toBe(`/cimac/assets/${id(8)}`);
    expect(host.textContent).toContain("占用待核");
    expect(host.textContent).not.toContain("可立即出租");
  });
});

describe("CIMAC customer detail separates overview, operations and accounts", () => {
  it("shows effective documentary links per brand without routing a park link as a lease or using hashes as headings", () => {
    const data = customer(parseCimacWorkspaceQuery({ tab: "contracts" }, "customers"));
    data.relations = [
      {
        ...data.relations[0],
        role: "park_link",
        status: "signed_effective",
        brand: "箭牌卫浴",
        relationshipKind: "signed_contract",
        signingState: "signed_effective",
        signedDate: null,
        sourceReference: "HASH_SOURCE_" + "a".repeat(64),
      },
      {
        ...data.relations[0],
        id: id(30),
        unitId: id(31),
        unitNo: "601",
        brand: "马可波罗",
        status: "draft",
        relationshipKind: "signed_contract",
        signingState: "signed_effective",
        signedDate: "2026-10-12",
        sourceReference: "另一份已核合同",
      },
    ];
    render(<CimacCustomerView data={data} locale="zh" />);
    expect(host.textContent).toContain("箭牌卫浴");
    expect(host.textContent).toContain("马可波罗");
    expect(host.textContent).toContain("已生效合同资料");
    expect(host.textContent).toContain("草稿");
    expect(
      [...host.querySelectorAll("h3")].every((h) => !h.textContent?.includes("HASH_SOURCE")),
    ).toBe(true);
    expect(host.querySelector("details")?.textContent).toContain("HASH_SOURCE");
    expect(
      [...host.querySelectorAll("a")].filter((a) => a.textContent === "办理合同"),
    ).toHaveLength(1);
  });
  it("offers administrative management only when explicitly authorized and keeps zero-link archived history visible", () => {
    const data = customer();
    data.profile.membershipStatus = "archived";
    data.summary.roomCount = 0;
    data.summary.relationshipCount = 0;
    data.relations = [];
    data.relationTotal = 0;
    render(<CimacCustomerView data={data} locale="zh" />);
    expect(host.textContent).toContain("园区已归档");
    expect(host.textContent).not.toContain("维护园区名册与铺位关联");
    render(<CimacCustomerView data={data} locale="zh" canManage />);
    expect(host.textContent).toContain("维护园区名册与铺位关联");
  });
  it("uses complete business relation counts without claiming 100 contracts", () => {
    render(<CimacCustomerView data={customer()} locale="zh" />);
    expect(host.textContent).toContain("80 处关联资产");
    expect(host.textContent).toContain("100 条业务关联");
    expect(host.textContent).toContain("本页 1 条 / 共 100 条业务关联");
    expect(host.textContent).not.toContain("100 份合同");
  });
  it("returns from an asset to the exact customer tab and relation page", () => {
    const data = customer(
      parseCimacWorkspaceQuery(
        { tab: "contracts", relationPage: "2", q: "测试", page: "3" },
        "customers",
      ),
    );
    render(<CimacCustomerView data={data} locale="zh" />);
    const target = link("查看资产");
    const back = new URL(target.searchParams.get("returnTo")!, "https://example.test");
    expect(back.pathname).toBe(`/cimac/customers/${id(5)}`);
    expect(Object.fromEntries(back.searchParams)).toMatchObject({
      tab: "contracts",
      relationPage: "2",
      q: "测试",
      page: "3",
    });
    expect(target.searchParams.has("q")).toBe(false);
  });
  it("retains account subtab in cross-page return without copying it into asset query", () => {
    const data = customer(parseCimacWorkspaceQuery({ accountTab: "meters" }, "customers"));
    render(<CimacCustomerView data={data} locale="zh" />);
    const target = link("商业区B1栋 · 101");
    expect(target.searchParams.has("accountTab")).toBe(false);
    expect(
      new URL(target.searchParams.get("returnTo")!, "https://example.test").searchParams.get(
        "accountTab",
      ),
    ).toBe("meters");
  });
  it("renders only the requested tab and does not preload the account slot", () => {
    render(<CimacCustomerView data={customer()} locale="zh" accountSection={<AccountFixture />} />);
    expect(accountRendered).toBe(0);
    const data = customer(parseCimacWorkspaceQuery({ tab: "account" }, "customers"));
    render(<CimacCustomerView data={data} locale="zh" accountSection={<AccountFixture />} />);
    expect(accountRendered).toBe(1);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelectorAll("[data-testid=real-account-section]")).toHaveLength(1);
    expect(host.textContent).not.toContain("当前跟进范围");
  });
  it("hides account navigation and never renders a forbidden account slot", () => {
    const data = customer(parseCimacWorkspaceQuery({ tab: "account" }, "customers"));
    render(
      <CimacCustomerView
        data={data}
        locale="zh"
        canReadAccount={false}
        accountSection={<AccountFixture />}
      />,
    );
    expect(accountRendered).toBe(0);
    expect(host.querySelector("nav[aria-label='客户详情分区']")?.textContent).not.toContain(
      "账务与收费",
    );
    expect(host.textContent).toContain("未以零余额替代");
  });
  it("keeps client editing and lease operations inside the independent workspace", () => {
    const data = customer(parseCimacWorkspaceQuery({ tab: "contracts" }, "customers"));
    render(<CimacCustomerView data={data} locale="fr" canEdit />);
    const original = link("Gérer le contrat");
    expect(original.pathname).toBe("/fr/cimac/contracts");
    expect(Object.fromEntries(original.searchParams)).toMatchObject({
      building: id(2),
      contract: id(6),
    });
    expect(original.searchParams.get("returnTo")).toContain(`/fr/cimac/customers/${id(5)}`);
    expect(host.textContent).toContain("Modifier la fiche client");
    expect(host.querySelector('a[href^="/fr/customers"]')).toBeNull();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelectorAll("form")).toHaveLength(0);
  });
  it("does not expose editing links when canEdit is omitted", () => {
    render(<CimacCustomerView data={customer()} locale="zh" />);
    expect(host.textContent).not.toContain("编辑客户资料");
  });
  it("shows notes only as escaped facts, not instructions or completed actions", () => {
    const data = customer(parseCimacWorkspaceQuery({ tab: "records" }, "customers"));
    data.profile.notes = "<script>transferMoney()</script>";
    render(<CimacCustomerView data={data} locale="zh" />);
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("<script>transferMoney()</script>");
    expect(host.textContent).toContain("备注不代表已确认的收费或交付指令");
  });
  it("does not fabricate contact or property ownership from lease relations", () => {
    render(<CimacCustomerView data={customer()} locale="zh" />);
    expect(host.textContent).toContain("非产权依据");
    const facts = [...host.querySelectorAll("dl > div")];
    expect(
      facts.find((row) => row.querySelector("dt")?.textContent === "联系电话")?.querySelector("dd")
        ?.textContent,
    ).toBe("待核");
    expect(host.textContent).not.toMatch(/00000000|已确认产权人/);
  });
});

describe("CIMAC asset detail keeps physical and business states independent", () => {
  it("shows four separate states without treating a lease as delivery or opening", () => {
    render(<CimacAssetView data={assetData()} locale="zh" />);
    const state = host.querySelector("dl[aria-label='资产独立状态']")!;
    expect([...state.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
      "建设条件",
      "租赁占用",
      "交付验收",
      "开业 / 使用",
    ]);
    expect(state.textContent).toContain("租约占用");
    expect(state.textContent).toContain("不由租约推断");
    expect(state.textContent).not.toMatch(/已交付|已开业/);
  });
  it("keeps missing area and unloaded readings unknown rather than zero", () => {
    const data = assetData(parseCimacWorkspaceQuery({ tab: "service" }));
    data.asset = secondAsset();
    render(<CimacAssetView data={data} locale="zh" />);
    expect(host.querySelector("header")?.textContent).toContain("登记面积 — m²");
    expect(host.textContent).toContain("没有展示不代表用量为零");
    expect(host.textContent).not.toMatch(/登记面积 0|用量 0|W-DEMO/);
  });
  it("does not promote an unconfirmed contract end into a confirmed date", () => {
    render(
      <CimacAssetView
        data={assetData(parseCimacWorkspaceQuery({ tab: "contracts" }))}
        locale="zh"
      />,
    );
    expect(host.textContent).toContain("预计止日 待确认");
    expect(host.textContent).not.toContain("2029-03-31");
    expect(host.textContent).toContain("租赁关联，不代表产权");
  });
  it("preserves customer context and exposes an inline condition operation only with permission", () => {
    render(
      <CimacAssetView
        data={assetData()}
        locale="zh"
        canEdit
        operationUnit={{ id: id(4) } as UnitRow}
      />,
    );
    expect(link("测试商户").pathname).toBe(`/cimac/customers/${id(5)}`);
    expect(host.textContent).toContain("维护运行条件");
    expect(host.querySelector('a[href^="/units"]')).toBeNull();
    render(<CimacAssetView data={assetData()} locale="zh" />);
    expect(host.textContent).not.toContain("维护运行条件");
  });
  it.each([
    ["storefront", "900 XOF / ㎡ / 月"],
    ["warehouse", "450 XOF / ㎡ / 月"],
    ["apartment", "30,000 / 40,000 / 50,000 XOF"],
  ] as const)("shows known %s property reference without auto-billing", (kind, reference) => {
    const data = assetData(parseCimacWorkspaceQuery({ tab: "service" }));
    data.asset.kind = kind;
    render(<CimacAssetView data={data} locale="zh" />);
    expect(host.textContent).toContain(reference);
    expect(host.textContent).toContain("不自动计算金额或生成账单");
    expect(host.querySelectorAll("form")).toHaveLength(0);
  });
  it("does not expose account entry to a role without account read access", () => {
    render(
      <CimacAssetView
        data={assetData(parseCimacWorkspaceQuery({ tab: "service" }))}
        locale="zh"
        canReadAccount={false}
      />,
    );
    expect(host.textContent).not.toContain("客户账务与抄表");
  });
  it("labels asset records as source facts, not full audit or delivery documents", () => {
    render(
      <CimacAssetView data={assetData(parseCimacWorkspaceQuery({ tab: "records" }))} locale="zh" />,
    );
    expect(host.textContent).toContain("不是完整变更历史");
    expect(host.textContent).toContain("未从更新时间推断操作人");
    expect(host.textContent).toContain("没有独立交付与开业记录");
  });
  it("paginates contract associations on the exact asset and selected tab", () => {
    render(
      <CimacAssetView
        data={assetData(parseCimacWorkspaceQuery({ tab: "contracts" }))}
        locale="fr"
      />,
    );
    const next = link("Suivant");
    expect(next.pathname).toBe(`/fr/cimac/assets/${id(4)}`);
    expect(Object.fromEntries(next.searchParams)).toMatchObject({
      tab: "contracts",
      relationPage: "2",
    });
    expect(link("Gérer le contrat").pathname).toBe("/fr/cimac/contracts");
  });
});

describe("CIMAC compact presentation semantics", () => {
  it("uses ordinary French navigation links with current-page semantics", () => {
    render(
      <CimacCustomerView
        data={customer(parseCimacWorkspaceQuery({ tab: "contracts" }, "customers"))}
        locale="fr"
      />,
    );
    const navigation = host.querySelector("nav[aria-label='Sections de la fiche client']")!;
    expect(navigation.querySelectorAll("a[aria-current=page]")).toHaveLength(1);
    expect(navigation.querySelector("a[aria-current=page]")?.textContent).toBe(
      "Contrats et livraison",
    );
    expect(navigation.querySelectorAll("[role=tab]")).toHaveLength(0);
  });
  it("preserves factual zero but never replaces unknowns or sentinel dates with zero", () => {
    render(
      <CimacFacts
        locale="zh"
        rows={[
          { label: "实际零", value: 0 },
          { label: "未知", value: null },
        ]}
      />,
    );
    expect(host.textContent).toBe("实际零0未知待核");
    expect(cimacNumber(null, "zh")).toBe("—");
    expect(cimacNumber(0, "zh")).toBe("0");
    expect(cimacDate("2099-12-31", "zh")).toBe("待核");
  });
  it("labels partial construction and field-unverified registered occupancy accurately", () => {
    expect(cimacConstruction("partially_operational", "zh")).toBe("部分可投入使用");
    expect(cimacOccupancy({ ...asset(), occupancyVerified: false }, "zh")).toBe(
      "登记租约占用 · 现场待核",
    );
    expect(cimacOccupancy({ position: null, occupancyVerified: false }, "fr")).toBe(
      "Occupation à vérifier",
    );
  });
  it("accepts a safe asset return to the exact original account subtab", () => {
    const customerUrl = cimacWorkspaceHref(
      "customers",
      "zh",
      { tab: "account", accountTab: "meters" },
      id(5),
    );
    const query = parseCimacWorkspaceQuery({ returnTo: customerUrl });
    render(<CimacAssetView data={assetData(query)} locale="zh" />);
    const back = link("返回");
    expect(back.pathname).toBe(`/cimac/customers/${id(5)}`);
    expect(Object.fromEntries(back.searchParams)).toMatchObject({
      tab: "account",
      accountTab: "meters",
    });
  });
});
