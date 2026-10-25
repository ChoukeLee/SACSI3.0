import { cimacWorkspaceUuid } from "./cimac-workspace-query";

export interface CimacCustomerLinkInput {
  unitId: string;
  brand: string | null;
  relationshipKind: "signed_contract" | "reservation";
  signingState: "signed_effective" | "unconfirmed";
  signedDate: string | null;
  sourceReference: string;
}

export function validCimacCustomerLink(value: CimacCustomerLinkInput): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "unitId",
          "brand",
          "relationshipKind",
          "signingState",
          "signedDate",
          "sourceReference",
        ].includes(key),
    )
  )
    return false;
  return (
    typeof value.unitId === "string" &&
    cimacWorkspaceUuid.test(value.unitId) &&
    (value.brand === null || (typeof value.brand === "string" && value.brand.length <= 250)) &&
    ["signed_contract", "reservation"].includes(value.relationshipKind) &&
    ["signed_effective", "unconfirmed"].includes(value.signingState) &&
    typeof value.sourceReference === "string" &&
    value.sourceReference.trim().length > 0 &&
    value.sourceReference.length <= 2000 &&
    (value.signedDate === null ||
      (typeof value.signedDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.signedDate) &&
        Number.isFinite(Date.parse(value.signedDate)) &&
        new Date(`${value.signedDate}T00:00:00Z`).toISOString().slice(0, 10) === value.signedDate))
  );
}
