import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@/lib/auth";

// These are server-entry authorization tests, not employee login acceptance.
// Data readers are synthetic; the real route guards and permission matrix run.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null, reads: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => state.user,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  unstable_rethrow: () => {},
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    state.reads();
    return {
      from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
      rpc: async () => ({ data: [], error: null }),
    };
  },
}));
vi.mock("@/app/management/management-data", () => ({
  getProjects: async () => {
    state.reads();
    return [];
  },
  getCimacOverview: vi.fn(),
}));
vi.mock("@/features/data-quality/quality-page-data", () => ({
  loadQualityPage: async () => {
    state.reads();
    return { status: "complete", issues: [], checkedAt: "2026-10-20" };
  },
}));

import LeasesZh from "@/app/leases/page";
import LeasesFr from "@/app/fr/leases/page";
import SalesZh from "@/app/sales/page";
import SalesFr from "@/app/fr/sales/page";
import CustomersZh from "@/app/customers/page";
import CustomersFr from "@/app/fr/customers/page";
import UnitsZh from "@/app/units/page";
import UnitsFr from "@/app/fr/units/page";
import FinanceZh from "@/app/finance/page";
import FinanceFr from "@/app/fr/finance/page";
import ReportsZh from "@/app/reports/page";
import ReportsFr from "@/app/fr/reports/page";
import DailyZh from "@/app/daily-rentals/page";
import DailyFr from "@/app/fr/daily-rentals/page";
import SettingsZh from "@/app/settings/page";
import SettingsFr from "@/app/fr/settings/page";
import { ManagementPageContent } from "@/features/management/management-page";
import { QualityPage } from "@/features/data-quality/quality-page";
import { LeaseCollectionPage } from "@/features/leases/lease-collection-page";

const roles: UserRole[] = ["admin", "boss", "finance", "front_desk", "rental_sales"];
const all = roles;
const office: UserRole[] = ["admin", "boss", "finance", "rental_sales"];
const finance: UserRole[] = ["admin", "boss", "finance"];
const props = { searchParams: Promise.resolve({}) };
type Entry = {
  name: string;
  allowed: UserRole[];
  run: () => Promise<unknown>;
  frenchFrontRedirect?: boolean;
};
const entries: Entry[] = [
  { name: "zh leases", allowed: all, run: () => LeasesZh(props), frenchFrontRedirect: true },
  { name: "fr leases", allowed: all, run: () => LeasesFr(props) },
  { name: "zh sales", allowed: office, run: () => SalesZh(props) },
  { name: "fr sales", allowed: office, run: () => SalesFr(props) },
  { name: "zh customers", allowed: office, run: () => CustomersZh(props) },
  { name: "fr customers", allowed: office, run: () => CustomersFr(props) },
  { name: "zh units", allowed: office, run: () => UnitsZh(props) },
  { name: "fr units", allowed: office, run: () => UnitsFr(props) },
  { name: "zh finance", allowed: finance, run: () => FinanceZh(props) },
  { name: "fr finance", allowed: finance, run: () => FinanceFr(props) },
  { name: "zh reports", allowed: finance, run: () => ReportsZh(props) },
  { name: "fr reports", allowed: finance, run: () => ReportsFr(props) },
  { name: "zh daily", allowed: all, run: () => DailyZh(), frenchFrontRedirect: true },
  { name: "fr daily", allowed: all, run: () => DailyFr() },
  { name: "zh maintenance", allowed: ["admin"], run: () => SettingsZh() },
  { name: "fr maintenance", allowed: ["admin"], run: () => SettingsFr() },
  ...(["zh", "fr"] as const).flatMap((locale) => [
    {
      name: `${locale} management`,
      allowed: finance,
      run: () => ManagementPageContent({ locale, params: {} }),
    },
    {
      name: `${locale} quality`,
      allowed: ["admin"] as UserRole[],
      run: () => QualityPage({ locale }),
    },
    {
      name: `${locale} actual lease collection`,
      allowed: ["admin", "finance"] as UserRole[],
      run: () =>
        LeaseCollectionPage({
          locale,
          params: Promise.resolve({ id: "dddea799-fb2d-4722-857c-933c6ff5a26f" }),
          searchParams: Promise.resolve({}),
        }),
    },
  ]),
];
beforeEach(() => {
  state.user = null;
  state.reads.mockClear();
});

describe.each(entries)("$name server role boundary", ({ allowed, run, frenchFrontRedirect }) => {
  it("redirects anonymous requests before any page data read", async () => {
    await expect(run()).rejects.toThrow(/^REDIRECT:.*login/);
    expect(state.reads).not.toHaveBeenCalled();
  });
  it.each(roles)("checks the verified %s profile on entry", async (role) => {
    state.user = { id: "verified-synthetic-account", displayName: "Synthetic", role };
    if (!allowed.includes(role)) {
      await expect(run()).rejects.toThrow(/^REDIRECT:/);
      expect(state.reads).not.toHaveBeenCalled();
    } else if (frenchFrontRedirect && role === "front_desk") {
      await expect(run()).rejects.toThrow(/^REDIRECT:\/fr\//);
    } else {
      expect(await run()).toBeTruthy();
    }
  });
});
