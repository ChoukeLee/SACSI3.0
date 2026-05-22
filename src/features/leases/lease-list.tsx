"use client";

import { useState, useMemo } from "react";
import { Plus, X, AlertTriangle, FileText, DollarSign, LogOut, Printer, RefreshCw } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import { printLeaseContract } from "@/features/print";
import {
  createLeaseContract,
  activateContract,
  terminateContract,
  recordReceivablePayment,
  generateLeaseReceivables,
  processMoveOut,
} from "./actions";

interface LeaseListProps {
  contracts: LeaseContractRow[];
  units: UnitRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  locale: Locale;
}

type PanelType = "new" | "detail" | "moveout" | null;

const paymentCycles = ["monthly", "quarterly", "semiannual", "annual"];

export function LeaseList({ contracts, units, customers, payments, receivables, locale }: LeaseListProps) {
  const t = dictionaries[locale].leases;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [panel, setPanel] = useState<PanelType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [genMsg, setGenMsg] = useState("");

  // New contract form
  const [fContractNo, setFContractNo] = useState("");
  const [fUnitId, setFUnitId] = useState("");
  const [fCustomerId, setFCustomerId] = useState("");
  const [fStartDate, setFStartDate] = useState("");
  const [fEndDate, setFEndDate] = useState("");
  const [fCycle, setFCycle] = useState("monthly");
  const [fPayDay, setFPayDay] = useState(5);
  const [fRent, setFRent] = useState(0);
  const [fDeposit, setFDeposit] = useState(0);
  const [fDepositReceived, setFDepositReceived] = useState(false);
  const [fFreeDays, setFFreeDays] = useState(0);
  const [fSigner, setFSigner] = useState("");
  const [fStatus, setFStatus] = useState<ContractStatus>("draft");

  // Payment form (receivable-based)
  const [payReceivableId, setPayReceivableId] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payReceiptNo, setPayReceiptNo] = useState("");

  // Move-out form
  const [moEndDate, setMoEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [moUnpaid, setMoUnpaid] = useState(0);
  const [moUtility, setMoUtility] = useState(false);
  const [moDeduction, setMoDeduction] = useState(0);
  const [moRefund, setMoRefund] = useState(0);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return contracts;
    return contracts.filter((c) => c.status === statusFilter);
  }, [contracts, statusFilter]);

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const groupedContracts = useMemo(() => {
    const grouped = new Map<string, LeaseContractRow[]>();
    for (const contract of filtered) {
      const unit = unitMap.get(contract.unit_id);
      const floor = normalizeFloorLabel(unit?.floor_label ?? null, unit?.unit_no ?? "");
      if (!grouped.has(floor)) grouped.set(floor, []);
      grouped.get(floor)!.push(contract);
    }
    return Array.from(grouped.entries()).sort((a, b) => floorSortValue(a[0]) - floorSortValue(b[0]));
  }, [filtered, unitMap]);

  const getContractReceivableSummary = (contractId: string) => {
    const related = receivables.filter((r) => r.source_type === "lease_contract" && r.source_id === contractId && r.status !== "cancelled");
    const today = new Date().toISOString().slice(0, 10);
    let total = 0;
    let paid = 0;
    let overdue = 0;
    let nextDue: string | null = null;

    for (const r of related) {
      const amount = Number(r.amount_xof);
      const paidAmount = Number(r.paid_amount_xof);
      const outstanding = Math.max(0, amount - paidAmount);
      total += amount;
      paid += paidAmount;
      if (outstanding > 0 && (r.status === "overdue" || r.due_date < today)) overdue += outstanding;
      if (outstanding > 0 && (!nextDue || r.due_date < nextDue)) nextDue = r.due_date;
    }

    return { total, paid, outstanding: Math.max(0, total - paid), overdue, nextDue, count: related.length };
  };

  const selected = selectedId ? contracts.find((c) => c.id === selectedId) : null;
  const selectedUnit = selected ? units.find((u) => u.id === selected.unit_id) : null;
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer_id) : null;

  const dashboardStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = contracts.filter((c) => c.status === "active");
    const expiring = active.filter((c) => {
      const days = Math.floor((new Date(c.expected_end_date).getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 30;
    }).length;
    let due = 0;
    let overdue = 0;
    for (const r of receivables) {
      if (r.source_type !== "lease_contract" || r.status === "cancelled") continue;
      const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
      if (outstanding <= 0) continue;
      due += outstanding;
      if (r.status === "overdue" || r.due_date < today) overdue += outstanding;
    }
    return {
      active: active.length,
      rent: active.reduce((sum, c) => sum + Number(c.monthly_rent_xof), 0),
      expiring,
      due,
      overdue,
    };
  }, [contracts, receivables]);

  // Receivables for selected contract
  const contractReceivables = useMemo(
    () => selectedId
      ? receivables.filter(r => r.source_type === "lease_contract" && r.source_id === selectedId && r.status !== "cancelled")
      : [],
    [receivables, selectedId],
  );

  // Contract payment history
  const contractPayments = useMemo(
    () => selectedId ? payments.filter((p) => p.source_id === selectedId) : [],
    [payments, selectedId],
  );
  const totalPaid = contractPayments.reduce((s, p) => s + Number(p.amount), 0);

  // Receivable stats for selected contract
  const receivableStats = useMemo(() => {
    let totalRec = 0, totalPd = 0, overdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const r of contractReceivables) {
      totalRec += Number(r.amount_xof);
      totalPd += Number(r.paid_amount_xof);
      const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
      if (os > 0 && (r.status === "overdue" || r.due_date < today)) {
        overdue += os;
      }
    }
    return { totalReceivable: totalRec, totalPaid: totalPd, outstanding: totalRec - totalPd, overdue };
  }, [contractReceivables]);

  // Contract expiry risk
  const contractRisk = useMemo(() => {
    if (!selected || selected.status !== "active") return { expiringSoon: false, daysLeft: 0 };
    const today = new Date();
    const endDate = new Date(selected.expected_end_date);
    const diff = Math.floor((endDate.getTime() - today.getTime()) / 86400000);
    return { expiringSoon: diff <= 30 && diff >= 0, daysLeft: Math.max(0, diff) };
  }, [selected]);

  const availableUnits = useMemo(
    () => units.filter((u) => u.kind === "apartment" && u.status === "available"),
    [units],
  );

  const overdueDays = (r: ReceivableRow) => {
    if (r.status === "paid" || r.status === "cancelled") return null;
    const today = new Date().toISOString().slice(0, 10);
    if (r.due_date >= today) return null;
    return Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000);
  };

  const resetNewForm = () => {
    setFContractNo("");
    setFUnitId("");
    setFCustomerId("");
    setFStartDate("");
    setFEndDate("");
    setFCycle("monthly");
    setFPayDay(5);
    setFRent(0);
    setFDeposit(0);
    setFDepositReceived(false);
    setFFreeDays(0);
    setFSigner("");
    setFStatus("draft");
    setError("");
  };

  const openNew = () => {
    resetNewForm();
    setSelectedId(null);
    setPanel("new");
  };

  const openDetail = (id: string) => {
    setSelectedId(id);
    setPanel("detail");
    setError("");
    setGenMsg("");
    setPayReceivableId(null);
    const c = contracts.find((cc) => cc.id === id);
    if (c) {
      setPayDate(new Date().toISOString().slice(0, 10));
      setPayReceiptNo("");
      setMoUnpaid(0);
      setMoDeduction(0);
      setMoRefund(Number(c.deposit_amount_xof));
    }
  };

  const openMoveOut = (id: string) => {
    setSelectedId(id);
    setPanel("moveout");
    const c = contracts.find((cc) => cc.id === id);
    if (c) {
      setMoEndDate(new Date().toISOString().slice(0, 10));
      // Pre-fill unpaid from outstanding receivables
      let unpaid = 0;
      const today = new Date().toISOString().slice(0, 10);
      const cRecs = receivables.filter(r =>
        r.source_type === "lease_contract" && r.source_id === id &&
        r.status !== "cancelled" && r.status !== "paid"
      );
      for (const r of cRecs) {
        unpaid += Number(r.amount_xof) - Number(r.paid_amount_xof);
      }
      setMoUnpaid(unpaid);
      setMoUtility(false);
      setMoDeduction(0);
      setMoRefund(Number(c.deposit_amount_xof));
    }
  };

  const handleCreate = async () => {
    if (!fContractNo.trim()) { setError(t.form.contractNoRequired); return; }
    if (!fUnitId) { setError(t.form.noUnit); return; }
    if (!fCustomerId) { setError(t.form.noCustomer); return; }
    setSaving(true);
    setError("");
    const result = await createLeaseContract({
      unitId: fUnitId,
      customerId: fCustomerId,
      contractNo: fContractNo,
      startDate: fStartDate,
      expectedEndDate: fEndDate,
      paymentCycle: fCycle,
      paymentDay: fPayDay,
      monthlyRentXof: fRent,
      depositAmountXof: fDeposit,
      depositReceived: fDepositReceived,
      rentFreeDays: fFreeDays,
      signerName: fSigner || undefined,
      status: fStatus,
    });
    setSaving(false);
    if (result.success) {
      setPanel(null);
      resetNewForm();
    } else {
      setError(result.error ?? "Failed.");
    }
  };

  const handleActivate = async (id: string) => {
    setSaving(true);
    const result = await activateContract(id);
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
    else setGenMsg(locale === "zh" ? "合同已激活，应收已自动生成" : "Contrat active, echeances generees");
  };

  const handleTerminate = async (id: string) => {
    setSaving(true);
    const result = await terminateContract(id);
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
  };

  const handleGenerateReceivables = async (id: string) => {
    setSaving(true);
    setGenMsg("");
    const result = await generateLeaseReceivables(id);
    setSaving(false);
    if (result.success) {
      setGenMsg(t.receivable.generated.replace("{count}", String(result.count)));
    } else {
      setError(result.error ?? "Failed");
    }
  };

  const handleCollectReceivable = async () => {
    if (!payReceivableId) return;
    setSaving(true);
    setError("");
    const result = await recordReceivablePayment({
      receivableId: payReceivableId,
      paymentDate: payDate,
      receiptNo: payReceiptNo || undefined,
    });
    setSaving(false);
    if (result.success) {
      setPayReceivableId(null);
      setPayReceiptNo("");
    } else {
      setError(result.error ?? "Failed");
    }
  };

  const handleMoveOut = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    const result = await processMoveOut({
      contractId: selectedId,
      actualEndDate: moEndDate,
      unpaidRentXof: moUnpaid,
      utilityCleared: moUtility,
      depositDeductionXof: moDeduction,
      depositRefundXof: moRefund,
    });
    setSaving(false);
    if (result.success) setPanel(null);
    else setError(result.error ?? "Failed");
  };

  const inputClass =
    "w-full rounded-xl border border-brand-warm-200 bg-white px-3 py-2 text-sm text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30";
  const labelClass = "block text-[11px] font-black uppercase tracking-[0.14em] text-brand-ink-500 mb-1";

  const statusVariant: Record<string, "neutral" | "success" | "danger" | "warning"> = {
    draft: "neutral",
    active: "success",
    terminated: "danger",
    expired: "warning",
  };

  const STATUS_STYLES: Record<string, string> = {
    pending:   "bg-brand-warm-100 text-brand-ink-700",
    partial:   "bg-brand-amber-100 text-brand-amber-700",
    paid:      "bg-brand-green-100 text-brand-green-700",
    overdue:   "bg-brand-red-100 text-brand-red-700",
    cancelled: "bg-brand-warm-50 text-brand-ink-400 line-through",
  };

  const ROW_BG: Record<string, string> = {
    overdue:   "bg-brand-red-50/30",
    partial:   "bg-brand-amber-50/30",
    paid:      "",
    pending:   "",
    cancelled: "opacity-60",
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = locale === "zh"
      ? { pending: "待收", partial: "部分", paid: "已收", overdue: "逾期", cancelled: "已取消" }
      : { pending: "Attente", partial: "Partiel", paid: "Paye", overdue: "Retard", cancelled: "Annule" };
    return labels[status] ?? status;
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-5">
        <LeaseMetric label={locale === "zh" ? "生效合同" : "Actifs"} value={String(dashboardStats.active)} tone="slate" />
        <LeaseMetric label={locale === "zh" ? "月租规模" : "Loyer/mois"} value={formatXof(dashboardStats.rent)} tone="green" />
        <LeaseMetric label={locale === "zh" ? "30天到期" : "30 jours"} value={String(dashboardStats.expiring)} tone="amber" />
        <LeaseMetric label={locale === "zh" ? "待收账款" : "A recevoir"} value={formatXof(dashboardStats.due)} tone="sky" />
        <LeaseMetric label={locale === "zh" ? "逾期金额" : "Retard"} value={formatXof(dashboardStats.overdue)} tone="rose" />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-brand-warm-200 bg-white p-3 shadow-natural sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {["all", "draft", "active", "terminated", "expired"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-bold transition-colors duration-[100ms]",
                statusFilter === s
                  ? "bg-brand-orange-500 text-white"
                  : "border border-brand-warm-300 bg-white text-brand-neutral-600 hover:bg-brand-orange-50"
              )}
            >
              {s === "all" ? (locale === "fr" ? "Tous" : "全部") : t.contractStatus[s as keyof typeof t.contractStatus]}
            </button>
          ))}
          <span className="pl-1 text-xs font-semibold text-brand-ink-400">
            {filtered.length} / {contracts.length} {locale === "fr" ? "contrats" : "份合同"}
          </span>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-orange-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors duration-[100ms] hover:bg-brand-orange-600 active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.form.newContract}
        </button>
      </div>

      {groupedContracts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-warm-200 bg-white py-16 shadow-natural">
          <p className="text-sm text-brand-ink-400">{t.empty}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedContracts.map(([floor, floorContracts]) => (
            <section key={floor} className="rounded-2xl border border-brand-warm-200 bg-white p-4 shadow-natural">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-orange-500" />
                  <h3 className="text-sm font-black text-brand-ink-900">{floor}</h3>
                </div>
                <span className="rounded-full bg-brand-warm-100 px-2.5 py-1 text-xs font-bold text-brand-ink-500">
                  {floorContracts.length} {locale === "fr" ? "contrats" : "份合同"}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                {floorContracts.map((contract) => {
                  const unit = unitMap.get(contract.unit_id);
                  const customer = customerMap.get(contract.customer_id);
                  const summary = getContractReceivableSummary(contract.id);
                  const daysLeft = Math.floor((new Date(contract.expected_end_date).getTime() - Date.now()) / 86400000);
                  const isRisk = summary.overdue > 0 || (contract.status === "active" && daysLeft >= 0 && daysLeft <= 30);

                  return (
                    <button
                      key={contract.id}
                      onClick={() => openDetail(contract.id)}
                      className={cn(
                        "group flex min-h-[198px] flex-col rounded-2xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel",
                        isRisk ? "border-brand-amber-200 bg-brand-amber-50/40 ring-1 ring-brand-amber-100" : "border-brand-warm-300 hover:border-brand-orange-200",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-base font-black leading-none text-brand-ink-900">{unit?.unit_no ?? "-"}</p>
                          <p className="mt-2 truncate text-xs font-black text-brand-ink-700">{customer?.name ?? "-"}</p>
                          <p className="mt-1 truncate text-[10px] font-semibold text-brand-ink-400">{contract.contract_no}</p>
                        </div>
                        <Badge variant={statusVariant[contract.status]}>
                          {t.contractStatus[contract.status as keyof typeof t.contractStatus]}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <LeaseCardField label={locale === "zh" ? "月租" : "Loyer"} value={formatXof(Number(contract.monthly_rent_xof))} />
                        <LeaseCardField label={locale === "zh" ? "押金" : "Depot"} value={formatXof(Number(contract.deposit_amount_xof))} tone={contract.deposit_received ? "green" : "amber"} />
                        <LeaseCardField label={locale === "zh" ? "起租" : "Debut"} value={contract.start_date} />
                        <LeaseCardField label={locale === "zh" ? "到期" : "Fin"} value={contract.expected_end_date} tone={daysLeft >= 0 && daysLeft <= 30 ? "amber" : "slate"} />
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <LeaseCardField label={locale === "zh" ? "待收" : "Solde"} value={formatXof(summary.outstanding)} tone={summary.outstanding > 0 ? "sky" : "green"} />
                        <LeaseCardField label={locale === "zh" ? "逾期" : "Retard"} value={formatXof(summary.overdue)} tone={summary.overdue > 0 ? "rose" : "green"} />
                      </div>

                      <div className="mt-auto pt-2">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-brand-ink-400">
                          <span>{locale === "zh" ? "下一应收" : "Prochaine"}</span>
                          <span className="text-brand-ink-600">{summary.nextDue ?? "-"}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}


      {/* ── New Contract Panel ── */}
      {panel === "new" && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l border-brand-warm-200 bg-white shadow-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-200 bg-white px-5 py-4">
              <h3 className="text-base font-black text-brand-ink-900">{t.form.newContract}</h3>
              <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-400 hover:bg-brand-warm-50/80"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.form.contractNo} *</label><input type="text" value={fContractNo} onChange={(e) => setFContractNo(e.target.value)} className={inputClass} /></div>
              <div>
                <label className={labelClass}>{t.form.unit} *</label>
                <select value={fUnitId} onChange={(e) => setFUnitId(e.target.value)} className={inputClass}>
                  <option value="">{t.form.noUnit}</option>
                  {availableUnits.map((u) => <option key={u.id} value={u.id}>{u.unit_no} ({u.floor_label})</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.form.customer} *</label>
                <select value={fCustomerId} onChange={(e) => setFCustomerId(e.target.value)} className={inputClass}>
                  <option value="">{t.form.noCustomer}</option>
                  {customers.filter((cc) => !cc.is_blacklisted).map((cc) => <option key={cc.id} value={cc.id}>{cc.name} {cc.phone ? `(${cc.phone})` : ""}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>{t.form.startDate}</label><input type="date" value={fStartDate} onChange={(e) => setFStartDate(e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>{t.form.expectedEndDate}</label><input type="date" value={fEndDate} onChange={(e) => setFEndDate(e.target.value)} className={inputClass} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>{t.form.paymentCycle}</label>
                  <select value={fCycle} onChange={(e) => setFCycle(e.target.value)} className={inputClass}>
                    {paymentCycles.map((pc) => <option key={pc} value={pc}>{t.paymentCycle[pc as keyof typeof t.paymentCycle]}</option>)}
                  </select>
                </div>
                <div><label className={labelClass}>{t.form.paymentDay}</label><input type="number" min={1} max={31} value={fPayDay} onChange={(e) => setFPayDay(Number(e.target.value))} className={inputClass} /></div>
                <div><label className={labelClass}>{t.form.monthlyRent}</label><input type="number" value={fRent} onChange={(e) => setFRent(Number(e.target.value))} className={inputClass} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>{t.form.deposit}</label><input type="number" value={fDeposit} onChange={(e) => setFDeposit(Number(e.target.value))} className={inputClass} /></div>
                <div><label className={labelClass}>{t.form.rentFreeDays}</label><input type="number" value={fFreeDays} onChange={(e) => setFFreeDays(Number(e.target.value))} className={inputClass} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fDepositReceived} onChange={(e) => setFDepositReceived(e.target.checked)} className="h-4 w-4 rounded border-brand-warm-200" />
                {t.form.depositReceived}
              </label>
              <div><label className={labelClass}>{t.form.signerName}</label><input type="text" value={fSigner} onChange={(e) => setFSigner(e.target.value)} className={inputClass} /></div>
              <div>
                <label className={labelClass}>{t.form.statusLabel}</label>
                <select value={fStatus} onChange={(e) => setFStatus(e.target.value as ContractStatus)} className={inputClass}>
                  <option value="draft">{t.contractStatus.draft}</option>
                  <option value="active">{t.contractStatus.active}</option>
                </select>
              </div>
              {error && <p className="text-sm text-brand-red-600">{error}</p>}
              <button onClick={handleCreate} disabled={saving} className="w-full rounded-lg bg-brand-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-600 disabled:opacity-50">{saving ? "..." : t.form.newContract}</button>
            </div>
          </div>
        </>
      )}

      {/* ── Detail Panel ── */}
      {panel === "detail" && selected && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l border-brand-warm-200 bg-white shadow-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-200 bg-white px-5 py-4">
              <div>
                <h3 className="text-base font-black text-brand-ink-900">{selected.contract_no}</h3>
                <Badge variant={statusVariant[selected.status]}>{t.contractStatus[selected.status as keyof typeof t.contractStatus]}</Badge>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => printLeaseContract({ contract: selected, unit: selectedUnit ?? null, customer: selectedCustomer ?? null }, locale)}
                  className="rounded p-1 text-brand-ink-400 hover:bg-brand-warm-50/80 hover:text-brand-orange-600"
                  title={dictionaries[locale].settings.print.print}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-400 hover:bg-brand-warm-50/80"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="space-y-4 px-5 py-5">
              {/* Contract info */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-brand-ink-400">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no ?? "-"} ({selectedUnit?.floor_label ?? ""})</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name ?? "-"}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.startDate}</dt><dd>{selected.start_date}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.expectedEndDate}</dt><dd>{selected.expected_end_date}</dd></div>
                {selected.actual_end_date && <div><dt className="text-xs text-brand-ink-400">{t.form.actualEndDate}</dt><dd>{selected.actual_end_date}</dd></div>}
                <div><dt className="text-xs text-brand-ink-400">{t.form.paymentCycle}</dt><dd>{t.paymentCycle[selected.payment_cycle as keyof typeof t.paymentCycle]} / {selected.payment_day}号</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.monthlyRent}</dt><dd className="font-semibold">{formatXof(Number(selected.monthly_rent_xof))}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.deposit}</dt><dd>{formatXof(Number(selected.deposit_amount_xof))} {selected.deposit_received ? t.form.depositPaid : t.form.depositUnpaid}</dd></div>
                {selected.rent_free_days > 0 && <div><dt className="text-xs text-brand-ink-400">{t.form.rentFreeDays}</dt><dd>{selected.rent_free_days}天</dd></div>}
                {selected.signer_name && <div><dt className="text-xs text-brand-ink-400">{t.form.signerName}</dt><dd>{selected.signer_name}</dd></div>}
              </dl>

              {/* Actions */}
              {selected.status === "draft" && (
                <button onClick={() => handleActivate(selected.id)} disabled={saving} className="w-full rounded bg-brand-green-500 py-2 text-sm font-semibold text-white hover:bg-brand-green-600 disabled:opacity-50">{saving ? "..." : t.form.activateContract}</button>
              )}
              {selected.status === "active" && (
                <div className="flex gap-2">
                  <button onClick={() => openMoveOut(selected.id)} className="flex-1 rounded bg-brand-amber-500 py-2 text-sm font-semibold text-white hover:bg-brand-amber-600"><LogOut className="mr-1 inline h-4 w-4" />{t.settlement.moveOut}</button>
                </div>
              )}
              {genMsg && <p className="text-xs text-brand-green-600 font-medium">{genMsg}</p>}

              {/* Risk indicators */}
              {selected.status === "active" && (
                <div className="border-t border-brand-warm-200 pt-4">
                  <h4 className="text-sm font-bold text-brand-ink-900 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-brand-orange" />
                    {locale === "zh" ? "风险概览" : "Apercu des risques"}
                  </h4>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className={cn("rounded border px-3 py-2", receivableStats.outstanding > 0 ? "border-brand-orange-200 bg-brand-orange-50" : "border-brand-green-200 bg-brand-green-50")}>
                      <p className="text-brand-ink-500">{t.risk.outstandingTotal}</p>
                      <p className={cn("font-bold tabular-nums", receivableStats.outstanding > 0 ? "text-brand-orange-700" : "text-brand-green-700")}>{formatXof(receivableStats.outstanding)}</p>
                    </div>
                    <div className={cn("rounded border px-3 py-2", receivableStats.overdue > 0 ? "border-brand-red-200 bg-brand-red-50" : "border-brand-green-200 bg-brand-green-50")}>
                      <p className="text-brand-ink-500">{t.risk.overdueTotal}</p>
                      <p className={cn("font-bold tabular-nums", receivableStats.overdue > 0 ? "text-brand-red-700" : "text-brand-green-700")}>{formatXof(receivableStats.overdue)}</p>
                    </div>
                    <div className={cn("rounded border px-3 py-2", !selected.deposit_received ? "border-brand-red-200 bg-brand-red-50" : "border-brand-green-200 bg-brand-green-50")}>
                      <p className="text-brand-ink-500">{t.risk.depositStatus}</p>
                      <p className={cn("text-xs font-semibold", selected.deposit_received ? "text-brand-green-700" : "text-brand-red-600")}>
                        {selected.deposit_received ? t.form.depositPaid : t.form.depositUnpaid}
                      </p>
                    </div>
                    <div className={cn("rounded border px-3 py-2", contractRisk.expiringSoon ? "border-brand-amber-200 bg-brand-amber-50" : "border-brand-green-200 bg-brand-green-50")}>
                      <p className="text-brand-ink-500">{t.risk.expiringSoon}</p>
                      <p className={cn("text-xs font-semibold", contractRisk.expiringSoon ? "text-brand-amber-700" : "text-brand-green-700")}>
                        {contractRisk.expiringSoon ? `${contractRisk.daysLeft} ${locale === "zh" ? "天后到期" : "j restants"}` : (locale === "zh" ? "否" : "Non")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Receivable list for this contract */}
              <div className="border-t border-brand-warm-200 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-brand-ink-900">{t.receivable.title}</h4>
                  {selected.status === "active" && (
                    <button
                      onClick={() => handleGenerateReceivables(selected.id)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 rounded-xl border border-brand-warm-200 px-2 py-1 text-[10px] font-semibold text-brand-ink-600 hover:bg-brand-warm-50/80 disabled:opacity-40"
                    >
                      <RefreshCw className="h-3 w-3" />{t.receivable.generate}
                    </button>
                  )}
                </div>

                {contractReceivables.length === 0 ? (
                  <p className="text-xs text-brand-ink-400">{t.receivable.none}</p>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-brand-warm-200 bg-white shadow-natural text-xs">
                    <table className="data-table">
                      <thead className="bg-brand-warm-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-brand-ink-500">
                        <tr>
                          <th className="px-2 py-1.5 text-left">{t.receivable.dueDate}</th>
                          <th className="px-2 py-1.5 text-right">{t.receivable.amount}</th>
                          <th className="px-2 py-1.5 text-right">{t.receivable.paid}</th>
                          <th className="px-2 py-1.5 text-right">{t.receivable.outstanding}</th>
                          <th className="px-2 py-1.5 text-center">{t.receivable.status}</th>
                          <th className="px-2 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-warm-100">
                        {contractReceivables.map(r => {
                          const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                          const od = overdueDays(r);
                          const isPaying = payReceivableId === r.id;
                          return (
                            <tr key={r.id} className={cn("transition-colors", ROW_BG[r.status])}>
                              <td className="px-2 py-1.5 text-brand-ink-700 whitespace-nowrap">
                                {r.due_date}
                                {od !== null && od > 0 && <span className="ml-1 text-[10px] text-brand-red-500">+{od}</span>}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{formatXof(Number(r.amount_xof))}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-brand-green-600">{formatXof(Number(r.paid_amount_xof))}</td>
                              <td className={cn("px-2 py-1.5 text-right tabular-nums font-semibold", os > 0 ? "text-brand-red-600" : "text-brand-green-600")}>{formatXof(os)}</td>
                              <td className="px-2 py-1.5 text-center">
                                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", STATUS_STYLES[r.status])}>{statusLabel(r.status)}</span>
                              </td>
                              <td className="px-2 py-1.5">
                                {os > 0 && selected.status === "active" && (
                                  isPaying ? (
                                    <span className="text-[10px] text-brand-ink-400">{locale === "zh" ? "收款中..." : "En cours..."}</span>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setPayReceivableId(r.id);
                                        setPayDate(new Date().toISOString().slice(0, 10));
                                        setPayReceiptNo("");
                                        setError("");
                                      }}
                                      className="rounded-lg bg-brand-orange-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-brand-orange-600"
                                    >
                                      <DollarSign className="mr-0.5 inline h-3 w-3" />{t.receivable.collect}
                                    </button>
                                  )
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Receivable payment form */}
              {payReceivableId && (() => {
                const selectedRec = contractReceivables.find(r => r.id === payReceivableId);
                const outstanding = selectedRec ? Number(selectedRec.amount_xof) - Number(selectedRec.paid_amount_xof) : 0;
                return (
                  <div className="rounded border border-brand-orange-200 bg-brand-orange-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-800">
                      {t.receivable.fullPaymentNote}: <span className="text-brand-orange-700">{formatXof(outstanding)}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[10px] text-brand-ink-500">{t.payment.paymentDate}</label><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={cn(inputClass, "text-xs py-1.5")} /></div>
                      <div><label className="text-[10px] text-brand-ink-500">{t.payment.receiptNo}</label><input type="text" value={payReceiptNo} onChange={(e) => setPayReceiptNo(e.target.value)} className={cn(inputClass, "text-xs py-1.5")} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setPayReceivableId(null)} className="flex-1 rounded-xl border border-brand-warm-200 py-1.5 text-xs font-semibold text-brand-ink-600 hover:bg-brand-warm-50/80">{locale === "zh" ? "取消" : "Annuler"}</button>
                      <button onClick={handleCollectReceivable} disabled={saving} className="flex-1 rounded-lg bg-brand-orange-500 py-1.5 text-xs font-semibold text-white hover:bg-brand-orange-600 disabled:opacity-50">{saving ? "..." : t.payment.record}</button>
                    </div>
                  </div>
                );
              })()}

              {/* Payment history */}
              {contractPayments.length > 0 && (
                <div className="border-t border-brand-warm-200 pt-4">
                  <h4 className="text-sm font-bold text-brand-ink-900">{t.payment.title}</h4>
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {contractPayments.map((p) => (
                      <li key={p.id} className="flex justify-between text-brand-ink-600">
                        <span>{p.payment_date}{p.receipt_no ? ` (${p.receipt_no})` : ""}</span>
                        <span className="font-semibold">{formatXof(Number(p.amount))}</span>
                      </li>
                    ))}
                    <li className="flex justify-between border-t border-brand-warm-200 pt-1 text-sm font-bold">
                      <span>{t.payment.totalPaid}</span>
                      <span>{formatXof(totalPaid)}</span>
                    </li>
                  </ul>
                </div>
              )}

              {error && <p className="text-sm text-brand-red-600">{error}</p>}
            </div>
          </div>
        </>
      )}

      {/* ── Move-out Settlement Panel ── */}
      {panel === "moveout" && selected && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l border-brand-warm-200 bg-white shadow-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-200 bg-white px-5 py-4">
              <h3 className="text-base font-black text-brand-ink-900">{t.settlement.title}</h3>
              <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-400 hover:bg-brand-warm-50/80"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <p className="text-sm text-brand-ink-600">{selected.contract_no} — {selectedCustomer?.name}</p>

              <div><label className={labelClass}>{t.form.actualEndDate}</label><input type="date" value={moEndDate} onChange={(e) => setMoEndDate(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{t.settlement.unpaidRent}</label><input type="number" value={moUnpaid} onChange={(e) => setMoUnpaid(Number(e.target.value))} className={inputClass} /></div>
              <p className="text-[10px] -mt-2 text-brand-ink-400">{locale === "zh" ? "已自动填入当前未结清应收总额，可手动调整" : "Pre-rempli avec les impayes, ajustable"}</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={moUtility} onChange={(e) => setMoUtility(e.target.checked)} className="h-4 w-4 rounded border-brand-warm-200" />
                {t.settlement.utilityCleared}
              </label>
              <div><label className={labelClass}>{t.settlement.depositDeduction}</label><input type="number" value={moDeduction} onChange={(e) => setMoDeduction(Number(e.target.value))} className={inputClass} /></div>

              {/* Calculated refund */}
              <div className="rounded bg-brand-warm-50 p-3">
                <div className="flex justify-between text-sm">
                  <span>{t.settlement.depositRefund}</span>
                  <span className="font-semibold">
                    {formatXof(Math.max(0, Number(selected.deposit_amount_xof) - moDeduction))}
                  </span>
                </div>
                {moUnpaid > 0 && (
                  <div className="mt-1 flex justify-between text-sm text-brand-red-600">
                    <span>{t.settlement.totalDue}</span>
                    <span className="font-semibold">{formatXof(moUnpaid)}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-brand-ink-400">
                {locale === "zh" ? "退租后房间恢复为空闲，未来未收应收自动取消" : "Le lot redevient disponible, les echeances futures annulees"}
              </p>
              {error && <p className="text-sm text-brand-red-600">{error}</p>}
              <button onClick={handleMoveOut} disabled={saving} className="w-full rounded bg-brand-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-amber-600 disabled:opacity-50">
                <FileText className="mr-1 inline h-4 w-4" />{t.settlement.generateSettlement}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LeaseCardField({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "green" | "amber" | "sky" | "rose";
}) {
  const toneClass = {
    slate: "bg-brand-warm-100 text-brand-ink-900",
    green: "bg-brand-green-50 text-brand-green-800",
    amber: "bg-brand-amber-50 text-brand-amber-800",
    sky: "bg-brand-blue-50 text-brand-blue-800",
    rose: "bg-brand-red-50 text-brand-red-800",
  }[tone];

  return (
    <div className={cn("rounded-lg px-2 py-1.5", toneClass)}>
      <p className="text-[9px] font-bold text-brand-ink-400">{label}</p>
      <p className="mt-0.5 text-[10px] font-black tabular-nums leading-tight break-all">{value}</p>
    </div>
  );
}

function normalizeFloorLabel(floorLabel: string | null, unitNo: string): string {
  if (floorLabel && floorLabel.trim()) return floorLabel.trim().replace("楼", "F");
  const numeric = Number.parseInt(unitNo, 10);
  if (Number.isFinite(numeric)) return `${Math.floor(numeric / 100)}F`;
  return "F";
}

function floorSortValue(label: string): number {
  const match = label.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 999;
}

function LeaseMetric({ label, value, tone }: { label: string; value: string; tone: "slate" | "green" | "amber" | "sky" | "rose" }) {
  const toneClass = {
    slate: "border-brand-warm-300 bg-white text-brand-ink-900",
    green: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
    amber: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    sky: "border-brand-blue-200 bg-brand-blue-50 text-brand-blue-900",
    rose: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-4 shadow-natural", toneClass)}>
      <p className="text-xs font-bold text-brand-ink-500">{label}</p>
      <p className="mt-2 truncate text-xl font-black tabular-nums">{value}</p>
    </div>
  );
}
