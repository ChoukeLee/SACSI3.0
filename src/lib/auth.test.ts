import { describe, expect, it } from "vitest";
import { canAccessPage, getSeedAccountProfile, hasPermission, type CurrentUser } from "./auth";

const rentalSalesUser: CurrentUser = {
  id: "test-user",
  email: "ying@sacsi.com",
  role: "rental_sales",
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

describe("rental sales role", () => {
  it("maps the Ying account to the application role and supported database role", () => {
    expect(getSeedAccountProfile("YING@SACSI.COM")).toEqual({
      role: "rental_sales",
      displayName: "Ying",
      databaseRole: "front_desk",
    });
  });

  it("allows rental and sales work without finance access", () => {
    expect(hasPermission(rentalSalesUser, "daily_rentals:write")).toBe(true);
    expect(hasPermission(rentalSalesUser, "leases:write")).toBe(true);
    expect(hasPermission(rentalSalesUser, "sales:write")).toBe(true);
    expect(hasPermission(rentalSalesUser, "audit_logs:read")).toBe(false);
    expect(hasPermission(rentalSalesUser, "finance:read")).toBe(false);
    expect(hasPermission(rentalSalesUser, "settings:read")).toBe(false);
  });

  it("allows the business pages but rejects finance and settings", () => {
    expect(canAccessPage("rental_sales", "daily-rentals")).toBe(true);
    expect(canAccessPage("rental_sales", "leases")).toBe(true);
    expect(canAccessPage("rental_sales", "sales")).toBe(true);
    expect(canAccessPage("rental_sales", "finance")).toBe(false);
    expect(canAccessPage("rental_sales", "settings")).toBe(false);
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
