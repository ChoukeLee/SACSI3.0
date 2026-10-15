import type {
  ReceiptAnalysis,
  ReceiptComparison,
  ReceiptFilters,
  ReceiptPeriod,
  ReceiptPeriods,
  ReceiptReadResult,
  ReceiptSummary,
} from "./receipt-analysis-types";

const DAY = 86_400_000;
export const RECEIPT_PAGE_SIZE = 50;
export class ReceiptQueryError extends Error {}
export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "2100-12-31")
    throw new ReceiptQueryError("invalidReceiptFilter");
  const result = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(result.getTime()) || iso(result) !== value)
    throw new ReceiptQueryError("invalidReceiptFilter");
  return result;
}
const iso = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: string, count: number) =>
  iso(new Date(date(value).getTime() + count * DAY));
function monthEnd(value: string) {
  const [year, month] = value.split("-").map(Number);
  return iso(new Date(Date.UTC(year, month, 0)));
}
function shiftMonth(value: string, count: number) {
  const [year, month] = value.split("-").map(Number);
  return iso(new Date(Date.UTC(year, month - 1 + count, 1))).slice(0, 7);
}
function shiftYear(value: string) {
  const yearMonth = `${Number(value.slice(0, 4)) - 1}${value.slice(4, 7)}`;
  return `${yearMonth}-${String(Math.min(Number(value.slice(8)), Number(monthEnd(yearMonth).slice(8)))).padStart(2, "0")}`;
}
export function defaultReceiptMonth(now = new Date()) {
  return shiftMonth(businessDate(now).slice(0, 7), -1);
}
export const periodDays = (period: ReceiptPeriod) =>
  (date(period.to).getTime() - date(period.from).getTime()) / DAY + 1;

export function parseReceiptQuery(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
) {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new ReceiptQueryError("invalidReceiptFilter");
    return value?.trim().normalize("NFC") ?? "";
  };
  const today = businessDate(now);
  let month = one("month") || defaultReceiptMonth(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "1901-01" || month > today.slice(0, 7))
    throw new ReceiptQueryError("invalidReceiptFilter");
  const dateFrom = one("dateFrom"),
    dateTo = one("dateTo");
  const custom = Boolean(dateFrom || dateTo);
  let current: ReceiptPeriod, previous: ReceiptPeriod, year: ReceiptPeriod;
  let partial = false;
  if (custom) {
    if (!dateFrom || !dateTo) throw new ReceiptQueryError("invalidReceiptFilter");
    date(dateFrom);
    date(dateTo);
    current = { from: dateFrom, to: dateTo };
    if (dateFrom > dateTo || dateTo > today || periodDays(current) > 366 || dateFrom < "1901-01-01")
      throw new ReceiptQueryError("invalidReceiptFilter");
    const length = periodDays(current);
    previous = { from: addDays(dateFrom, -length), to: addDays(dateFrom, -1) };
    year = { from: shiftYear(dateFrom), to: shiftYear(dateTo) };
    month = "";
  } else {
    const from = `${month}-01`;
    partial = month === today.slice(0, 7);
    if (partial && today.endsWith("-01"))
      throw new ReceiptQueryError("currentMonthHasNoCompleteDay");
    const to = partial ? addDays(today, -1) : monthEnd(month);
    current = { from, to };
    const previousMonth = shiftMonth(month, -1),
      yearMonth = shiftMonth(month, -12);
    const end = (target: string) =>
      partial
        ? `${target}-${String(Math.min(Number(to.slice(8)), Number(monthEnd(target).slice(8)))).padStart(2, "0")}`
        : monthEnd(target);
    previous = { from: `${previousMonth}-01`, to: end(previousMonth) };
    year = { from: `${yearMonth}-01`, to: end(yearMonth) };
  }
  const trendEnd = shiftMonth(today.slice(0, 7), -1);
  const periods: ReceiptPeriods = {
    current,
    previous,
    year,
    trend: { from: `${shiftMonth(trendEnd, -11)}-01`, to: monthEnd(trendEnd) },
    partial,
    custom,
  };
  const buildingId = one("buildingId") || "all";
  if (buildingId !== "all" && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(buildingId))
    throw new ReceiptQueryError("invalidReceiptFilter");
  const query = one("query");
  if (query.length > 120) throw new ReceiptQueryError("invalidReceiptFilter");
  const method = one("method") || "all",
    kind = one("kind") || "all";
  if (
    !["all", "cash", "check", "bank_transfer", "offset", "other", "unknown"].includes(method) ||
    !["all", "collection", "refund", "reversal", "excluded"].includes(kind)
  )
    throw new ReceiptQueryError("invalidReceiptFilter");
  const pageValue = one("page") || "1";
  if (!/^[1-9]\d*$/.test(pageValue) || Number(pageValue) > 2_000_000)
    throw new ReceiptQueryError("invalidReceiptFilter");
  const exporting = one("export");
  if (exporting && exporting !== "1") throw new ReceiptQueryError("invalidReceiptFilter");
  const locale = one("locale") || "zh";
  if (locale !== "zh" && locale !== "fr") throw new ReceiptQueryError("invalidReceiptFilter");
  const filters: ReceiptFilters = {
    month,
    dateFrom: custom ? dateFrom : "",
    dateTo: custom ? dateTo : "",
    buildingId: buildingId.toLowerCase(),
    query,
    method: method as ReceiptFilters["method"],
    kind: kind as ReceiptFilters["kind"],
    page: Number(pageValue),
  };
  const input = {
    dateFrom: current.from,
    dateTo: current.to,
    previousFrom: previous.from,
    previousTo: previous.to,
    yearFrom: year.from,
    yearTo: year.to,
    trendFrom: periods.trend.from,
    trendTo: periods.trend.to,
    buildingId: buildingId === "all" ? null : buildingId.toLowerCase(),
    query,
    method,
    kind,
  };
  return { filters, periods, input, exporting: exporting === "1", locale: locale as "zh" | "fr" };
}

