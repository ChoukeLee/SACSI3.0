// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualityCenter } from "@/features/data-quality/quality-center";
import { UnitProfileView } from "@/features/units/unit-profile-view";
import { CustomerProfileView } from "@/features/customers/customer-profile-view";
import type { QualityIssue } from "@/features/data-quality/quality-types";
import type { UnitProfileData } from "@/features/units/unit-profile-service";
import type { CustomerProfileData } from "@/features/customers/customer-profile-service";
import { UnitList } from "@/features/units/unit-list";
import { matchesUnitPosition, type UnitPosition } from "@/features/units/operational-position";
import type { UnitRow } from "@/types/database";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  params: new URLSearchParams(),
  unitAudit: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => mocks.params,
}));
vi.mock("@/features/units/actions", () => ({
  getUnitAuditLogs: mocks.unitAudit,
  updateUnitStatus: vi.fn(),
}));
vi.mock("@/features/daily-rentals/daily-rental-repair", () => ({
  repairDailyRentalIssue: vi.fn(),
}));
vi.mock("@/features/documents/templates/all-templates", () => ({ printDocumentRecord: vi.fn() }));
vi.mock("@/components/attachments/receipt-thumb", () => ({ ReceiptThumb: () => null }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.refresh.mockReset();
  mocks.params = new URLSearchParams();
  mocks.unitAudit.mockReset().mockResolvedValue([]);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith(text),
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
const issue: QualityIssue = {
  id: "one",
  severity: "high",
  category: "unit",
  title: "房态需要核查",
  description: "说明",
  entityType: "unit",
  entityId: "unit",
  entityLabel: "101",
  relatedEntities: [],
  href: "",
  suggestedAction: "核查",
  detectedAt: "2026-01-01",
  status: "open",
};

describe("honest quality states", () => {
  it("does not label an empty filter result healthy", async () => {
    await act(async () => root.render(<QualityCenter issues={[issue]} locale="zh" />));
    await click("低危");
    expect(host.textContent).toContain("当前筛选下没有异常");
    expect(host.textContent).not.toContain("数据质量良好");
  });
  it("shows a failed scan without zero metrics and supports retry", async () => {
    await act(async () => root.render(<QualityCenter issues={[]} locale="fr" loadError />));
    expect(host.textContent).toContain("Contrôle de qualité incomplet");
    expect(host.textContent).not.toContain("Aucune anomalie");
    expect(host.textContent).not.toContain("Total");
    await click("Réessayer");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("supports keyboard-native expansion and complete paginated findings", async () => {
    await act(async () =>
      root.render(
        <QualityCenter
          issues={Array.from({ length: 30 }, (_, index) => ({
            ...issue,
            id: `issue-${index}`,
            title: `异常 ${index}`,
          }))}
          locale="zh"
        />,
      ),
    );
    expect(host.querySelectorAll("button[aria-expanded]")).toHaveLength(25);
    await click("异常 0");
    expect(host.querySelector("button[aria-expanded=true]")?.getAttribute("aria-controls")).toBe(
      "quality-detail-issue-0",
    );
    await click("下一页");
    expect(host.querySelectorAll("button[aria-expanded]")).toHaveLength(5);
    expect(host.textContent).toContain("26–30 / 30");
  });
});

function receivables() {
  return [
    {
      id: "managed",
      amount_xof: 100000,
      paid_amount_xof: 150000,
      due_date: "2020-01-01",
      status: "paid",
      management_status: "managed",
      source_type: "lease_contract",
    },
    {
      id: "historical",
      amount_xof: 9000000,
      paid_amount_xof: 0,
      due_date: "2020-01-01",
      status: "pending",
      management_status: "historical_pending",
      source_type: "lease_contract",
    },
  ];
}
function unitProfile(overrides: Partial<UnitProfileData> = {}): UnitProfileData {
  return {
    unit: { id: "unit", unit_no: "101", kind: "apartment", floor_label: "1" },
    buildingName: "Building",
    dailyBookings: [],
    leaseContracts: [],
    saleContracts: [],
    receivables: [],
    payments: [],
    customers: [],
    auditLogs: [],
    ...overrides,
  } as UnitProfileData;
}
describe("profile identities, balances and history", () => {
  it("resets the asset dossier tab when the target changes and retains a safe return destination", async () => {
    await act(async () =>
      root.render(
        <UnitProfileView
          data={unitProfile()}
          locale="zh"
          returnTo="/units?building=one&unit=unit"
        />,
      ),
    );
    expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toContain(
      "/units?building=one&unit=unit",
    );
    await click("财务记录");
    expect(host.querySelector('button[aria-current="page"]')?.textContent).toContain("财务记录");
    const next = unitProfile();
    next.unit = { ...next.unit, id: "unit-b", unit_no: "202" };
    await act(async () =>
      root.render(<UnitProfileView data={next} locale="zh" returnTo="https://evil.invalid" />),
    );
    expect(host.querySelector('button[aria-current="page"]')?.textContent).toBe("概览");
    expect(host.querySelector('a[href="https://evil.invalid"]')).toBeNull();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
  });
  it.each(["zh", "fr"] as const)(
    "never substitutes a confirmed contract end for an unknown paid-through date (%s)",
    async (locale) => {
      const data = unitProfile({
        leaseContracts: [
          {
            id: "lease",
            contract_no: "L-UNKNOWN",
            status: "active",
            start_date: "2026-01-01",
            paid_through_date: null,
            expected_end_date: "2032-12-31",
            expected_end_confirmed: true,
            monthly_rent_xof: 100000,
          },
        ] as UnitProfileData["leaseContracts"],
      });
      await act(async () => root.render(<UnitProfileView data={data} locale={locale} />));
      const unknown = locale === "zh" ? "未记录" : "—";
      expect(host.textContent).toContain(`${locale === "zh" ? "已缴至" : "Payé au"} ${unknown}`);
      expect(host.textContent).not.toContain("2032-12-31");
      await click(locale === "zh" ? "长租 / 出售" : "Bail / Vente");
      expect(host.querySelectorAll("tbody tr td")[3]?.textContent).toBe(unknown);
      expect(host.textContent).not.toContain("2032-12-31");
    },
  );
  it.each(["zh", "fr"] as const)(
    "labels receivable allocation separately from cash in both profiles (%s)",
    async (locale) => {
      await act(async () =>
        root.render(
          <UnitProfileView
            data={unitProfile({ receivables: receivables() as UnitProfileData["receivables"] })}
            locale={locale}
          />,
        ),
      );
      await click(locale === "zh" ? "财务记录" : "Finance");
      const allocation = locale === "zh" ? "已核销" : "Imputé";
      expect([...host.querySelectorAll("th")].map((cell) => cell.textContent)).toContain(
        allocation,
      );
      expect([...host.querySelectorAll("th")].map((cell) => cell.textContent)).not.toContain(
        locale === "zh" ? "已收" : "Payé",
      );
      const customer = {
        customer: { id: "customer", name: "Customer", is_blacklisted: false },
        units: [],
        dailyBookings: [],
        agentBookings: [],
        unresolvedBookings: [],
        leaseContracts: [],
        saleContracts: [],
        receivables: receivables(),
        payments: [],
        auditLogs: [],
        attachments: [],
      } as unknown as CustomerProfileData;
      await act(async () =>
        root.render(<CustomerProfileView data={customer} locale={locale} userRole="admin" />),
      );
      await click(locale === "zh" ? "财务" : "Finance");
      expect([...host.querySelectorAll("th")].map((cell) => cell.textContent)).toContain(
        allocation,
      );
      expect(host.textContent).not.toContain("已收指应收核销额");
    },
  );
  it("calls daily prepaid balances order payments, not period cash receipts", async () => {
    const data = unitProfile({
      dailyBookings: [
        {
          id: "booking",
          check_in: "2026-01-01",
          status: "checked_out",
          total_amount_xof: 10000,
          prepaid_amount_xof: 4000,
        },
      ] as UnitProfileData["dailyBookings"],
    });
    await act(async () => root.render(<UnitProfileView data={data} locale="zh" />));
    await click("日租");
    expect([...host.querySelectorAll("th")].map((cell) => cell.textContent)).toContain("订单付款");
    expect([...host.querySelectorAll("th")].map((cell) => cell.textContent)).not.toContain("已收");
  });
  it("never displays the booking agent as current guest, uses managed finance and reaches all daily rows", async () => {
    const data = {
      unit: {
        id: "unit",
        unit_no: "101",
        status: "daily_occupied",
        kind: "apartment",
        floor_label: "1",
      },
      buildingName: "Building",
      dailyBookings: Array.from({ length: 30 }, (_, index) => ({
        id: `b-${index}`,
        status: index === 0 ? "checked_in" : "checked_out",
        check_in: "2026-01-01",
        customer_id: "agent",
        booking_agent_id: "agent",
        guest_customer_id: "guest",
        total_amount_xof: 10000,
        prepaid_amount_xof: 0,
      })),
      leaseContracts: [],
      saleContracts: [],
      receivables: receivables(),
      payments: [],
      customers: [
        { id: "agent", name: "Agent" },
        { id: "guest", name: "Real guest" },
      ],
      auditLogs: [],
    } as unknown as UnitProfileData;
    await act(async () => root.render(<UnitProfileView data={data} locale="zh" />));
    const currentClient = [...host.querySelectorAll("p")].find(
      (element) => element.textContent === "当前客户",
    )?.parentElement;
    expect(currentClient?.textContent).toContain("Real guest");
    expect(currentClient?.textContent).not.toContain("Agent");
    expect(host.textContent).toContain("150,000 XOF");
    expect(host.textContent).not.toContain("900.00万 FCFA");
    await click("日租");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(25);
    await click("下一页");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(host.textContent).toContain("Agent");
  });
  it("retains original payment currency in customer history and separates agent bookings", async () => {
    const data = {
      customer: { id: "guest", name: "Guest", is_blacklisted: false },
      units: [],
      dailyBookings: [],
      agentBookings: [
        { id: "agent-booking", status: "checked_in", check_in: "2026-01-01", unit_id: "unit" },
      ],
      unresolvedBookings: [],
      leaseContracts: [],
      saleContracts: [],
      receivables: receivables(),
      payments: [
        {
          id: "p",
          amount: 1200,
          currency: "CNY",
          exchange_rate_to_xof: 90,
          payment_date: "2026-02-01",
        },
      ],
      auditLogs: [],
      attachments: [],
    } as unknown as CustomerProfileData;
    await act(async () =>
      root.render(<CustomerProfileView data={data} locale="zh" userRole="admin" />),
    );
    expect(host.textContent).toContain("¥1,200");
    expect(host.textContent).toContain("经办记录");
    expect(host.textContent).not.toContain("当前业务: 日租:1");
    await click("财务");
    expect(host.textContent).toContain("¥1,200");
    expect(host.textContent).toContain("未纳管 · 不计指标");
  });
});

describe("independent asset dimensions", () => {
  const position: UnitPosition = {
    ownership: "sold",
    operational_condition: "normal",
    lease_occupied: true,
    daily_occupied: false,
    cleaning_pending: true,
    daily_enabled: false,
    lease_enabled: true,
  };
  const unit = {
    id: "unit",
    code: "SACSI7-STOREFRONT",
    unit_no: "101",
    building_id: "sacsi-building",
    floor_label: "1",
    kind: "storefront",
    status: "sold",
    updated_at: "2026-01-01",
  } as UnitRow;
  const buildings = [
    {
      id: "sacsi-building",
      code: "SACSI7",
      display_name: "SACSI7",
      project_id: "project-sacsi",
      project_code: "SACSI",
      project_name: "SACSI",
    },
    {
      id: "cimac-building",
      code: "CIMAC",
      display_name: "CIMAC",
      project_id: "project-cimac",
      project_code: "CIMAC",
      project_name: "CIMAC",
    },
  ];
  it("allows sold, leased and cleaning filters to match the same asset without inferring rent-readiness", () => {
    expect(matchesUnitPosition(unit, position, "sold")).toBe(true);
    expect(matchesUnitPosition(unit, position, "leased")).toBe(true);
    expect(matchesUnitPosition(unit, position, "cleaning_pending")).toBe(true);
    expect(matchesUnitPosition(unit, position, "available")).toBe(false);
    expect(matchesUnitPosition(unit, undefined, "available")).toBe(false);
  });
  it("shows concurrent dimensions and missing configuration, not a fabricated rental price", async () => {
    await act(async () =>
      root.render(
        <UnitList
          units={[unit]}
          businessFlagsMap={{ unit: [] }}
          positionsMap={{ unit: position }}
          unitPartySummaries={{ unit: { leaseCustomerName: "Tenant", leaseEndDate: "2027-01-01" } }}
          buildings={buildings}
          locale="zh"
          canEdit={false}
        />,
      ),
    );
    const table = host.querySelector("[data-unit-asset-table]")!;
    expect(table.textContent).toContain("已售");
    expect(table.textContent).toContain("长租 · Tenant");
    expect(table.textContent).toContain("待保洁");
    expect(table.textContent).toContain("业务配置待核对");
    expect(table.textContent).not.toContain("120.00万");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  });
  it("honors a project UUID link instead of the saved other project, including an inaccessible project", async () => {
    localStorage.setItem("sacsi_active_building_id", "sacsi-building");
    mocks.params = new URLSearchParams("project=project-cimac");
    const other = {
      ...unit,
      id: "cimac-unit",
      unit_no: "CIMAC-ONLY",
      building_id: "cimac-building",
    };
    await act(async () =>
      root.render(
        <UnitList
          units={[unit, other]}
          businessFlagsMap={{}}
          positionsMap={{ unit: position, "cimac-unit": position }}
          buildings={buildings}
          locale="zh"
          canEdit={false}
        />,
      ),
    );
    expect(host.querySelector("tbody")?.textContent).toContain("CIMAC-ONLY");
    expect(host.querySelector("tbody")?.textContent).not.toContain("101");
    mocks.params = new URLSearchParams("project=not-accessible");
    await act(async () =>
      root.render(
        <UnitList
          units={[unit, other]}
          businessFlagsMap={{}}
          positionsMap={{}}
          buildings={buildings}
          locale="zh"
          canEdit={false}
        />,
      ),
    );
    expect(host.querySelector("tbody")).toBeNull();
  });
  it("shows a status-history read failure explicitly, not no records", async () => {
    mocks.unitAudit.mockRejectedValueOnce(new Error("offline"));
    await act(async () =>
      root.render(
        <UnitList
          units={[unit]}
          businessFlagsMap={{}}
          positionsMap={{ unit: position }}
          buildings={buildings}
          locale="zh"
          canEdit={false}
        />,
      ),
    );
    await act(async () =>
      (host.querySelector('button[aria-label="查看资产 101"]') as HTMLButtonElement).click(),
    );
    expect(document.body.textContent).toContain("状态历史读取失败");
    expect(document.body.textContent).not.toContain("暂无状态变更记录");
  });
});
