import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "src/app/api/operator/v1/actions/route.ts"),
  "utf8",
);

describe("operator actions route", () => {
  it("uses verified request auth and capability authorization", () => {
    expect(route).toContain("authenticateOperatorRequest(request)");
    expect(route).toContain('rpc("can_execute_operator_action"');
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("uses atomic daily payment and post-execution verification RPCs", () => {
    expect(route).toContain('rpc("daily_record_payment_rpc"');
    expect(route).toContain('rpc("verify_operator_daily_payment"');
    expect(route).toContain("post_execution_verification_failed");
  });

  it("does not accept a client confirmation flag to bypass policy", () => {
    expect(route).toContain('policy.decision === "confirm"');
    expect(route).not.toMatch(/confirmed\s*===\s*true/i);
  });
});
