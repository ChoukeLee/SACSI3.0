"use client";

import { useState, useMemo } from "react";
import { Plus, X, DollarSign, FileText, CalendarPlus, TrendingUp, AlertTriangle } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { contractStatusVariant as statusVariant } from "@/lib/status-styles";
import { Badge } from "@/components/ui/badge";
import { RoomCard } from "@/components/room-card";
import type { SaleContractRow, SalePaymentScheduleRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";
import {
  createSaleContract,
  recordSalePayment,
  addFlexibleInstallment,
  updateTransferStatus,
  terminateSaleContract,
} from "./actions";

interface SaleListProps {
  contracts: SaleContractRow[];
  schedules: SalePaymentScheduleRow[];
  units: UnitRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  locale: Locale;
}

type PanelType = "new" | "detail" | null;

export function SaleList({ contracts, schedules, units, customers, payments, receivables, locale }: SaleListProps) {
  const t = dictionaries[locale].sales;
  const [statusFilter, setStatusFilter] = useState("all");
  const [panel, setPanel] = useState<PanelType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // New form
  const [fContractNo, setFContractNo] = useState("");
  const [fUnitId, setFUnitId] = useState("");
  const [fCustomerId, setFCustomerId] = useState("");
  const [fSignedDate, setFSignedDate] = useState(new Date().toISOString().slice(0, 10));
  const [fTotalAmount, setFTotalAmount] = useState(0);
  const [fPlanType, setFPlanType] = useState("lump_sum");
  const [fNumInstallments, setFNumInstallments] = useState(3);
  const [fAgency, setFAgency] = useState("");
  const [fAgent, setFAgent] = useState("");
  const [fCommission, setFCommission] = useState(0);
  const [fCommissionPaid, setFCommissionPaid] = useState(false);

  // Payment form
  const [payScheduleId, setPayScheduleId] = useState("");
  const [payAmount, setPayAmount] = useState(0);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payReceiptNo, setPayReceiptNo] = useState("");

  // Flexible installment form
  const [flexDueDate, setFlexDueDate] = useState("");
  const [flexAmount, setFlexAmount] = useState(0);

  // Transfer form
  const [trStatus, setTrStatus] = useState("not_started");
  const [trDate, setTrDate] = useState("");
  const [trCertNo, setTrCertNo] = useState("");

  // Terminate
  const [termReason, setTermReason] = useState("");

  const filtered = useMemo(() => {
    if (statusFilter === "all") return contracts;
    return contracts.filter((c) => c.status === statusFilter);
  }, [contracts, statusFilter]);

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const groupedContracts = useMemo(() => {
    const grouped = new Map<string, SaleContractRow[]>();
    for (const contract of filtered) {
      const unit = unitMap.get(contract.unit_id);
      const floor = normalizeFloorLabel(unit?.floor_label ?? null, unit?.unit_no ?? "");
      if (!grouped.has(floor)) grouped.set(floor, []);
      grouped.get(floor)!.push(contract);
    }
    return Array.from(grouped.entries()).sort((a, b) => floorSortValue(a[0]) - floorSortValue(b[0]));
  }, [filtered, unitMap]);

  const selected = selectedId ? contracts.find((c) => c.id === selectedId) : null;
  const selectedUnit = selected ? units.find((u) => u.id === selected.unit_id) : null;
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer_id) : null;

  const dashboardStats = useMemo(() => {
    const active = contracts.filter((c) => c.status === "active");
    let received = 0;
    let receivable = 0;
    let overdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const r of receivables) {
      if (r.source_type !== "sale_contract" || r.status === "cancelled") continue;
      received += Number(r.paid_amount_xof);
      receivable += Number(r.amount_xof);
      const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
      if (outstanding > 0 && (r.status === "overdue" || r.due_date < today)) overdue += outstanding;
    }
    return {
      active: active.length,
      total: active.reduce((sum, c) => sum + Number(c.total_amount_xof), 0),
      received,
      receivable,
      overdue,
      transferDone: active.filter((c) => c.transfer_status === "completed").length,
    };
  }, [contracts, receivables]);

  const contractSchedules = useMemo(
    () => (selectedId ? schedules.filter((s) => s.sale_contract_id === selectedId).sort((a, b) => a.installment_no - b.installment_no) : []),
    [schedules, selectedId],
  );

  const contractReceivables = useMemo(
    () => selectedId
      ? receivables.filter(r => r.source_type === "sale_contract" && r.source_id === selectedId && r.status !== "cancelled")
      : [],
    [receivables, selectedId],
  );

  const contractPayments = useMemo(
    () => (selectedId ? payments.filter((p) => p.source_id === selectedId) : []),
    [payments, selectedId],
  );

  // Compute paid from receivables (more accurate than raw payments)
  const { totalPaidRec, totalReceivableRec, totalOverdueRec } = useMemo(() => {
    let paid = 0, total = 0, overdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const r of contractReceivables) {
      total += Number(r.amount_xof);
      paid += Number(r.paid_amount_xof);
      const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
      if (os > 0 && (r.status === "overdue" || r.due_date < today)) {
        overdue += os;
      }
    }
    return { totalPaidRec: paid, totalReceivableRec: total, totalOverdueRec: overdue };
  }, [contractReceivables]);

  const totalPaidPayments = contractPayments.reduce((s, p) => s + Number(p.amount), 0);

  // Compute per-contract receivable stats for list view
  const contractReceivableMap = useMemo(() => {
    const map = new Map<string, { paid: number; total: number; overdue: number }>();
    for (const r of receivables) {
      if (r.source_type !== "sale_contract" || r.status === "cancelled") continue;
      const cid = r.source_id!;
      let s = map.get(cid);
      if (!s) { s = { paid: 0, total: 0, overdue: 0 }; map.set(cid, s); }
      s.total += Number(r.amount_xof);
      s.paid += Number(r.paid_amount_xof);
      const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
      const today = new Date().toISOString().slice(0, 10);
      if (os > 0 && (r.status === "overdue" || r.due_date < today)) {
        s.overdue += os;
      }
    }
    return map;
  }, [receivables]);

  const sellableUnits = useMemo(
    () => units.filter((u) => {
      const hasFlag = u.kind === "apartment" || u.kind === "parking";
      return hasFlag && (u.status === "available" || u.status === "sold");
    }),
    [units],
  );

  const overdueDays = (dueDate: string) => {
    const today = new Date().toISOString().slice(0, 10);
    if (dueDate >= today) return null;
    return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  };

  const resetNewForm = () => {
    setFContractNo(""); setFUnitId(""); setFCustomerId("");
    setFSignedDate(new Date().toISOString().slice(0, 10));
    setFTotalAmount(0); setFPlanType("lump_sum"); setFNumInstallments(3);
    setFAgency(""); setFAgent(""); setFCommission(0); setFCommissionPaid(false);
    setError("");
  };

  const handleCreate = async () => {
    if (!fContractNo.trim()) { setError(t.form.contractNoRequired); return; }
    if (!fUnitId) { setError(t.form.noUnit); return; }
    if (!fCustomerId) { setError(t.form.noCustomer); return; }
    setSaving(true); setError("");
    const result = await createSaleContract({
      unitId: fUnitId, customerId: fCustomerId, contractNo: fContractNo,
      signedDate: fSignedDate, totalAmountXof: fTotalAmount, paymentPlanType: fPlanType,
      numInstallments: fPlanType === "fixed_installment" ? fNumInstallments : undefined,
      agencyCompany: fAgency || undefined, agentName: fAgent || undefined,
      agencyCommissionXof: fCommission || undefined, agencyCommissionPaid: fCommissionPaid,
    });
    setSaving(false);
    if (result.success) { setPanel(null); resetNewForm(); }
    else setError(result.error ?? "Failed");
  };

  const handleRecordPayment = async () => {
    if (!payScheduleId) return;
    // Client-side validation
    const selectedSchedule = contractSchedules.find(s => s.id === payScheduleId);
    if (!selectedSchedule) return;
    if (payAmount <= 0) { setError(t.paymentValidation.positiveRequired); return; }

    // Find matching receivable for validation
    const matchingRec = contractReceivables.find(r =>
      r.due_date === selectedSchedule.due_date &&
      Number(r.amount_xof) === Number(selectedSchedule.amount_xof)
    );
    if (matchingRec) {
      const unpaid = Number(matchingRec.amount_xof) - Number(matchingRec.paid_amount_xof);
      if (unpaid <= 0) { setError(t.paymentValidation.alreadyPaid); return; }
      if (payAmount > unpaid) { setError(t.paymentValidation.amountExceeds); return; }
    }
    // Pre-fill to exact unpaid amount
    const amount = matchingRec
      ? Number(matchingRec.amount_xof) - Number(matchingRec.paid_amount_xof)
      : payAmount;

    setSaving(true); setError("");
    const result = await recordSalePayment({
      contractId: selectedId!, scheduleId: payScheduleId,
      amount, paymentDate: payDate, receiptNo: payReceiptNo || undefined,
    });
    setSaving(false);
    if (result.success) {
      setPayScheduleId("");
      setPayAmount(0);
      setPayReceiptNo("");
    } else {
      setError(result.error ?? "Failed");
    }
  };

  const handleAddFlexInstallment = async () => {
    if (!flexAmount || !flexDueDate) return;
    const nextNo = contractSchedules.length + 1;
    setSaving(true); setError("");
    const result = await addFlexibleInstallment({
      contractId: selectedId!, installmentNo: nextNo, dueDate: flexDueDate, amountXof: flexAmount,
    });
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
    else { setFlexAmount(0); setFlexDueDate(""); }
  };

  const handleTransferUpdate = async () => {
    setSaving(true);
    const result = await updateTransferStatus(selectedId!, trStatus, trDate || undefined, trCertNo || undefined);
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
  };

  const handleTerminate = async () => {
    setSaving(true);
    const result = await terminateSaleContract(selectedId!, termReason || (locale === "zh" ? "买方违约" : "Defaut acheteur"));
    setSaving(false);
    if (result.success) setPanel(null);
    else setError(result.error ?? "Failed");
  };

  const inputClass = "w-full rounded-xl border border-brand-warm-200 bg-white px-3 py-2 text-sm text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/30";
  const labelClass = "block text-xs font-black uppercase tracking-[0.14em] text-brand-ink-500 mb-1";

  const schedStatusVariant: Record<string,  "secondary" | "success" |  "destructive" | "default"> = {
    pending: "secondary", paid: "success", overdue: "destructive", cancelled: "default",
  };

  const schedStatusLabel = (s: string) => {
    const labels: Record<string, string> = locale === "zh"
      ? { pending: "待付", paid: "已付", overdue: "逾期", cancelled: "已取消" }
      : { pending: "Attente", paid: "Paye", overdue: "Retard", cancelled: "Annule" };
    return labels[s] ?? s;
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-5">
        <SaleMetric label={locale === "zh" ? "生效出售" : "Ventes"} value={String(dashboardStats.active)} tone="slate" />
        <SaleMetric label={locale === "zh" ? "合同总额" : "Montant"} value={formatXof(dashboardStats.total)} tone="amber" />
        <SaleMetric label={locale === "zh" ? "已回款" : "Encaisse"} value={formatXof(dashboardStats.received)} tone="green" />
        <SaleMetric label={locale === "zh" ? "逾期回款" : "Retard"} value={formatXof(dashboardStats.overdue)} tone="rose" />
        <SaleMetric label={locale === "zh" ? "已过户" : "Transferts"} value={String(dashboardStats.transferDone)} tone="sky" />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-brand-warm-200 bg-white p-3 shadow-natural sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {["all", "active", "terminated"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-bold transition-colors duration-[100ms]",
                statusFilter === s
                  ? "bg-brand-indigo-500 text-white"
                  : "border border-brand-warm-300 bg-white text-brand-neutral-600 hover:bg-brand-indigo-50"
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
          onClick={() => { resetNewForm(); setPanel("new"); }}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors duration-[100ms] hover:bg-brand-indigo-600 active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />{t.form.newContract}
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
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-indigo-500" />
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
                  const recStats = contractReceivableMap.get(contract.id);
                  const paid = recStats?.paid ?? 0;
                  const total = recStats?.total ?? Number(contract.total_amount_xof);
                  const overdue = recStats?.overdue ?? 0;
                  const rate = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
                  const outstanding = Math.max(0, total - paid);
                  const isRisk = overdue > 0 || (contract.status === "active" && contract.transfer_status !== "completed");

                  return (
                    <RoomCard
                      key={contract.id}
                      variant="detail"
                      roomNo={unit?.unit_no ?? "-"}
                      status="sold"
                      statusLabel={t.contractStatus[contract.status as keyof typeof t.contractStatus]}
                      onClick={() => { setSelectedId(contract.id); setPanel("detail"); setError(""); }}
                      className={isRisk ? "border-brand-amber-200 bg-brand-amber-50/40 ring-1 ring-brand-amber-100" : ""}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-brand-ink-700">{customer?.name ?? "-"}</p>
                          <p className="mt-0.5 truncate text-xs text-brand-ink-400">{contract.contract_no}</p>
                        </div>
                        <Badge variant={statusVariant[contract.status]}>{t.contractStatus[contract.status as keyof typeof t.contractStatus]}</Badge>
                      </div>

                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs font-bold text-brand-ink-400">
                          <span>{locale === "zh" ? "回款进度" : "Paiement"}</span>
                          <span className="text-brand-ink-700">{rate}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-brand-warm-100">
                          <div className={cn("h-full rounded-full", rate >= 100 ? "bg-brand-green-500" : overdue > 0 ? "bg-brand-red-500" : "bg-brand-indigo-500")} style={{ width: String(rate) + "%" }} />
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <SaleCardField label={locale === "zh" ? "总额" : "Total"} value={formatXof(Number(contract.total_amount_xof))} tone="amber" />
                        <SaleCardField label={locale === "zh" ? "已收" : "Paye"} value={formatXof(paid)} tone="green" />
                        <SaleCardField label={locale === "zh" ? "待收" : "Solde"} value={formatXof(outstanding)} tone={outstanding > 0 ? "sky" : "green"} />
                        <SaleCardField label={locale === "zh" ? "逾期" : "Retard"} value={formatXof(overdue)} tone={overdue > 0 ? "rose" : "green"} />
                      </div>

                      <div className="mt-auto pt-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-ink-400">
                          <span>{locale === "zh" ? "过户" : "Transfert"}</span>
                          <span className="truncate text-brand-ink-600">{t.transferStatus[contract.transfer_status as keyof typeof t.transferStatus]}</span>
                        </div>
                      </div>
                    </RoomCard>
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
              <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-400 hover:bg-brand-warm-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.form.contractNo} *</label><input type="text" value={fContractNo} onChange={(e) => setFContractNo(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{t.form.unit} *</label><select value={fUnitId} onChange={(e) => setFUnitId(e.target.value)} className={inputClass}><option value="">{t.form.noUnit}</option>{sellableUnits.map(u => <option key={u.id} value={u.id}>{u.unit_no} — {u.kind}</option>)}</select></div>
              <div><label className={labelClass}>{t.form.customer} *</label><select value={fCustomerId} onChange={(e) => setFCustomerId(e.target.value)} className={inputClass}><option value="">{t.form.noCustomer}</option>{customers.filter(cc => !cc.is_blacklisted).map(cc => <option key={cc.id} value={cc.id}>{cc.name}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>{t.form.signedDate}</label><input type="date" value={fSignedDate} onChange={(e) => setFSignedDate(e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>{t.form.totalAmount}</label><input type="number" value={fTotalAmount} onChange={(e) => setFTotalAmount(Number(e.target.value))} className={inputClass} /></div>
              </div>
              <div>
                <label className={labelClass}>{t.form.paymentPlan}</label>
                <select value={fPlanType} onChange={(e) => setFPlanType(e.target.value)} className={inputClass}>
                  <option value="lump_sum">{t.paymentPlan.lump_sum}</option>
                  <option value="fixed_installment">{t.paymentPlan.fixed_installment}</option>
                  <option value="flexible_installment">{t.paymentPlan.flexible_installment}</option>
                </select>
              </div>
              {fPlanType === "fixed_installment" && (
                <div><label className={labelClass}>{t.form.numInstallments}</label><input type="number" min={2} value={fNumInstallments} onChange={(e) => setFNumInstallments(Number(e.target.value))} className={inputClass} /></div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>{t.form.agencyCompany}</label><input type="text" value={fAgency} onChange={(e) => setFAgency(e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>{t.form.agentName}</label><input type="text" value={fAgent} onChange={(e) => setFAgent(e.target.value)} className={inputClass} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>{t.form.agencyCommission}</label><input type="number" value={fCommission} onChange={(e) => setFCommission(Number(e.target.value))} className={inputClass} /></div>
                <label className="flex items-center gap-2 text-sm pt-5"><input type="checkbox" checked={fCommissionPaid} onChange={(e) => setFCommissionPaid(e.target.checked)} className="h-4 w-4 rounded border-brand-warm-200" />{t.form.agencyCommissionPaid}</label>
              </div>
              {error && <p className="text-sm text-brand-red-600">{error}</p>}
              <button onClick={handleCreate} disabled={saving} className="w-full rounded-lg bg-brand-indigo-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-indigo-600 disabled:opacity-50">{saving ? "..." : t.form.newContract}</button>
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
              <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-400 hover:bg-brand-warm-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              {/* Contract info */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-brand-ink-400">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no} — {selectedUnit?.kind}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.signedDate}</dt><dd>{selected.signed_date}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.totalAmount}</dt><dd className="font-semibold">{formatXof(Number(selected.total_amount_xof))}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.paymentPlan}</dt><dd>{t.paymentPlan[selected.payment_plan_type as keyof typeof t.paymentPlan]}</dd></div>
                <div><dt className="text-xs text-brand-ink-400">{t.form.transferStatus}</dt><dd>{t.transferStatus[selected.transfer_status as keyof typeof t.transferStatus]}</dd></div>
                {selected.title_certificate_no && <div><dt className="text-xs text-brand-ink-400">{t.form.titleCertificateNo}</dt><dd>{selected.title_certificate_no}</dd></div>}
                {selected.agency_company && <div><dt className="text-xs text-brand-ink-400">{t.form.agencyCompany}</dt><dd>{selected.agency_company}</dd></div>}
                {selected.agent_name && <div><dt className="text-xs text-brand-ink-400">{t.form.agentName}</dt><dd>{selected.agent_name}</dd></div>}
              </dl>

              {/* Payment overview */}
              <div className="border-t border-brand-warm-200 pt-4">
                <h4 className="text-sm font-bold text-brand-ink-900 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-brand-indigo" />{t.overview.title}
                </h4>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-brand-warm-200 bg-white px-3 py-2">
                    <p className="text-brand-ink-500">{t.overview.totalPrice}</p>
                    <p className="font-bold tabular-nums text-brand-ink-900">{formatXof(Number(selected.total_amount_xof))}</p>
                  </div>
                  <div className="rounded border border-brand-green-200 bg-brand-green-50 px-3 py-2">
                    <p className="text-brand-ink-500">{t.overview.paidAmount}</p>
                    <p className="font-bold tabular-nums text-brand-green-700">{formatXof(totalPaidRec || totalPaidPayments)}</p>
                  </div>
                  <div className={cn("rounded border px-3 py-2", (totalReceivableRec - totalPaidRec) > 0 ? "border-brand-indigo-200 bg-brand-indigo-50" : "border-brand-green-200 bg-brand-green-50")}>
                    <p className="text-brand-ink-500">{t.overview.unpaidAmount}</p>
                    <p className={cn("font-bold tabular-nums", (totalReceivableRec - totalPaidRec) > 0 ? "text-brand-indigo-700" : "text-brand-green-700")}>
                      {formatXof(Math.max(0, totalReceivableRec - totalPaidRec))}
                    </p>
                  </div>
                  <div className={cn("rounded border px-3 py-2", totalOverdueRec > 0 ? "border-brand-red-200 bg-brand-red-50" : "border-brand-green-200 bg-brand-green-50")}>
                    <p className="text-brand-ink-500">{t.overview.overdueAmount}</p>
                    <p className={cn("font-bold tabular-nums", totalOverdueRec > 0 ? "text-brand-red-700" : "text-brand-green-700")}>
                      {totalOverdueRec > 0 ? formatXof(totalOverdueRec) : "—"}
                    </p>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-brand-ink-500 mb-1">
                    <span>{t.overview.collectionRate}</span>
                    <span className="tabular-nums font-medium">
                      {totalReceivableRec > 0 ? Math.round((totalPaidRec / totalReceivableRec) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-brand-neutral-200">
                    <div
                      className={cn("h-full rounded-full transition-all", totalPaidRec >= totalReceivableRec ? "bg-brand-green-500" : "bg-brand-indigo")}
                      style={{ width: `${totalReceivableRec > 0 ? Math.min(100, Math.round((totalPaidRec / totalReceivableRec) * 100)) : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Installment schedule */}
              <div className="border-t border-brand-warm-200 pt-4">
                <h4 className="text-sm font-bold text-brand-ink-900">{t.installment.title}</h4>
                {contractSchedules.length === 0 ? (
                  <p className="mt-1 text-xs text-brand-ink-400">{locale === "zh" ? "暂无分期计划" : "Aucun echeancier"}</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {contractSchedules.map((s) => {
                      const matchingRec = contractReceivables.find(r =>
                        r.due_date === s.due_date && Number(r.amount_xof) === Number(s.amount_xof)
                      );
                      const recPaid = matchingRec ? Number(matchingRec.paid_amount_xof) : (s.status === "paid" ? Number(s.amount_xof) : 0);
                      const recUnpaid = Number(s.amount_xof) - recPaid;
                      const od = overdueDays(s.due_date);
                      const isOverdue = s.status === "overdue" || (od !== null && od > 0 && s.status !== "paid");
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            "flex items-center justify-between rounded border px-3 py-2 text-xs gap-1",
                            isOverdue ? "border-brand-red-200 bg-brand-red-50/50" :
                            s.status === "paid" ? "border-brand-green-200 bg-brand-green-50/50" :
                            "border-brand-warm-200 bg-brand-warm-50",
                          )}
                        >
                          <span className="font-medium text-brand-ink-700 min-w-[24px]">#{s.installment_no}</span>
                          <span className={cn("text-brand-ink-500 min-w-[72px]", isOverdue && "text-brand-red-600")}>
                            {s.due_date}
                            {od !== null && od > 0 && <span className="ml-1 text-xs text-brand-red-500">+{od}</span>}
                          </span>
                          <span className="font-semibold tabular-nums min-w-[80px] text-right">{formatXof(Number(s.amount_xof))}</span>
                          {matchingRec && (
                            <>
                              <span className="tabular-nums text-brand-green-600 min-w-[80px] text-right">{formatXof(recPaid)}</span>
                              <span className={cn("tabular-nums font-semibold min-w-[80px] text-right", recUnpaid > 0 ? "text-brand-red-600" : "text-brand-green-600")}>
                                {formatXof(recUnpaid)}
                              </span>
                            </>
                          )}
                          <Badge variant={schedStatusVariant[s.status]}>
                            {schedStatusLabel(s.status)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Record payment */}
                {selected.status === "active" && contractSchedules.some(s => s.status === "pending" || s.status === "overdue") && (
                  <div className="mt-3 space-y-2 rounded-xl border border-brand-warm-200 bg-brand-warm-50 p-3">
                    <div>
                      <label className="text-xs text-brand-ink-500">{t.payment.selectInstallment}</label>
                      <select
                        value={payScheduleId}
                        onChange={(e) => {
                          setPayScheduleId(e.target.value);
                          if (!e.target.value) { setPayAmount(0); return; }
                          const s = contractSchedules.find(i => i.id === e.target.value);
                          if (s) {
                            const matchingRec = contractReceivables.find(r =>
                              r.due_date === s.due_date && Number(r.amount_xof) === Number(s.amount_xof)
                            );
                            const unpaid = matchingRec
                              ? Number(matchingRec.amount_xof) - Number(matchingRec.paid_amount_xof)
                              : Number(s.amount_xof);
                            setPayAmount(unpaid);
                          }
                        }}
                        className={inputClass}
                      >
                        <option value="">-</option>
                        {contractSchedules.filter(s => s.status !== "paid" && s.status !== "cancelled").map(s => {
                          const matchingRec = contractReceivables.find(r =>
                            r.due_date === s.due_date && Number(r.amount_xof) === Number(s.amount_xof)
                          );
                          const unpaid = matchingRec
                            ? Number(matchingRec.amount_xof) - Number(matchingRec.paid_amount_xof)
                            : Number(s.amount_xof);
                          return (
                            <option key={s.id} value={s.id}>
                              #{s.installment_no} — {formatXof(Number(s.amount_xof))} ({locale === "zh" ? "未收" : "du"}: {formatXof(unpaid)}) {s.due_date}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    {payScheduleId && (
                      <>
                        <div className="rounded bg-white px-2 py-1 text-xs text-brand-ink-600">
                          {locale === "zh" ? "金额自动填入未收金额（全额收款）" : "Montant auto-rempli (paiement total)"}: <span className="font-bold text-brand-ink-900">{formatXof(payAmount)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><label className="text-xs text-brand-ink-500">{t.payment.paymentDate}</label><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputClass} /></div>
                          <div><label className="text-xs text-brand-ink-500">{t.payment.receiptNo}</label><input type="text" value={payReceiptNo} onChange={(e) => setPayReceiptNo(e.target.value)} className={inputClass} /></div>
                        </div>
                        <button onClick={handleRecordPayment} disabled={saving} className="w-full rounded-lg bg-brand-indigo-500 py-1.5 text-xs font-semibold text-white hover:bg-brand-indigo-600 disabled:opacity-50"><DollarSign className="mr-1 inline h-3 w-3" />{t.payment.record}</button>
                      </>
                    )}
                  </div>
                )}

                {/* Add flexible installment */}
                {selected.status === "active" && selected.payment_plan_type === "flexible_installment" && (
                  <div className="mt-3 space-y-2 rounded border border-dashed border-brand-warm-200 bg-white p-3">
                    <h5 className="text-xs font-semibold text-brand-ink-500"><CalendarPlus className="mr-1 inline h-3 w-3" />{t.installment.addInstallment}</h5>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-brand-ink-500">{t.installment.dueDate}</label><input type="date" value={flexDueDate} onChange={(e) => setFlexDueDate(e.target.value)} className={inputClass} /></div>
                      <div><label className="text-xs text-brand-ink-500">{t.installment.amount}</label><input type="number" value={flexAmount} onChange={(e) => setFlexAmount(Number(e.target.value))} className={inputClass} /></div>
                    </div>
                    <button onClick={handleAddFlexInstallment} disabled={saving} className="w-full rounded-lg border border-brand-warm-200 py-1.5 text-xs font-semibold text-brand-ink-700 hover:bg-brand-warm-100 disabled:opacity-50 transition-colors duration-[100ms]">{t.form.addSchedule}</button>
                  </div>
                )}
              </div>

              {/* Transfer status update */}
              {selected.status === "active" && (
                <div className="border-t border-brand-warm-200 pt-4">
                  <h4 className="text-sm font-bold text-brand-ink-900">{locale === "zh" ? "过户跟进" : "Suivi transfert"}</h4>
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="text-xs text-brand-ink-500">{t.form.transferStatus}</label>
                      <select value={trStatus} onChange={(e) => setTrStatus(e.target.value)} className={inputClass}>
                        <option value="not_started">{t.transferStatus.not_started}</option>
                        <option value="in_progress">{t.transferStatus.in_progress}</option>
                        <option value="completed">{t.transferStatus.completed}</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-brand-ink-500">{t.form.transferDate}</label><input type="date" value={trDate} onChange={(e) => setTrDate(e.target.value)} className={inputClass} /></div>
                      <div><label className="text-xs text-brand-ink-500">{t.form.titleCertificateNo}</label><input type="text" value={trCertNo} onChange={(e) => setTrCertNo(e.target.value)} className={inputClass} /></div>
                    </div>
                    <button onClick={handleTransferUpdate} disabled={saving} className="w-full rounded-lg border border-brand-warm-200 py-1.5 text-xs font-semibold text-brand-ink-700 hover:bg-brand-warm-100 disabled:opacity-50 transition-colors duration-[100ms]">{saving ? "..." : t.form.updateTransfer}</button>
                  </div>
                </div>
              )}

              {/* Payment history */}
              {contractPayments.length > 0 && (
                <div className="border-t border-brand-warm-200 pt-4">
                  <h4 className="text-sm font-bold text-brand-ink-900">{t.payment.title} ({contractPayments.length})</h4>
                  <ul className="mt-2 space-y-1 text-xs text-brand-ink-600">
                    {contractPayments.map(p => (
                      <li key={p.id} className="flex justify-between">{p.payment_date}{p.receipt_no ? ` (${p.receipt_no})` : ""} <span className="font-semibold">{formatXof(Number(p.amount))}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Terminate */}
              {selected.status === "active" && (
                <div className="border-t border-brand-warm-200 pt-4">
                  <h4 className="text-sm font-bold text-brand-red-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{t.terminate.title}</h4>
                  <p className="text-xs text-brand-ink-500 mt-1">{t.terminate.description}</p>
                  <div className="mt-2 space-y-2">
                    <div><label className="text-xs text-brand-ink-500">{t.terminate.reason}</label><input type="text" value={termReason} onChange={(e) => setTermReason(e.target.value)} className={inputClass} /></div>
                    <button onClick={handleTerminate} disabled={saving} className="w-full rounded border border-brand-red-200 bg-brand-red-50 py-1.5 text-xs font-semibold text-brand-red-700 hover:bg-brand-red-100 disabled:opacity-50">{t.terminate.confirm}</button>
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-brand-red-600">{error}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SaleCardField({
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
    sky: "bg-brand-cyan-50 text-brand-cyan-800",
    rose: "bg-brand-red-50 text-brand-red-800",
  }[tone];

  return (
    <div className={cn("rounded-lg px-2 py-1.5", toneClass)}>
      <p className="text-xs font-bold text-brand-ink-400">{label}</p>
      <p className="mt-0.5 break-all text-xs font-black leading-tight tabular-nums">{value}</p>
    </div>
  );
}

function SaleMetric({ label, value, tone }: { label: string; value: string; tone: "slate" | "green" | "amber" | "sky" | "rose" }) {
  const toneClass = {
    slate: "border-brand-warm-300 bg-white text-brand-ink-900",
    green: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
    amber: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    sky: "border-brand-cyan-200 bg-brand-cyan-50 text-brand-cyan-900",
    rose: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-4 shadow-natural", toneClass)}>
      <p className="text-xs font-bold text-brand-ink-500">{label}</p>
      <p className="mt-2 truncate text-xl font-black tabular-nums">{value}</p>
    </div>
  );
}
