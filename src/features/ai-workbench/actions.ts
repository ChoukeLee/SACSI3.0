"use server";

import { hasPermission, requireAuth } from "@/lib/auth";
import { parseWorkbenchAction } from "./action-parser";
import { buildCleaningCompletionDraft } from "./action-draft-service";
import { parseWorkbenchIntent } from "./intent-parser";
import { classifyWorkbenchIntentWithModel } from "./model-classifier";
import { executeWorkbenchQuery } from "./query-service";
import type { WorkbenchActionState, WorkbenchIntent } from "./types";

function todayInAbidjan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function canRunIntent(user: Awaited<ReturnType<typeof requireAuth>>, intent: WorkbenchIntent) {
  if (intent.kind === "unsupported") return true;
  if (intent.kind === "daily_status" || intent.domain === "daily") return hasPermission(user, "daily_rentals:read");
  if (intent.domain === "lease") return hasPermission(user, "leases:read");
  if (intent.domain === "sale") return hasPermission(user, "sales:read");
  if (intent.kind === "unit_snapshot") return hasPermission(user, "units:read");
  return hasPermission(user, "finance:read");
}

export async function askWorkbench(
  _previousState: WorkbenchActionState,
  formData: FormData,
): Promise<WorkbenchActionState> {
  const query = String(formData.get("query") ?? "").trim();
  if (query.length < 2) return { status: "error", result: null, error: "请输入要查询的问题。" };
  if (query.length > 500) return { status: "error", result: null, error: "问题请控制在 500 个字符以内。" };

  try {
    const user = await requireAuth();
    const asOfDate = todayInAbidjan();
    const actionIntent = parseWorkbenchAction(query);
    if (actionIntent) {
      if (!hasPermission(user, "daily_rentals:write")) {
        return { status: "error", result: null, error: "当前账号没有修改日租业务的权限。" };
      }
      const draft = await buildCleaningCompletionDraft(actionIntent);
      return { status: "success", result: draft, error: null };
    }
    let intent = parseWorkbenchIntent(query, asOfDate);
    if (intent.kind === "unsupported" || intent.confidence < 0.75) {
      const classified = await classifyWorkbenchIntentWithModel({ query, asOfDate, userId: user.id }).catch(() => null);
      if (classified && classified.confidence >= 0.65) intent = classified;
    }
    if (!canRunIntent(user, intent)) {
      return { status: "error", result: null, error: "当前账号没有查看这类业务数据的权限。" };
    }
    const result = await executeWorkbenchQuery(query, intent);
    return { status: "success", result, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询失败，请稍后重试。";
    return { status: "error", result: null, error: message };
  }
}
