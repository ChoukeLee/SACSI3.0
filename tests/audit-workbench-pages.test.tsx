import { beforeEach, describe, expect, it, vi } from "vitest";
const { currentUser, redirect, initialRead } = vi.hoisted(() => ({
  currentUser: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  initialRead: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: currentUser }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/features/settings/audit-workbench-service", () => ({
  initialAuditWorkbench: initialRead,
}));
import AuditPage from "@/app/settings/audit-logs/page";
import FrenchAuditPage from "@/app/fr/settings/audit-logs/page";
import { AuditWorkbenchPage } from "@/features/settings/audit-workbench-page";
import {
  AuditWorkbenchReadError,
  parseAuditWorkbenchQuery,
} from "@/features/settings/audit-workbench-model";
beforeEach(() => {
  vi.clearAllMocks();
});
const params = { searchParams: Promise.resolve({ search: "saved-query" }) };
describe("audit routes preserve authenticated role boundaries", () => {
  for (const [name, Page] of [
    ["zh", AuditPage],
    ["fr", FrenchAuditPage],
  ] as const) {
    it(`${name}: anonymous cannot render audit`, async () => {
      currentUser.mockResolvedValue(null);
      await expect(Page(params)).rejects.toThrow("redirect:/login");
      expect(initialRead).not.toHaveBeenCalled();
    });
    it.each(["finance", "front_desk", "rental_sales"])(
      `${name}: %s cannot render audit`,
      async (role) => {
        currentUser.mockResolvedValue({ id: "actor", role });
        await expect(Page(params)).rejects.toThrow("redirect:/");
        expect(initialRead).not.toHaveBeenCalled();
      },
    );
    it.each(["admin", "boss"])(
      `${name}: %s receives the paged shared SSR reader on mobile and desktop`,
      async (role) => {
        currentUser.mockResolvedValue({ id: "actor", role });
        const element = await Page(params);
        const content = element.props.children;
        expect(content.type).toBe(AuditWorkbenchPage);
        expect(content.props).toMatchObject({
          locale: name,
          viewerKey: `actor:${role}`,
          params: { search: "saved-query" },
        });
        expect(redirect).not.toHaveBeenCalled();
      },
    );
  }
  it("passes exact initial filters to the bounded server reader", async () => {
    const data = { rows: [], total: 0 };
    initialRead.mockResolvedValueOnce(data);
    const element = await AuditWorkbenchPage({
      params: { search: "bounded" },
      viewerKey: "actor:admin",
      locale: "zh",
    });
    expect(initialRead).toHaveBeenCalledExactlyOnceWith(
      parseAuditWorkbenchQuery({ search: "bounded" }),
    );
    expect(element.props.initialData).toBe(data);
  });
  it.each([400, 403, 503] as const)(
    "represents SSR failure %s without inventing empty successful data",
    async (status) => {
      initialRead.mockRejectedValueOnce(new AuditWorkbenchReadError(status));
      const element = await AuditWorkbenchPage({
        params: {},
        viewerKey: "actor:admin",
        locale: "fr",
      });
      expect(element.props).toMatchObject({
        initialData: null,
        initialError: status,
        initialQuery: parseAuditWorkbenchQuery(),
        locale: "fr",
      });
    },
  );
  it("does not display internal exception text", async () => {
    initialRead.mockRejectedValueOnce(new Error("database-secret"));
    const element = await AuditWorkbenchPage({
      params: {},
      viewerKey: "actor:admin",
      locale: "zh",
    });
    expect(element.props.initialError).toBe(503);
    expect(JSON.stringify(element.props)).not.toContain("database-secret");
  });
  it.each([403, 503] as const)(
    "retains every valid filter and page after SSR read failure %s",
    async (status) => {
      const params = {
        search: "room-503",
        actor: "recorded@example.invalid",
        dateFrom: "2026-09-01",
        dateTo: "2026-10-20",
        action: "record_lease_collection",
        entityType: "lease_collection",
        channel: "sacsi_web",
        identity: "account_recorded",
        page: "2",
      };
      initialRead.mockRejectedValueOnce(new AuditWorkbenchReadError(status));
      const element = await AuditWorkbenchPage({ params, viewerKey: "actor:admin", locale: "zh" });
      expect(element.props.initialQuery).toEqual(parseAuditWorkbenchQuery(params));
      expect(element.props.initialError).toBe(status);
    },
  );
  it.each([{ actor: ["A", "B"] }, { search: "x", dateFrom: "2026-10-20", dateTo: "2026-09-01" }])(
    "rejects invalid SSR query %j without issuing a database read",
    async (params) => {
      const element = await AuditWorkbenchPage({ params, viewerKey: "actor:admin", locale: "zh" });
      expect(initialRead).not.toHaveBeenCalled();
      expect(element.props.initialError).toBe(400);
    },
  );
});