export function receiptComparison(
  current: ReceiptSummary,
  baseline: ReceiptSummary,
  period: ReceiptPeriod,
  coverage: ReceiptReadResult["coverage"],
  unequal = false,
): ReceiptComparison {
  let status: ReceiptComparison["status"] = "available";
  if (
    !coverage.firstDate ||
    period.from < coverage.firstDate ||
    baseline.count + baseline.excludedCount === 0 ||
    current.count + current.excludedCount === 0
  )
    status = "insufficient_history";
  else if (current.excludedCount || baseline.excludedCount) status = "excluded_records";
  else if (unequal) status = "unequal_period";
  else if (baseline.net <= 0) status = "non_positive_baseline";
  const difference = current.net - baseline.net;
  if (status === "available" && !Number.isSafeInteger(difference))
    throw new Error("receiptHistoryUnavailable");
  return {
    status,
    period,
    amount: status === "available" ? difference : null,
    percent: status === "available" ? (difference / baseline.net) * 100 : null,
  };
}
export function composeReceiptAnalysis(
  result: ReceiptReadResult,
  query: ReturnType<typeof parseReceiptQuery>,
): ReceiptAnalysis {
  const compare = (key: "previous" | "year") =>
    receiptComparison(
      result.summary,
      result[key],
      query.periods[key],
      result.coverage,
      (query.periods.partial || query.periods.custom) &&
        periodDays(query.periods.current) !== periodDays(query.periods[key]),
    );
  return {
    ...result,
    filters: query.filters,
    periods: query.periods,
    comparisons: { previous: compare("previous"), year: compare("year") },
    pageSize: RECEIPT_PAGE_SIZE,
  };
}

export function receiptCsv(result: ReceiptAnalysis, locale: "zh" | "fr" = "zh") {
  const columns: (keyof ReceiptAnalysis["rows"][number])[] = [
    "date",
    "buildingName",
    "room",
    "guestName",
    "bookingAgentName",
    "kind",
    "paymentMethod",
    "receiptNo",
    "amount",
    "currency",
    "amountXof",
    "exclusionReason",
    "createdAt",
    "bookingId",
    "reversalOf",
    "notes",
    "id",
  ];
  const labels =
    locale === "zh"
      ? [
          "收款日期",
          "楼栋",
          "房号",
          "客人",
          "经办人（非收款人）",
          "记录类型",
          "收款方式",
          "收据号",
          "原币金额",
          "原币",
          "计入净收款XOF",
          "未计入原因",
          "录入时间",
          "订单ID",
          "冲正原记录ID",
          "备注",
          "流水ID",
        ]
      : [
          "Date",
          "Immeuble",
          "Chambre",
          "Client",
          "Responsable (pas encaisseur)",
          "Type",
          "Moyen",
          "Reçu",
          "Montant original",
          "Devise",
          "Montant net XOF",
          "Motif exclusion",
          "Enregistré à",
          "Séjour ID",
          "Paiement annulé ID",
          "Note",
          "Paiement ID",
        ];
  const cell = (value: string | number | null) => {
    const text = String(value ?? "");
    const safe =
      typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      labels.map(cell).join(","),
      ...result.rows.map((row) => columns.map((key) => cell(row[key])).join(",")),
    ].join("\r\n")
  );
}
