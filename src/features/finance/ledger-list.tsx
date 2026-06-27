"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X, Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";
import { Button } from "@/components/ui/button";
import { BusinessTable, BusinessTbody, BusinessTd, BusinessTh, BusinessThead, BusinessRow, MoneyCell, DEFAULT_BUSINESS_TABLE_PAGE_SIZE } from "@/components/ui/business-table";
import { DataVizCard, MiniLineChart } from "@/components/ui/data-viz";
import { FilterBar, FilterGroup, SegmentedControl, StatTile, controlClass } from "@/components/ui/operational";
import type { LedgerEntryRow } from "@/types/database";
import { addLedgerEntry } from "./actions";
import { ReceiptThumb } from "@/components/attachments/receipt-thumb";
import { SearchInput } from "@/components/ui/search-input";

function normalizeDepositPeriod(value: string): string {
  return value.trim().replace(/^(\d+)\s*months?$/i, "$1个月");
}

function formatLedgerDescription(description: string | null | undefined): string {
  const raw = description?.trim();
  if (!raw) return "-";
  const managedRent = raw.match(/^Room\s+(\S+)\s+managed lease rent received,\s*([\d-]+)\s+to\s+([\d-]+)$/i);
  if (managedRent) return `${managedRent[1]}房 代管长租租金 ${managedRent[2]} 至 ${managedRent[3]}`;
  const managedDeposit = raw.match(/^Room\s+(\S+)\s+managed lease deposit received\s+\(([^)]+)\)$/i);
  if (managedDeposit) return `${managedDeposit[1]}房 代管长租押金 ${normalizeDepositPeriod(managedDeposit[2])}`;
  const leaseRent = raw.match(/^Room\s+(\S+)\s+lease rent received for\s*([\d-]+)\s+to\s+([\d-]+)$/i);
  if (leaseRent) return `${leaseRent[1]}房 长租租金 ${leaseRent[2]} 至 ${leaseRent[3]}`;
  const leaseDeposit = raw.match(/^Room\s+(\S+)\s+lease deposit received\s+\(([^)]+)\)$/i);
  if (leaseDeposit) return `${leaseDeposit[1]}房 长租押金 ${normalizeDepositPeriod(leaseDeposit[2])}`;
  return raw
    .replace(/\s+(booking|lease|receivable|sale|payment)=[0-9a-f-]{8,}/gi, "")
    .replace(/\s+installment=(\d+)/gi, " 第$1期")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildLedgerCsv(entries: LedgerEntryRow[]): string {
  const header = "Date,Direction,Category,Amount_XOF,Description";
  const rows = entries.map((e) =>
    [e.entry_date, e.direction, e.category, e.amount_xof, `"${formatLedgerDescription(e.description).replace(/"/g, '""')}"`].join(",")
  );
  return [header, ...rows].join("\n");
}

interface UnitSummary { id: string; unit_no: string }

interface AttachmentRow { id: string; storage_path: string; linked_id: string; file_type: string; ocr_text: string | null; ocr_provider: string | null; metadata: Record<string, unknown> | null; paper_archive_status: string; paper_archive_location: string | null; uploaded_at: string; }

interface LedgerListProps {
  entries: LedgerEntryRow[];
  units: UnitSummary[];
  buildingId: string | null;
  locale: Locale;
  attachments?: AttachmentRow[];
}

const allCategories = [
  "daily_rental", "lease_rent", "lease_deposit", "sale", "other_income",
  "maintenance", "cleaning_wages", "garbage", "utilities", "property_management",
  "tax", "agency_commission", "other_expense",
];

const inputClass = cn("w-full", controlClass);
const labelClass = "block mb-1 text-xs font-semibold text-muted-foreground";
const pageSize = DEFAULT_BUSINESS_TABLE_PAGE_SIZE;

