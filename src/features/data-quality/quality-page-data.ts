import "server-only";

import { sortUnits } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import { runQualityChecks } from "./quality-service";
import { scanDailyRentalIssues } from "@/features/daily-rentals/daily-rental-audit";
import {
  fetchDatabaseQualitySnapshot,
  mergeDatabaseQualityIssues,
} from "./database-quality-service";
import type { QualityIssue, TodoRole } from "./quality-types";

export type QualityPageResult =
  { status: "complete"; issues: QualityIssue[]; checkedAt: string } | { status: "unavailable" };

/** A failed source invalidates the scan; it must never look like zero findings. */
export async function loadQualityPage(locale: Locale, role: TodoRole): Promise<QualityPageResult> {
  try {
    const { sources, databaseIssues } = await fetchDatabaseQualitySnapshot(locale);
    const existingIssues = runQualityChecks({ ...sources, units: sortUnits(sources.units) }, role);
    const dailyIssues = scanDailyRentalIssues({
      ...sources,
      dailyBookings: sources.dailyBookings as unknown as Record<string, unknown>[],
      units: sources.units as unknown as Record<string, unknown>[],
      payments: sources.payments as unknown as Record<string, unknown>[],
      receivables: sources.receivables as unknown as Record<string, unknown>[],
    });
    return {
      status: "complete",
      issues: mergeDatabaseQualityIssues([...existingIssues, ...dailyIssues], databaseIssues),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    console.error("QualitySnapshotUnavailable");
    return { status: "unavailable" };
  }
}
