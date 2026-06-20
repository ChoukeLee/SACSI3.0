import { describe, it, expect } from "vitest";
import { hasPermission } from "../src/lib/auth";
import type { UserRole } from "../src/lib/auth";

function user(role: UserRole) {
  return { id: "u1", email: "test@sacsi.com", role, displayName: "Test" };
}

describe("hasPermission", () => {
  it("null user has no permissions", () => {
    expect(hasPermission(null, "units:read")).toBe(false);
  });

  describe("admin", () => {
    it("can read/write/delete units", () => {
      const u = user("admin");
      expect(hasPermission(u, "units:read")).toBe(true);
      expect(hasPermission(u, "units:write")).toBe(true);
      expect(hasPermission(u, "units:delete")).toBe(true);
    });
    it("can manage users", () => {
      expect(hasPermission(user("admin"), "users:manage")).toBe(true);
    });
    it("can export finance", () => {
      expect(hasPermission(user("admin"), "finance:export")).toBe(true);
    });
  });

  describe("boss", () => {
    it("can read everything but not write", () => {
      const u = user("boss");
      expect(hasPermission(u, "units:read")).toBe(true);
      expect(hasPermission(u, "units:write")).toBe(false);
      expect(hasPermission(u, "units:delete")).toBe(false);
    });
    it("cannot manage users", () => {
      expect(hasPermission(user("boss"), "users:manage")).toBe(false);
    });
    it("can read reports and export", () => {
      const u = user("boss");
      expect(hasPermission(u, "reports:read")).toBe(true);
      expect(hasPermission(u, "reports:export")).toBe(true);
    });
  });

  describe("finance", () => {
    it("can write finance but not units", () => {
      const u = user("finance");
      expect(hasPermission(u, "finance:write")).toBe(true);
      expect(hasPermission(u, "units:write")).toBe(false);
    });
    it("cannot access settings", () => {
      expect(hasPermission(user("finance"), "settings:write")).toBe(false);
    });
  });

  describe("front_desk", () => {
    it("can write daily_rentals but not delete", () => {
      const u = user("front_desk");
      expect(hasPermission(u, "daily_rentals:write")).toBe(true);
      expect(hasPermission(u, "daily_rentals:delete")).toBe(false);
    });
    it("can read units but not write leases", () => {
      const u = user("front_desk");
      expect(hasPermission(u, "units:read")).toBe(true);
      expect(hasPermission(u, "leases:write")).toBe(false);
    });
    it("cannot export finance", () => {
      expect(hasPermission(user("front_desk"), "finance:export")).toBe(false);
    });
  });
});
