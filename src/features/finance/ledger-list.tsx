"use client";

import { useState, useMemo } from "react";
import { Plus, X, Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";
import type { LedgerEntryRow } from "@/types/database";
import type { CurrencyCode } from "@/types/domain";
import { addLedgerEntry } from "./actions";
import { ReceiptThumb } from "@/components/attachments/receipt-thumb";

function formatLedgerDescription(description: string | null | undefined): string {
  const raw = description?.trim();
  if (!raw) return "-";
  const managedRent = raw.match(/^Room\s+(\S+)\s+managed lease rent received,\s*([\d-]+)\s+to\s+([\d-]+)$/i);
  if (managedRent) return `${managedRent[1]}房 代管长租租金 ${managedRent[2]} 至 ${managedRent[3]}`;
  const managedDeposit = raw.match(/^Room\s+(\S+)\s+managed lease deposit received\s+\(([^)]+)\)$/i);
  if (managedDeposit) return `${managedDeposit[1]}房 代管长租押金 ${managedDeposit[2]}`;
  const leaseRent = raw.match(/^Room\s+(\S+)\s+lease rent received for\s*([\d-]+)\s+to\s+([\d-]+)$/i);
  if (leaseRent) return `${leaseRent[1]}房 长租租金 ${leaseRent[2]} 至 ${leaseRent[3]}`;
  const leaseDeposit = raw.match(/^Room\s+(\S+)\s+lease deposit received\s+\(([^)]+)\)$/i);
  if (leaseDeposit) return `${leaseDeposit[1]}房 长租押金 ${leaseDeposit[2]}`;
  return raw
    .replace(/\s+(booking|lease|receivable|sale|payment)=[0-9a-f-]{8,}/gi, "")
    .replace(/\s+installment=(\d+)/gi, " 第$1期")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildLedgerCsv(entries: LedgerEntryRow[]): string {
  const header = "Date,Direction,Category,Amount_XOF,Amount_CNY,Description";
  const rows = entries.map((e) =>
    [e.entry_date, e.direction, e.category, e.amount_xof, e.amount_cny ?? "", `"${formatLedgerDescription(e.description).replace(/"/g, '""')}"`].join(",")
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

const inputClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
const labelClass = "block mb-1 text-xs font-semibold text-muted-foreground";

export function LedgerList({ entries, units, buildingId, locale, attachments }: LedgerListProps) {
  const t = dictionaries[locale].finance;
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dirFilter, setDirFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");

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
  const [eCurrency, setECurrency] = useState<CurrencyCode>("XOF");
  const [eRate, setERate] = useState(1);
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
    });
  }, [entries, startDate, endDate, dirFilter, catFilter, search, units]);

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

  const handleSave = async () => {
    setSaving(true); setError("");
    const result = await addLedgerEntry({
      buildingId: buildingId ?? undefined,
      unitId: eUnitId || undefined,
      entryDate: eDate, direction: eDir, category: eCat,
      amount: eAmount, currency: eCurrency, exchangeRateToXof: eRate,
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

  const filterSelect = "h-9 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
  const filterDate = "h-9 w-[150px] rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-accentGreen-500 shrink-0" />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{formatXof(summary.income)}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.totalIncome}</p></div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-accentRed-500 shrink-0" />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{formatXof(summary.expense)}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.totalExpense}</p></div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", summary.net >= 0 ? "bg-accentBlue-500" : "bg-accentAmber-500")} />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{formatXof(summary.net)}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.netBalance}</p></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <DateInput value={startDate} onChangeValue={setStartDate} className={filterDate} />
          <span className="text-xs font-semibold text-muted-foreground">-</span>
          <DateInput value={endDate} onChangeValue={setEndDate} className={filterDate} />
          <select value={dirFilter} onChange={(e) => setDirFilter(e.target.value)} className={filterSelect}>
            <option value="all">{t.filters.direction}: {t.filters.all}</option>
            <option value="income">{t.directions.income}</option>
            <option value="expense">{t.directions.expense}</option>
            <option value="liability_in">{t.directions.liability_in}</option>
            <option value="liability_out">{t.directions.liability_out}</option>
          </select>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className={filterSelect}>
            <option value="all">{t.filters.category}: {t.filters.all}</option>
            {allCategories.map(c => <option key={c} value={c}>{t.categories[c as keyof typeof t.categories]}</option>)}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={locale === "zh" ? "搜索描述/房号..." : "Rechercher description, chambre..."}
            className="h-9 w-48 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCsv} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-accent disabled:opacity-40">
            <Download className="h-4 w-4" />{t.export.csv}
          </button>
          <button onClick={() => setShowNewEntry(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]">
            <Plus className="h-4 w-4" />{t.entry.title}
          </button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 shadow-sm">
          <p className="text-sm font-semibold text-muted-foreground">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed text-left text-[13px]">
              <colgroup>
                <col className="w-[130px]" />
                <col className="w-[110px]" />
                <col className="w-[210px]" />
                <col className="w-[150px]" />
                <col className="w-[90px]" />
                <col />
                {attachments && attachments.length > 0 && <col className="w-14" />}
              </colgroup>
              <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{t.filters.dateRange}</th>
                  <th className="px-4 py-2.5">{t.filters.direction}</th>
                  <th className="px-4 py-2.5">{t.filters.category}</th>
                  <th className="px-4 py-2.5">XOF</th>
                  <th className="px-4 py-2.5">CNY</th>
                  <th className="px-4 py-2.5">{t.entry.description}</th>
                  {attachments && attachments.length > 0 && <th className="px-4 py-2.5"></th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((e) => {
                  const unit = e.unit_id ? units.find(u => u.id === e.unit_id) : null;
                  return (
                    <tr key={e.id} className="transition-colors hover:bg-accent/50">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{e.entry_date}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={cn("text-sm font-semibold", dirColor[e.direction])}>{t.directions[e.direction as keyof typeof t.directions]}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="truncate">
                          <span>{t.categories[e.category as keyof typeof t.categories] ?? e.category}</span>
                          {unit && <span className="ml-1 text-muted-foreground">({unit.unit_no})</span>}
                        </div>
                      </td>
                      <td className={cn("px-4 py-2.5 tabular-nums font-semibold", e.direction === "expense" || e.direction === "liability_out" ? "text-rose-600" : "text-emerald-600")}>
                        {e.direction === "expense" || e.direction === "liability_out" ? "-" : ""}{formatXof(Number(e.amount_xof))}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{e.amount_cny != null ? Number(e.amount_cny).toLocaleString() : "-"}</td>
                      <td className="truncate px-4 py-2.5 text-muted-foreground">{formatLedgerDescription(e.description)}</td>
                      {attachments && attachments.length > 0 && (
                        <td className="px-2 py-2.5">
                          {e.payment_id && attachmentByPayment.has(e.payment_id) && (
                            <ReceiptThumb attachment={attachmentByPayment.get(e.payment_id)!} locale={locale as "zh" | "fr"} />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{filtered.length} {locale === "fr" ? "écritures" : "条记录"}</p>

      {/* New entry side panel */}
      {showNewEntry && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={() => setShowNewEntry(false)} />
          <div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l bg-card shadow-lg">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-4 backdrop-blur">
              <h3 className="text-sm font-bold">{t.entry.title}</h3>
              <button onClick={() => setShowNewEntry(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4" /></button>
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
              <div className="grid grid-cols-3 gap-2">
                <div><label className={labelClass}>{t.entry.currency}</label><select value={eCurrency} onChange={(e) => setECurrency(e.target.value as CurrencyCode)} className={inputClass}><option value="XOF">XOF</option><option value="CNY">CNY</option></select></div>
                <div><label className={labelClass}>{t.entry.exchangeRate}</label><input type="number" value={eRate} onChange={(e) => setERate(Number(e.target.value))} className={inputClass} /></div>
                <div><label className={labelClass}>{t.entry.amount}</label><input type="number" value={eAmount} onChange={(e) => setEAmount(Number(e.target.value))} className={inputClass} /></div>
              </div>
              <div className="rounded-md bg-muted p-2 text-center text-sm font-bold">
                {t.entry.amountXof}: {formatXof(eCurrency === "XOF" ? eAmount : Math.round(eAmount * eRate))}
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
              <div><label className={labelClass}>{t.entry.description}</label><textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={3} className={inputClass} /></div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button onClick={handleSave} disabled={saving} className="w-full rounded-md bg-primary py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{saving ? "..." : t.entry.save}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
