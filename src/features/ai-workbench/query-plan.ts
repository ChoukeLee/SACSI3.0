export const QUERY_PLAN_VERSION = 2 as const;

export const QUERY_PLAN_TOOLS = [
  "get_daily_status",
  "list_daily_movements",
  "list_lease_expirations",
  "list_receivables",
  "get_unit_snapshot",
] as const;
export type QueryPlanTool = (typeof QUERY_PLAN_TOOLS)[number];

export const QUERY_PLAN_TIME_KINDS = [
  "unspecified",
  "today",
  "absolute_date",
  "date_range",
  "next_days",
  "end_of_current_month",
  "next_calendar_week",
  "current_calendar_month",
  "previous_calendar_month",
] as const;
export type QueryPlanTimeKind = (typeof QUERY_PLAN_TIME_KINDS)[number];

export const QUERY_PLAN_METRICS = ["list", "count", "amount_outstanding", "amount_paid", "occupancy_rate"] as const;
export type QueryPlanMetric = (typeof QUERY_PLAN_METRICS)[number];

export const QUERY_PLAN_RECEIVABLE_STATES = ["overdue", "outstanding", "due_in_window"] as const;
export type QueryPlanReceivableState = (typeof QUERY_PLAN_RECEIVABLE_STATES)[number];

export interface QueryPlanTimeExpression {
  kind: QueryPlanTimeKind;
  value: number | null;
  startDate: string | null;
  endDate: string | null;
}

export interface QueryPlanArguments {
  domain: "all" | "daily" | "lease" | "sale";
  buildingCode: string | null;
  unitNo: string | null;
  customerName: string | null;
  time: QueryPlanTimeExpression;
  receivableState: QueryPlanReceivableState | null;
  metrics: QueryPlanMetric[];
  limit: number;
}

export interface QueryPlanCall {
  id: string;
  tool: QueryPlanTool;
  arguments: QueryPlanArguments;
}

export interface QueryPlanV2 {
  version: typeof QUERY_PLAN_VERSION;
  objective: string;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  calls: QueryPlanCall[];
  confidence: number;
  provider: "deepseek";
}

export interface ResolvedTimeRange {
  startDate: string | null;
  endDate: string | null;
  startInclusive: boolean;
  endInclusive: boolean;
  timezone: "Africa/Abidjan";
}

const toolSet = new Set<string>(QUERY_PLAN_TOOLS);
const timeKindSet = new Set<string>(QUERY_PLAN_TIME_KINDS);
const metricSet = new Set<string>(QUERY_PLAN_METRICS);
const receivableStateSet = new Set<string>(QUERY_PLAN_RECEIVABLE_STATES);
const domainSet = new Set(["all", "daily", "lease", "sale"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalDate(value: unknown) {
  return value === null || value === undefined ? null : isIsoDate(value) ? value : undefined;
}

function normalizeTime(value: unknown): QueryPlanTimeExpression | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !timeKindSet.has(value.kind)) return null;
  const kind = value.kind as QueryPlanTimeKind;
  const startDate = optionalDate(value.startDate);
  const endDate = optionalDate(value.endDate);
  if (startDate === undefined || endDate === undefined) return null;
  const numericValue = value.value === null || value.value === undefined ? null : Number(value.value);
  if (numericValue !== null && (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 365)) return null;
  if (kind === "next_days" && numericValue === null) return null;
  if (kind === "absolute_date" && startDate === null) return null;
  if (kind === "date_range" && (startDate === null || endDate === null || startDate > endDate)) return null;
  if (!["absolute_date", "date_range"].includes(kind) && (startDate !== null || endDate !== null)) return null;
  return { kind, value: numericValue, startDate, endDate };
}

