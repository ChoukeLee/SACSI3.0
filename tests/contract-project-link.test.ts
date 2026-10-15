import { describe, expect, it } from "vitest";
import { resolveContractProjectLink } from "@/features/contracts/project-link";
describe("contract project navigation", () => {
  const buildings = [{ project_id: "allowed", project: { code: "CIMAC" } }];
  it("resolves UUID or visible project code without inferring project from building code", () => {
    expect(resolveContractProjectLink(buildings, "allowed")).toBe("allowed");
    expect(resolveContractProjectLink(buildings, "cimac")).toBe("allowed");
    expect(resolveContractProjectLink(buildings)).toBeUndefined();
  });
  it("rejects duplicate, missing or unauthorized project targets instead of silently falling back", () => {
    expect(() => resolveContractProjectLink(buildings, "forbidden")).toThrow(
      "ContractProjectUnavailable",
    );
    expect(() => resolveContractProjectLink(buildings, ["allowed", "forbidden"])).toThrow(
      "ContractProjectUnavailable",
    );
    expect(() => resolveContractProjectLink([], "allowed")).toThrow("ContractProjectUnavailable");
  });
});
