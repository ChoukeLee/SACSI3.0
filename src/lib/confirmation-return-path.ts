/** Deliberately allow only confirmation links, never arbitrary redirect URLs. */
export function confirmationReturnPath(value: unknown): string | null {
  if(value === "/operator") return value;
  return typeof value === "string" && /^\/operator\/(?:confirmations|collections|daily-workflows|booking-operations)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