function normalizeArguments(value: unknown): QueryPlanArguments | null {
  if (!isRecord(value) || typeof value.domain !== "string" || !domainSet.has(value.domain)) return null;
  const buildingCode = value.buildingCode === null || value.buildingCode === undefined
    ? null
    : typeof value.buildingCode === "string" ? value.buildingCode.trim().toUpperCase() : "";
  const unitNo = value.unitNo === null || value.unitNo === undefined
    ? null
    : typeof value.unitNo === "string" ? value.unitNo.trim().toUpperCase() : "";
  const customerName = value.customerName === null || value.customerName === undefined
    ? null
    : typeof value.customerName === "string" ? value.customerName.trim().slice(0, 120) : "";
  if (buildingCode !== null && !/^SACSI\d{1,3}$/.test(buildingCode)) return null;
  if (unitNo !== null && !/^[A-Z0-9-]{1,20}$/.test(unitNo)) return null;
  if (customerName !== null && !customerName) return null;
  const time = normalizeTime(value.time);
  if (!time) return null;
  const receivableState = value.receivableState === null || value.receivableState === undefined
    ? null
    : typeof value.receivableState === "string" && receivableStateSet.has(value.receivableState)
      ? value.receivableState as QueryPlanReceivableState
      : undefined;
  if (receivableState === undefined) return null;
  if (!Array.isArray(value.metrics) || value.metrics.some((metric) => typeof metric !== "string" || !metricSet.has(metric))) return null;
  const metrics = [...new Set(value.metrics)] as QueryPlanMetric[];
  if (!metrics.length || metrics.length > QUERY_PLAN_METRICS.length) return null;
  const limit = Number(value.limit ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return null;
  return {
    domain: value.domain as QueryPlanArguments["domain"], buildingCode, unitNo, customerName,
    time, receivableState, metrics, limit,
  };
}

export function normalizeQueryPlanV2(payload: unknown, provider: "deepseek" = "deepseek"): QueryPlanV2 | null {
  if (!isRecord(payload) || payload.version !== QUERY_PLAN_VERSION) return null;
  if (typeof payload.objective !== "string" || !payload.objective.trim() || payload.objective.length > 240) return null;
  if (typeof payload.needsClarification !== "boolean") return null;
  const clarificationQuestion = payload.clarificationQuestion === null || payload.clarificationQuestion === undefined
    ? null
    : typeof payload.clarificationQuestion === "string" ? payload.clarificationQuestion.trim().slice(0, 240) : undefined;
  if (clarificationQuestion === undefined) return null;
  if (payload.needsClarification && !clarificationQuestion) return null;
  if (!payload.needsClarification && clarificationQuestion) return null;
  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (!Array.isArray(payload.calls) || payload.calls.length > 5) return null;
  if (!payload.needsClarification && payload.calls.length === 0) return null;

  const calls: QueryPlanCall[] = [];
  const ids = new Set<string>();
  for (const rawCall of payload.calls) {
    if (!isRecord(rawCall) || typeof rawCall.id !== "string" || !/^[a-z][a-z0-9_-]{0,39}$/i.test(rawCall.id)) return null;
    if (ids.has(rawCall.id) || typeof rawCall.tool !== "string" || !toolSet.has(rawCall.tool)) return null;
    const args = normalizeArguments(rawCall.arguments);
    if (!args) return null;
    if (["get_daily_status", "list_daily_movements"].includes(rawCall.tool) && args.domain !== "daily") return null;
    if (rawCall.tool === "list_lease_expirations" && args.domain !== "lease") return null;
    if (rawCall.tool === "list_receivables" && !args.receivableState) return null;
    ids.add(rawCall.id);
    calls.push({ id: rawCall.id, tool: rawCall.tool as QueryPlanTool, arguments: args });
  }
  return {
    version: QUERY_PLAN_VERSION,
    objective: payload.objective.trim(), needsClarification: payload.needsClarification,
    clarificationQuestion, calls, confidence, provider,
  };
}

function parseUtcDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const date = parseUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function resolveQueryPlanTime(expression: QueryPlanTimeExpression, asOfDate: string): ResolvedTimeRange {
  if (!isIsoDate(asOfDate)) throw new Error("Invalid query plan reference date.");
  const base = parseUtcDate(asOfDate);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const result = (startDate: string | null, endDate: string | null, startInclusive = true): ResolvedTimeRange => ({
    startDate, endDate, startInclusive, endInclusive: true, timezone: "Africa/Abidjan",
  });
  if (expression.kind === "unspecified") return result(null, null);
  if (expression.kind === "today") return result(asOfDate, asOfDate);
  if (expression.kind === "absolute_date") return result(expression.startDate, expression.startDate);
  if (expression.kind === "date_range") return result(expression.startDate, expression.endDate);
  if (expression.kind === "next_days") return result(asOfDate, addDays(asOfDate, expression.value!), false);
  if (expression.kind === "end_of_current_month") return result(asOfDate, isoDate(new Date(Date.UTC(year, month + 1, 0))), false);
  if (expression.kind === "current_calendar_month") return result(isoDate(new Date(Date.UTC(year, month, 1))), isoDate(new Date(Date.UTC(year, month + 1, 0))));
  if (expression.kind === "previous_calendar_month") return result(isoDate(new Date(Date.UTC(year, month - 1, 1))), isoDate(new Date(Date.UTC(year, month, 0))));
  const daysUntilNextMonday = ((8 - base.getUTCDay()) % 7) || 7;
  const startDate = addDays(asOfDate, daysUntilNextMonday);
  return result(startDate, addDays(startDate, 6));
}

export function summarizeShadowPlan(plan: QueryPlanV2 | null) {
  if (!plan) return { status: "unavailable" as const, version: QUERY_PLAN_VERSION };
  return {
    status: plan.needsClarification ? "needs_clarification" as const : "planned" as const,
    version: plan.version,
    calls: plan.calls.map((call) => ({
      tool: call.tool,
      domain: call.arguments.domain,
      buildingCode: call.arguments.buildingCode,
      unitNo: call.arguments.unitNo,
      time: call.arguments.time,
      receivableState: call.arguments.receivableState,
      metrics: call.arguments.metrics,
    })),
    callCount: plan.calls.length,
    confidence: plan.confidence,
  };
}