export function LedgerList({ entries, units, buildingId, locale, attachments }: LedgerListProps) {
  const t = dictionaries[locale].finance;
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dirFilter, setDirFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [page, setPage] = useState(1);

  const attachmentByPayment = useMemo(() => {
    const map = new Map<string, AttachmentRow>();
    for (const a of (attachments ?? [])) map.set(a.linked_id, a);
    return map;
  }, [attachments]);
  const [search, setSearch] = useState("");
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // New entry form
  const [eDate, setEDate] = useState(new Date().toISOString().slice(0, 10));
  const [eDir, setEDir] = useState<"income" | "expense" | "liability_in" | "liability_out">("income");
  const [eCat, setECat] = useState("other_income");
  const [eAmount, setEAmount] = useState(0);
  const [eDesc, setEDesc] = useState("");
  const [eReceiptNo, setEReceiptNo] = useState("");
  const [eUnitId, setEUnitId] = useState("");

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (startDate && e.entry_date < startDate) return false;
      if (endDate && e.entry_date > endDate) return false;
      if (dirFilter !== "all" && e.direction !== dirFilter) return false;
      if (catFilter !== "all" && e.category !== catFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const desc = (e.description ?? "").toLowerCase();
        const unit = units.find(u => u.id === e.unit_id);
        const unitNo = (unit?.unit_no ?? "").toLowerCase();
        if (!desc.includes(s) && !unitNo.includes(s)) return false;
      }
      return true;
    }).sort((a, b) => {
      const dateCompare = b.entry_date.localeCompare(a.entry_date);
      if (dateCompare !== 0) return dateCompare;
      const unitA = units.find(u => u.id === a.unit_id)?.unit_no ?? "";
      const unitB = units.find(u => u.id === b.unit_id)?.unit_no ?? "";
      const roomCompare = unitA.localeCompare(unitB, undefined, { numeric: true });
      if (roomCompare !== 0) return roomCompare;
      return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    });
  }, [entries, startDate, endDate, dirFilter, catFilter, search, units]);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, dirFilter, catFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedEntries = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [currentPage, filtered]);

  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of filtered) {
      const amt = Number(e.amount_xof);
      if (e.direction === "income") income += amt;
      else if (e.direction === "expense") expense += amt;
      else if (e.direction === "liability_in") income += amt;
      else if (e.direction === "liability_out") expense += amt;
    }
    return { income, expense, net: income - expense };
  }, [filtered]);

  const monthlyTrend = useMemo(() => {
    const buckets = new Map<string, number>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.set(d.toISOString().slice(0, 7), 0);
    }
    for (const e of filtered) {
      const key = e.entry_date.slice(0, 7);
      if (!buckets.has(key)) continue;
      const amount = Number(e.amount_xof);
      buckets.set(key, (buckets.get(key) ?? 0) + (e.direction === "expense" || e.direction === "liability_out" ? -amount : amount));
    }
    return [...buckets.entries()].map(([month, value]) => ({ month, value }));
  }, [filtered]);

  const handleSave = async () => {
    setSaving(true); setError("");
    const result = await addLedgerEntry({
      buildingId: buildingId ?? undefined,
      unitId: eUnitId || undefined,
      entryDate: eDate, direction: eDir, category: eCat,
      amount: eAmount, currency: "XOF", exchangeRateToXof: 1,
      description: eDesc || undefined, receiptNo: eReceiptNo || undefined,
    });
    setSaving(false);
    if (result.success) {
      setShowNewEntry(false);
      setEAmount(0); setEDesc(""); setEReceiptNo("");
    } else {
      setError(result.error ?? "Failed");
    }
  };

  const handleExportCsv = async () => {
    const csv = buildLedgerCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dirColor: Record<string, string> = {
    income: "text-emerald-600", expense: "text-rose-600",
    liability_in: "text-cyan-600", liability_out: "text-amber-600",
  };

  const filterDate = cn("w-[150px]", controlClass);

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        <StatTile tone="green" label={t.summary.totalIncome} value={formatXof(summary.income)} />
        <StatTile tone="red" label={t.summary.totalExpense} value={formatXof(summary.expense)} />
        <StatTile tone={summary.net >= 0 ? "blue" : "amber"} label={t.summary.netBalance} value={formatXof(summary.net)} />
      </div>

      <DataVizCard
        title={locale === "zh" ? "近 6 个月净现金流" : "Flux net sur 6 mois"}
        description={locale === "zh" ? "按当前筛选条件聚合收入与支出" : "Agrégé selon les filtres actifs"}
        metric={formatXof(summary.net)}
      >
        <MiniLineChart
          tone={summary.net >= 0 ? "green" : "amber"}
          values={monthlyTrend.map((item) => item.value)}
          label={monthlyTrend.map((item) => `${item.month} ${formatXof(item.value)}`).join(" · ")}
        />
      </DataVizCard>

      <FilterBar
        meta={
          <div className="flex items-center gap-2">
            <Button onClick={handleExportCsv} disabled={filtered.length === 0} variant="outline" size="sm">
              <Download className="h-4 w-4" />{t.export.csv}
            </Button>
            <Button onClick={() => setShowNewEntry(true)} size="sm">
              <Plus className="h-4 w-4" />{t.entry.title}
            </Button>
          </div>
        }
      >
        <FilterGroup label={t.filters.dateRange}>
          <DateInput value={startDate} onChangeValue={setStartDate} className={filterDate} />
          <span className="px-0.5 text-xs font-semibold text-muted-foreground">-</span>
          <DateInput value={endDate} onChangeValue={setEndDate} className={filterDate} />
        </FilterGroup>
        <FilterGroup label={t.filters.direction}>
          <SegmentedControl
            value={dirFilter}
            onChange={setDirFilter}
            ariaLabel={t.filters.direction}
            items={[
              { value: "all", label: t.filters.all },
              { value: "income", label: t.directions.income },
              { value: "expense", label: t.directions.expense },
              { value: "liability_in", label: t.directions.liability_in },
              { value: "liability_out", label: t.directions.liability_out },
            ]}
          />
        </FilterGroup>
        <FilterGroup label={t.filters.category}>
          <SegmentedControl
            value={catFilter}
            onChange={setCatFilter}
            ariaLabel={t.filters.category}
            items={[
              { value: "all", label: t.filters.all },
              ...allCategories.map((value) => ({ value, label: t.categories[value as keyof typeof t.categories] })),
            ]}
          />
        </FilterGroup>
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={locale === "zh" ? "搜索描述/房号..." : "Rechercher description, chambre..."}
          className="w-full sm:w-[240px]"
        />
      </FilterBar>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 shadow-sm">
          <p className="text-sm font-semibold text-muted-foreground">{t.empty}</p>
        </div>
      ) : (
        <>
        <BusinessTable minWidth="min-w-[960px]">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[38%]" />
                {attachments && attachments.length > 0 && <col className="w-14" />}
              </colgroup>
              <BusinessThead>
                <tr>
                  <BusinessTh>{t.filters.dateRange}</BusinessTh>
                  <BusinessTh align="center">{t.filters.direction}</BusinessTh>
                  <BusinessTh>{t.filters.category}</BusinessTh>
                  <BusinessTh align="right">XOF</BusinessTh>
                  <BusinessTh>{t.entry.description}</BusinessTh>
                  {attachments && attachments.length > 0 && <BusinessTh align="center"></BusinessTh>}
                </tr>
              </BusinessThead>
              <BusinessTbody>
                {pagedEntries.map((e) => {
                  const unit = e.unit_id ? units.find(u => u.id === e.unit_id) : null;
                  return (
                    <BusinessRow key={e.id}>
                      <BusinessTd className="text-muted-foreground">{e.entry_date}</BusinessTd>
                      <BusinessTd align="center">
                        <span className={cn("text-sm font-semibold", dirColor[e.direction])}>{t.directions[e.direction as keyof typeof t.directions]}</span>
                      </BusinessTd>
                      <BusinessTd>
                        <div className="truncate">
                          <span>{t.categories[e.category as keyof typeof t.categories] ?? e.category}</span>
                          {unit && <span className="ml-1 text-muted-foreground">({unit.unit_no})</span>}
                        </div>
                      </BusinessTd>
                      <MoneyCell tone={e.direction === "expense" || e.direction === "liability_out" ? "expense" : "income"}>
                        {e.direction === "expense" || e.direction === "liability_out" ? "-" : ""}{formatXof(Number(e.amount_xof))}
                      </MoneyCell>
                      <BusinessTd className="truncate text-muted-foreground">{formatLedgerDescription(e.description)}</BusinessTd>
                      {attachments && attachments.length > 0 && (
                        <BusinessTd align="center" className="px-2">
                          {e.payment_id && attachmentByPayment.has(e.payment_id) && (
                            <ReceiptThumb attachment={attachmentByPayment.get(e.payment_id)!} locale={locale as "zh" | "fr"} />
                          )}
                        </BusinessTd>
                      )}
                    </BusinessRow>
                  );
                })}
              </BusinessTbody>
        </BusinessTable>
          {filtered.length > pageSize && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                {locale === "fr"
                  ? `${filtered.length} écritures, ${pageSize} par page`
                  : `共 ${filtered.length} 条，每页 ${pageSize} 条`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage <= 1}
                  variant="outline"
                  size="sm"
                >
                  {locale === "fr" ? "Précédent" : "上一页"}
                </Button>
                <span className="min-w-20 text-center font-semibold text-foreground">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  type="button"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={currentPage >= totalPages}
                  variant="outline"
                  size="sm"
                >
                  {locale === "fr" ? "Suivant" : "下一页"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">{filtered.length} {locale === "fr" ? "écritures" : "条记录"}</p>

      {/* New entry side panel */}
      {showNewEntry && (
        <>
          <div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={() => setShowNewEntry(false)} />
          <div className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-full overflow-auto border-l border-border bg-card shadow-panel lg:max-w-[480px]">
            <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
              <h3 className="text-[15px] font-semibold">{t.entry.title}</h3>
              <button onClick={() => setShowNewEntry(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.entry.date}</label><DateInput value={eDate} onChangeValue={setEDate} className={inputClass} /></div>
              <div>
                <label className={labelClass}>{t.entry.direction}</label>
                <select value={eDir} onChange={(e) => setEDir(e.target.value as typeof eDir)} className={inputClass}>
                  <option value="income">{t.directions.income}</option>
                  <option value="expense">{t.directions.expense}</option>
                  <option value="liability_in">{t.directions.liability_in}</option>
                  <option value="liability_out">{t.directions.liability_out}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.entry.category}</label>
                <select value={eCat} onChange={(e) => setECat(e.target.value)} className={inputClass}>
                  {allCategories.map(c => <option key={c} value={c}>{t.categories[c as keyof typeof t.categories]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.entry.amount} (XOF)</label>
                <input type="number" value={eAmount} onChange={(e) => setEAmount(Number(e.target.value))} className={inputClass} />
              </div>
              <div className="rounded-md bg-muted p-2 text-center text-sm font-semibold">
                {t.entry.amountXof}: {formatXof(eAmount)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelClass}>{t.entry.receiptNo}</label><input type="text" value={eReceiptNo} onChange={(e) => setEReceiptNo(e.target.value)} className={inputClass} /></div>
                <div>
                  <label className={labelClass}>{t.entry.unit}</label>
                  <select value={eUnitId} onChange={(e) => setEUnitId(e.target.value)} className={inputClass}>
                    <option value="">-</option>
                    {units.slice(0, 100).map(u => <option key={u.id} value={u.id}>{u.unit_no}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={labelClass}>{t.entry.description}</label><textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={3} className={cn(inputClass, "resize-none overflow-hidden")} /></div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "..." : t.entry.save}</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
