import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { redactMonitoringEvent } from "../src/lib/monitoring-privacy";

describe("monitoring privacy", () => {
  it("removes business payloads and credentials while preserving correlation and stack locations", () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { email: "private@example.com" },
      extra: { customer: "private" },
      tags: { operation: "finance", request_id: "safe-id" },
      request: {
        url: "https://example.com/api?token=secret#secret",
        data: "private",
        headers: { authorization: "secret" },
        cookies: { session: "secret" },
        query_string: "token=secret",
      },
      exception: {
        values: [
          {
            value: "customer amount secret",
            stacktrace: {
              frames: [{ filename: "service.ts", lineno: 12, vars: { password: "secret" } }],
            },
          },
        ],
      },
      breadcrumbs: [{ message: "customer private", data: { token: "secret" }, category: "http" }],
    };
    const result = redactMonitoringEvent(event);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/private|secret|password|authorization/);
    expect(result.tags?.request_id).toBe("safe-id");
    expect(result.request?.url).toBe("https://example.com/api");
    expect(result.exception?.values?.[0].stacktrace?.frames?.[0].lineno).toBe(12);
  });
  it("drops malformed request URLs", () => {
    expect(
      redactMonitoringEvent({ type: undefined, request: { url: "invalid secret" } }).request?.url,
    ).toBeUndefined();
  });
});
