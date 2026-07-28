import { describe, expect, it } from "vitest";
import { canAccessPage, getSeedAccountProfile, hasPermission, type CurrentUser } from "./auth";

const rentalSalesUser: CurrentUser = {
  id: "test-user",
  email: "ying@sacsi.com",
  role: "rental_sales",
  displayName: "Ying",
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
});
