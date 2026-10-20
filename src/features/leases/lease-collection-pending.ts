export type LeaseCollectionPending =
  { status: "none" } | { status: "pending"; requestId: string } | { status: "unavailable" };

/** Read only the existing identity, never persist or reconstruct financial form values. */
export function readLeaseCollectionPending(
  viewerId: string,
  contractId: string,
  storage: Pick<Storage, "getItem">,
): LeaseCollectionPending {
  try {
    const raw = storage.getItem(
      `sacsi:finance-request:v1:lease_collection:${viewerId}:${contractId}`,
    );
    if (raw === null) return { status: "none" };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { status: "unavailable" };
    const { requestId, fingerprint } = value as Record<string, unknown>;
    if (
      typeof requestId !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId) ||
      typeof fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/i.test(fingerprint)
    )
      return { status: "unavailable" };
    return { status: "pending", requestId };
  } catch {
    return { status: "unavailable" };
  }
}
