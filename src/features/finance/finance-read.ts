export type FinanceKind = "ledger" | "receivables";
export type FinanceFilters = Record<string, string>;
export interface FinanceReadResult {
  kind: FinanceKind;
  page: number;
  pageSize: number;
  total: number;
  summary: Record<string, number>;
  rows: Array<Record<string, string | number | null>>;
}

export function parseFinanceRead(params: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new Error("Duplicate finance filter");
    return value?.trim() ?? "";
  };
  const kind = one("kind") || "ledger";
  if (kind !== "ledger" && kind !== "receivables") throw new Error("Invalid finance kind");
  const page = Number(one("page") || "1");
  if (!Number.isInteger(page) || page < 1 || page > 2_000_000)
    throw new Error("Invalid finance page");
  const filters: FinanceFilters = {};
  for (const key of [
    "dateFrom",
    "dateTo",
    "buildingId",
    "direction",
    "category",
    "status",
    "management",
    "search",
  ]) {
    const value = one(key);
    if (value.length > 150) throw new Error("Finance filter too long");
    if (value) filters[key] = value;
  }
  if (kind === "ledger") {
    delete filters.status;
    delete filters.management;
  } else {
    delete filters.direction;
  }
  for (const key of ["dateFrom", "dateTo"]) {
    const value = filters[key];
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    ) {
      throw new Error("Invalid finance date");
    }
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
    throw new Error("Invalid date range");
  if (
    filters.buildingId &&
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(filters.buildingId)
  )
    throw new Error("Invalid building");
  if (
    filters.direction &&
    !["income", "expense", "liability_in", "liability_out"].includes(filters.direction)
  )
    throw new Error("Invalid direction");
  if (
    filters.status &&
    !["pending", "partial", "paid", "overdue", "cancelled"].includes(filters.status)
  )
    throw new Error("Invalid status");
  if (
    filters.management &&
    !["managed", "historical_pending", "excluded", "all"].includes(filters.management)
  )
    throw new Error("Invalid management filter");
  return { kind: kind as FinanceKind, page, filters };
}

export function financeCsv(result: FinanceReadResult) {
  const columns =
    result.kind === "ledger"
      ? [
          "entry_date",
          "building_label",
          "unit_label",
          "direction",
          "category",
          "amount_xof",
          "description",
          "id",
        ]
      : [
          "due_date",
          "building_label",
          "unit_label",
          "category",
          "title",
          "amount_xof",
          "paid_amount_xof",
          "status",
          "id",
        ];
  const cell = (value: string | number | null | undefined) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.join(","),
      ...result.rows.map((row) => columns.map((key) => cell(row[key])).join(",")),
    ].join("\r\n")
  );
}
