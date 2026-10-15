import { expect, it, vi } from "vitest";
import {
  createRequestTiming,
  type PerformanceSegment,
  type PerformanceScope,
} from "@/lib/performance";

it("keeps concurrent request timing independent and preserves operation results/errors", async () => {
  let clock = 0;
  const a = createRequestTiming(() => clock),
    b = createRequestTiming(() => clock);
  let finish!: (value: object) => void;
  const result = { privateBusinessValue: "must never be logged" };
  const pending = a.measure(
    "db_read",
    () =>
      new Promise<object>((resolve) => {
        finish = resolve;
      }),
  );
  clock = 5;
  expect(await b.measure("auth_user", () => result)).toBe(result);
  clock = 12;
  finish(result);
  expect(await pending).toBe(result);
  expect(a.snapshot()).toEqual([{ name: "db_read", durationMs: 12, calls: 1 }]);
  expect(b.snapshot()).toEqual([{ name: "auth_user", durationMs: 0, calls: 1 }]);
  const error = new Error("sensitive business or credentials");
  await expect(
    a.measure("serialize", () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(a.snapshot().at(-1)).toEqual({ name: "serialize", durationMs: 0, calls: 1 });
});

it("emits only fixed labels and numeric durations and retains private no-store", () => {
  const timing = createRequestTiming();
  timing.record("rpc_read", 12.3456);
  timing.record("rpc_read", 2);
  timing.record("auth_profile", -4);
  timing.record("db_read", Number.NaN);
  const response = timing.response(
    new Response("untouched business response", {
      status: 403,
      headers: { "Cache-Control": "public, max-age=900", "X-Test": "retained" },
    }),
  );
  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Test")).toBe("retained");
  expect(response.headers.get("Server-Timing")).toBe("rpc_read;dur=14.35, auth_profile;dur=0.00");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    timing.log("route_read");
    expect(log).toHaveBeenCalledWith("SACSI_PERFORMANCE", {
      scope: "route_read",
      segments: [
        { name: "rpc_read", durationMs: 14.35, calls: 2 },
        { name: "auth_profile", durationMs: 0, calls: 1 },
      ],
    });
    expect(() => timing.record("user-secret\r\nX-Injected: true" as PerformanceSegment, 1)).toThrow(
      "unsupportedPerformanceSegment",
    );
    expect(() => timing.log("customer-or-token" as PerformanceScope)).toThrow(
      "unsupportedPerformanceScope",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  } finally {
    log.mockRestore();
  }
});

it("snapshot mutation cannot affect a later request-owned header", () => {
  const timing = createRequestTiming();
  timing.record("auth_user", 4);
  timing.snapshot()[0].durationMs = 1000;
  expect(timing.response(new Response()).headers.get("Server-Timing")).toBe("auth_user;dur=4.00");
  expect(createRequestTiming().response(new Response()).headers.get("Server-Timing")).toBeNull();
});
