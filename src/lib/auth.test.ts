import { describe, expect, it } from "vitest";
import { canAccessPage, getSeedAccountProfile, hasPermission, homePathForRole, type CurrentUser } from "./auth";

const yingAdminUser: CurrentUser = {
  id: "test-user",
  email: "ying@sacsi.com",
  role: "admin",
  displayName: "Ying",
};

const frontDeskUser: CurrentUser = {
  id: "front-desk-user",
  email: "front@sacsi.com",
  role: "front_desk",
  displayName: "Niamké",
};

const bossUser: CurrentUser = {
  id: "boss-user",
  email: "boss@sacsi.com",
  role: "boss",
  displayName: "GAO",
};

describe("Ying administrator account", () => {
  it("maps the Ying account to the administrator role consistently", () => {
    expect(getSeedAccountProfile("YING@SACSI.COM")).toEqual({
      role: "admin",
      displayName: "Ying",
    });
  });

  it("grants all administrator permissions and pages", () => {
    for (const permission of [
      "units:read", "units:write", "units:delete",
      "customers:read", "customers:write", "customers:delete",
      "daily_rentals:read", "daily_rentals:write", "daily_rentals:delete",
      "leases:read", "leases:write", "leases:delete",
      "sales:read", "sales:write", "sales:delete",
      "finance:read", "finance:write", "finance:export",
      "audit_logs:read",
      "settings:read", "settings:write", "users:manage",
    ]) expect(hasPermission(yingAdminUser, permission)).toBe(true);
    for (const section of ["management", "finance", "settings", "daily-rentals", "leases", "sales", "customers", "audit-logs"]) {
      expect(canAccessPage("admin", section)).toBe(true);
    }
  });

  it("denies unknown route sections by default", () => {
    expect(canAccessPage("admin", "not-a-real-section")).toBe(false);
  });
});

describe("boss role", () => {
  it("uses the standardized display name", () => {
    expect(getSeedAccountProfile("BOSS@SACSI.COM")).toEqual({
      role: "boss",
      displayName: "GAO",
    });
  });

  it("has full business read access without mutation or settings access", () => {
    for (const permission of [
      "units:read",
      "customers:read",
      "daily_rentals:read",
      "leases:read",
      "sales:read",
      "finance:read",
      "finance:export",
      "audit_logs:read",
    ]) {
      expect(hasPermission(bossUser, permission)).toBe(true);
    }
    for (const permission of [
      "units:write",
      "customers:write",
      "daily_rentals:write",
      "leases:write",
      "sales:write",
      "finance:write",
      "settings:read",
    ]) {
      expect(hasPermission(bossUser, permission)).toBe(false);
    }
  });

  it("can open all business pages and read-only audit logs", () => {
    for (const section of ["management", "finance", "daily-rentals", "leases", "sales", "customers", "audit-logs"]) {
      expect(canAccessPage("boss", section)).toBe(true);
    }
    expect(canAccessPage("boss", "settings")).toBe(false);
  });
});

describe("front desk role", () => {
  it("can operate daily rentals and read leases only", () => {
    expect(hasPermission(frontDeskUser, "daily_rentals:write")).toBe(true);
    expect(hasPermission(frontDeskUser, "leases:read")).toBe(true);
    expect(hasPermission(frontDeskUser, "leases:write")).toBe(false);
    expect(hasPermission(frontDeskUser, "sales:read")).toBe(false);
    expect(hasPermission(frontDeskUser, "finance:read")).toBe(false);
    expect(hasPermission(frontDeskUser, "settings:read")).toBe(false);
  });

  it("cannot open sales or customer sections", () => {
    expect(canAccessPage("front_desk", "daily-rentals")).toBe(true);
    expect(canAccessPage("front_desk", "leases")).toBe(true);
    expect(canAccessPage("front_desk", "sales")).toBe(false);
    expect(canAccessPage("front_desk", "customers")).toBe(false);
  });
});

describe("role home routes", () => {
  it("sends each role directly to an authorized Chinese landing page", () => {
    expect(homePathForRole("admin")).toBe("/management");
    expect(homePathForRole("boss")).toBe("/management");
    expect(homePathForRole("finance")).toBe("/finance");
    expect(homePathForRole("rental_sales")).toBe("/leases");
    expect(homePathForRole("front_desk")).toBe("/fr/daily-rentals");
  });

  it("keeps French landing pages localized", () => {
    expect(homePathForRole("admin", "fr")).toBe("/fr/management");
    expect(homePathForRole("finance", "fr")).toBe("/fr/finance");
    expect(homePathForRole("rental_sales", "fr")).toBe("/fr/leases");
    expect(homePathForRole("front_desk", "fr")).toBe("/fr/daily-rentals");
  });
});
