import {
  businessRequestIdentity,
  clearBusinessRequestIdentity,
} from "@/lib/business-request-identity";
export function leaseRequestIdentity(operation: string, target: string, payload: unknown) {
  return businessRequestIdentity("lease", operation, target, payload);
}
export function clearLeaseRequestIdentity(operation: string, target: string) {
  clearBusinessRequestIdentity("lease", operation, target);
}
