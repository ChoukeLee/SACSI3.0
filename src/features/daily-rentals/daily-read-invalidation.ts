"use client";

export const DAILY_DATA_CHANGED = "sacsi:daily-data-changed";
/** Component-local invalidation only: no financial or permission TTL cache. */
export function notifyDailyDataChanged(buildingId?: string) {
  window.dispatchEvent(new CustomEvent(DAILY_DATA_CHANGED, { detail: { buildingId } }));
}
