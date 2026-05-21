"use client";

import { useState, useMemo } from "react";
import { Plus, X, Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type { LedgerEntryRow } from "@/types/database";
import type { CurrencyCode } from "@/types/domain";
import { addLedgerEntry } from "./actions";

function buildLedgerCsv(entries: LedgerEntryRow[]): string {
  const header = "Date,Direction,Category,Amount_XOF,Amount_CNY,Description";
  const rows = entries.map((e) =>
    [e.entry_date, e.direction, e.category, e.amount_xof, e.amount_cny ?? "", `"${(e.description ?? "").replace(/"/g, '""')}"`].join(",")
  );
  return [header, ...rows].join("\n");
}

interface UnitSummary { id: string; unit_no: string }

interface LedgerListProps {
  entries: LedgerEntryRow[];
  units: UnitSummary[];
  buildingId: string | null;
  locale: Locale;
}

const allCategories = [
  "daily_rental", "lease_rent", "lease_deposit", "sale", "other_income",
  "maintenance", "cleaning_wages", "garbage", "utilities", "property_management",
  "tax", "agency_commission", "other_expense",
];

export function LedgerList({ entries, units, buildingId, locale }: LedgerListProps) {
  const t = dictionaries[locale].finance;
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dirFilter, setDirFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
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

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20";
  const labelClass = "block mb-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500";

  const dirColor: Record<string, string> = {
    income: "text-brand-green-700", expense: "text-brand-red-700",
    liability_in: "text-brand-sky-700", liability_out: "text-brand-amber-700",
  };

  return (
    <div>
      {/* Summary cards */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <FinanceMetric label={t.summary.totalIncome} value={formatXof(summary.income)} tone="green" />
        <FinanceMetric label={t.summary.totalExpense} value={formatXof(summary.expense)} tone="red" />
        <FinanceMetric label={t.summary.netBalance} value={formatXof(summary.net)} tone={summary.net >= 0 ? "green" : "orange"} />
      </div>

      {/* Toolbar */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-natural">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20" />
            <span className="text-xs font-semibold text-slate-400">-</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20" />
            <select value={dirFilter} onChange={(e) => setDirFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20">
              <option value="all">{t.filters.direction}: {t.filters.all}</option>
              <option value="income">{t.directions.income}</option>
              <option value="expense">{t.directions.expense}</option>
              <option value="liability_in">{t.directions.liability_in}</option>
              <option value="liability_out">{t.directions.liability_out}</option>
            </select>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20">
              <option value="all">{t.filters.category}: {t.filters.all}</option>
              {allCategories.map(c => <option key={c} value={c}>{t.categories[c as keyof typeof t.categories]}</option>)}
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={locale === "zh" ? "????/??..." : "Rechercher description, chambre..."}
              className="w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 hover:bg-slate-50 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExportCsv} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" />{t.export.csv}
            </button>
            <button onClick={() => setShowNewEntry(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98]">
              <Plus className="h-3.5 w-3.5" />{t.entry.title}
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-16 shadow-natural">
          <p className="text-sm font-semibold text-slate-400">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-natural">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[800px] text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3">{t.filters.dateRange}</th>
                  <th className="px-4 py-3">{t.filters.direction}</th>
                  <th className="px-4 py-3">{t.filters.category}</th>
                  <th className="px-4 py-3 text-right">XOF</th>
                  <th className="px-4 py-3 text-right">CNY</th>
                  <th className="px-4 py-3">{t.entry.description}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const unit = e.unit_id ? units.find(u => u.id === e.unit_id) : null;
                  return (
                    <tr key={e.id} className="transition hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-sm text-slate-500">{e.entry_date}</td>
                      <td className="px-4 py-3">
                        <span className={cn("text-sm font-semibold", dirColor[e.direction])}>{t.directions[e.direction as keyof typeof t.directions]}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <span>{t.categories[e.category as keyof typeof t.categories] ?? e.category}</span>
                        {unit && <span className="ml-1 text-slate-400">({unit.unit_no})</span>}
                      </td>
                      <td className={cn("px-4 py-3 text-right text-sm font-semibold tabular-nums", e.direction === "expense" || e.direction === "liability_out" ? "text-brand-red-700" : "text-brand-green-700")}>
                        {e.direction === "expense" || e.direction === "liability_out" ? "-" : ""}{formatXof(Number(e.amount_xof))}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-500 tabular-nums">{e.amount_cny != null ? Number(e.amount_cny).toLocaleString() : "-"}</td>
                      <td className="max-w-[260px] truncate px-4 py-3 text-sm text-slate-500">{e.description ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">{filtered.length} {locale === "fr" ? "ecritures" : "???"}</p>

      {/* New entry panel */}
      {showNewEntry && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowNewEntry(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto border-l border-slate-200 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <h3 className="text-base font-black text-slate-950">{t.entry.title}</h3>
              <button onClick={() => setShowNewEntry(false)} className="rounded p-1 text-slate-400 hover:bg-slate-50/80"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.entry.date}</label><input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} className={inputClass} /></div>
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
              <div className="rounded bg-slate-50 p-2 text-center text-sm font-bold text-slate-950">
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
              {error && <p className="text-sm text-brand-red-600">{error}</p>}
              <button onClick={handleSave} disabled={saving} className="w-full rounded-xl bg-slate-950 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50">{saving ? "..." : t.entry.save}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FinanceMetric({ label, value, tone }: { label: string; value: string; tone: "green" | "red" | "orange" }) {
  const styles = {
    green: "border-emerald-200 bg-brand-green-50 text-brand-green-700",
    red: "border-brand-red-200 bg-brand-red-50 text-brand-red-700",
    orange: "border-brand-orange-200 bg-brand-orange-50 text-brand-orange-700",
  }[tone];

  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <p className="text-[11px] font-bold text-current opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}
