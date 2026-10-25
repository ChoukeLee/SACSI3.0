import { describe, expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";
import {
  buildLeaseCollectionHref,
  validLeaseCollectionId,
} from "@/features/leases/lease-collection-links";

const id = "11111111-1111-4111-8111-111111111111";

describe("lease collection navigation", () => {
  it.each(["zh", "fr"] as const)(
    "keeps %s park collections and safe return destinations inside the park workspace",
    (locale) => {
      const prefix = locale === "fr" ? "/fr" : "";
      const returnTo = `${prefix}/cimac/contracts?contract=${id}`;
      const link = new URL(
        buildLeaseCollectionHref({ contractId: id, locale, returnTo, workArea: "cimac" })!,
        "https://local.invalid",
      );
      expect(link.pathname).toBe(`${prefix}/cimac/contracts/${id}/collect`);
      expect(link.searchParams.get("returnTo")).toBe(returnTo);
    },
  );
  it("keeps new collection audits recognizable in both languages", () => {
    expect(auditActionLabel("record_lease_collection", "zh")).toBe("登记长租实际收款并核销");
    expect(auditEntityLabel("lease_collection", "zh")).toBe("长租实收核销");
    expect(auditActionLabel("record_lease_collection", "fr")).toBe(
      "Enregistrer et affecter un encaissement locatif",
    );
    expect(auditEntityLabel("lease_collection", "fr")).toBe("Encaissement locatif affecté");
  });
  it("targets the exact contract without trusting a room number or name", () => {
    expect(buildLeaseCollectionHref({ contractId: id })).toBe(`/leases/${id}/collect`);
    expect(buildLeaseCollectionHref({ contractId: "308" })).toBeNull();
    expect(validLeaseCollectionId("../../settings")).toBe(false);
  });
  it("preserves a validated, scoped contract return destination in either language", () => {
    const returnTo = `/fr/leases?contract=${id}&building=${id}`;
    const link = buildLeaseCollectionHref({ contractId: id, locale: "fr", returnTo })!;
    const url = new URL(link, "https://local.invalid");
    expect(url.pathname).toBe(`/fr/leases/${id}/collect`);
    expect(url.searchParams.get("returnTo")).toBe(returnTo);
  });
  it.each([
    "https://evil.invalid",
    "//evil.invalid",
    "/api/leases",
    "/login",
    "/finance?token=secret",
  ])("does not propagate unsafe return %s", (returnTo) =>
    expect(buildLeaseCollectionHref({ contractId: id, returnTo })).toBe(`/leases/${id}/collect`),
  );
});
