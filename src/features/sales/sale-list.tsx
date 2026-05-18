"use client";

import { useState, useMemo } from "react";
import { Plus, X, DollarSign, FileText, CalendarPlus, TrendingUp } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type { SaleContractRow, SalePaymentScheduleRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
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
  locale: Locale;
}

type PanelType = "new" | "detail" | null;

export function SaleList({ contracts, schedules, units, customers, payments, locale }: SaleListProps) {
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

  const selected = selectedId ? contracts.find((c) => c.id === selectedId) : null;
  const selectedUnit = selected ? units.find((u) => u.id === selected.unit_id) : null;
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer_id) : null;
  const contractSchedules = useMemo(
    () => (selectedId ? schedules.filter((s) => s.sale_contract_id === selectedId).sort((a, b) => a.installment_no - b.installment_no) : []),
    [schedules, selectedId]
  );
  const contractPayments = useMemo(
    () => (selectedId ? payments.filter((p) => p.source_id === selectedId) : []),
    [payments, selectedId]
  );
  const totalPaid = contractPayments.reduce((s, p) => s + Number(p.amount), 0);

  const sellableUnits = useMemo(
    () => units.filter((u) => {
      const hasFlag = u.kind === "apartment" || u.kind === "parking";
      return hasFlag && (u.status === "available" || u.status === "sold");
    }),
    [units]
  );

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
    if (!payScheduleId || payAmount <= 0) return;
    setSaving(true); setError("");
    const result = await recordSalePayment({
      contractId: selectedId!, scheduleId: payScheduleId,
      amount: payAmount, paymentDate: payDate, receiptNo: payReceiptNo || undefined,
    });
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
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
    const result = await terminateSaleContract(selectedId!, termReason || "买方违约");
    setSaving(false);
    if (result.success) setPanel(null);
    else setError(result.error ?? "Failed");
  };

  const inputClass = "w-full rounded border border-black/15 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-orange/30";
  const labelClass = "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";

  const statusColor: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600", active: "bg-emerald-100 text-emerald-700",
    terminated: "bg-red-100 text-red-700", expired: "bg-amber-100 text-amber-700",
  };

  const schedStatusColor: Record<string, string> = {
    pending: "bg-slate-100 text-slate-600",
    paid: "bg-emerald-100 text-emerald-700",
    overdue: "bg-red-100 text-red-700",
    cancelled: "bg-slate-50 text-slate-400",
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {["all", "active", "terminated"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn("rounded px-3 py-1 text-xs font-medium transition", statusFilter === s ? "bg-brand-orange text-white" : "border border-black/15 bg-white text-slate-600 hover:bg-slate-50")}>
              {s === "all" ? (locale === "fr" ? "Tous" : "全部") : t.contractStatus[s as keyof typeof t.contractStatus]}
            </button>
          ))}
        </div>
        <button onClick={() => { resetNewForm(); setPanel("new"); }} className="inline-flex items-center gap-1.5 rounded bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600">
          <Plus className="h-3.5 w-3.5" />{t.form.newContract}
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-black/10 bg-white py-16 shadow-soft">
          <p className="text-sm text-slate-400">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-black/10 bg-white shadow-soft">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t.form.contractNo}</th>
                <th className="px-4 py-3">{t.form.unit}</th>
                <th className="px-4 py-3">{t.form.customer}</th>
                <th className="px-4 py-3">{t.form.signedDate}</th>
                <th className="px-4 py-3">{t.form.totalAmount}</th>
                <th className="px-4 py-3">{t.form.paymentPlan}</th>
                <th className="px-4 py-3">{t.installment.progress}</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {filtered.map((c) => {
                const unit = units.find((u) => u.id === c.unit_id);
                const cust = customers.find((cu) => cu.id === c.customer_id);
                const cSchedules = schedules.filter((s) => s.sale_contract_id === c.id);
                const paidSchedules = cSchedules.filter((s) => s.status === "paid");
                const progress = cSchedules.length > 0
                  ? Math.round((paidSchedules.length / cSchedules.length) * 100)
                  : 0;
                return (
                  <tr key={c.id} className="cursor-pointer transition hover:bg-orange-50/50" onClick={() => { setSelectedId(c.id); setPanel("detail"); setError(""); }}>
                    <td className="px-4 py-3 font-semibold text-brand-ink">{c.contract_no}</td>
                    <td className="px-4 py-3 text-slate-600">{unit?.unit_no ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{cust?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.signed_date}</td>
                    <td className="px-4 py-3 text-slate-600">{formatXof(Number(c.total_amount_xof))}</td>
                    <td className="px-4 py-3 text-xs">{t.paymentPlan[c.payment_plan_type as keyof typeof t.paymentPlan]}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold", statusColor[c.status])}>{t.contractStatus[c.status as keyof typeof t.contractStatus]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── New Contract Panel ── */}
      {panel === "new" && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto border-l border-black/10 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-5 py-4">
              <h3 className="text-lg font-bold text-brand-ink">{t.form.newContract}</h3>
              <button onClick={() => setPanel(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.form.contractNo} *</label><input type="text" value={fContractNo} onChange={(e) => setFContractNo(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{t.form.unit} *</label><select value={fUnitId} onChange={(e) => setFUnitId(e.target.value)} className={inputClass}><option value="">{t.form.noUnit}</option>{sellableUnits.map(u => <option key={u.id} value={u.id}>{u.unit_no} — {u.kind}</option>)}</select></div>
              <div><label className={labelClass}>{t.form.customer} *</label><select value={fCustomerId} onChange={(e) => setFCustomerId(e.target.value)} className={inputClass}><option value="">{t.form.noCustomer}</option>{customers.filter(c => !c.is_blacklisted).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
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
                <label className="flex items-center gap-2 text-sm pt-5"><input type="checkbox" checked={fCommissionPaid} onChange={(e) => setFCommissionPaid(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />{t.form.agencyCommissionPaid}</label>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button onClick={handleCreate} disabled={saving} className="w-full rounded bg-brand-orange py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{saving ? "..." : t.form.newContract}</button>
            </div>
          </div>
        </>
      )}

      {/* ── Detail Panel ── */}
      {panel === "detail" && selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto border-l border-black/10 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-brand-ink">{selected.contract_no}</h3>
                <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold", statusColor[selected.status])}>{t.contractStatus[selected.status as keyof typeof t.contractStatus]}</span>
              </div>
              <button onClick={() => setPanel(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-400">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no} — {selectedUnit?.kind}</dd></div>
                <div><dt className="text-xs text-slate-400">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name}</dd></div>
                <div><dt className="text-xs text-slate-400">{t.form.signedDate}</dt><dd>{selected.signed_date}</dd></div>
                <div><dt className="text-xs text-slate-400">{t.form.totalAmount}</dt><dd className="font-semibold">{formatXof(Number(selected.total_amount_xof))}</dd></div>
                <div><dt className="text-xs text-slate-400">{t.form.paymentPlan}</dt><dd>{t.paymentPlan[selected.payment_plan_type as keyof typeof t.paymentPlan]}</dd></div>
                <div><dt className="text-xs text-slate-400">{t.form.transferStatus}</dt><dd>{t.transferStatus[selected.transfer_status as keyof typeof t.transferStatus]}</dd></div>
                {selected.title_certificate_no && <div><dt className="text-xs text-slate-400">{t.form.titleCertificateNo}</dt><dd>{selected.title_certificate_no}</dd></div>}
                {selected.agency_company && <div><dt className="text-xs text-slate-400">{t.form.agencyCompany}</dt><dd>{selected.agency_company}</dd></div>}
                {selected.agent_name && <div><dt className="text-xs text-slate-400">{t.form.agentName}</dt><dd>{selected.agent_name}</dd></div>}
              </dl>

              {/* Payment progress bar */}
              <div>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{t.payment.totalPaid}: {formatXof(totalPaid)}</span>
                  <span>{t.payment.remaining}: {formatXof(Math.max(0, Number(selected.total_amount_xof) - totalPaid))}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-brand-orange transition" style={{ width: `${Math.min(100, Math.round((totalPaid / Number(selected.total_amount_xof)) * 100))}%` }} />
                </div>
              </div>

              {/* Installment schedule */}
              <div className="border-t border-black/10 pt-4">
                <h4 className="text-sm font-bold text-brand-ink">{t.installment.title}</h4>
                {contractSchedules.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-400">暂无分期计划</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {contractSchedules.map((s) => (
                      <li key={s.id} className="flex items-center justify-between rounded border border-black/10 bg-slate-50 px-3 py-2 text-xs">
                        <span className="font-medium text-slate-700">#{s.installment_no}</span>
                        <span className="text-slate-500">{s.due_date}</span>
                        <span className="font-semibold">{formatXof(Number(s.amount_xof))}</span>
                        <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold", schedStatusColor[s.status])}>
                          {t.installment[s.status as keyof typeof t.installment] ?? s.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Record payment */}
                {selected.status === "active" && contractSchedules.some(s => s.status === "pending") && (
                  <div className="mt-3 space-y-2 rounded border border-black/10 bg-slate-50 p-3">
                    <div>
                      <label className="text-xs text-slate-500">{t.payment.selectInstallment}</label>
                      <select value={payScheduleId} onChange={(e) => { setPayScheduleId(e.target.value); const s = contractSchedules.find(i => i.id === e.target.value); if (s) setPayAmount(Number(s.amount_xof)); }} className={inputClass}>
                        <option value="">-</option>
                        {contractSchedules.filter(s => s.status === "pending").map(s => <option key={s.id} value={s.id}>#{s.installment_no} — {formatXof(Number(s.amount_xof))} ({s.due_date})</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-slate-500">{t.payment.amount}</label><input type="number" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} className={inputClass} /></div>
                      <div><label className="text-xs text-slate-500">{t.payment.paymentDate}</label><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputClass} /></div>
                    </div>
                    <div><label className="text-xs text-slate-500">{t.payment.receiptNo}</label><input type="text" value={payReceiptNo} onChange={(e) => setPayReceiptNo(e.target.value)} className={inputClass} /></div>
                    <button onClick={handleRecordPayment} disabled={saving} className="w-full rounded bg-brand-orange py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"><DollarSign className="mr-1 inline h-3 w-3" />{t.payment.record}</button>
                  </div>
                )}

                {/* Add flexible installment */}
                {selected.status === "active" && selected.payment_plan_type === "flexible_installment" && (
                  <div className="mt-3 space-y-2 rounded border border-dashed border-black/15 bg-white p-3">
                    <h5 className="text-xs font-semibold text-slate-500"><CalendarPlus className="mr-1 inline h-3 w-3" />{t.installment.addInstallment}</h5>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-slate-500">{t.installment.dueDate}</label><input type="date" value={flexDueDate} onChange={(e) => setFlexDueDate(e.target.value)} className={inputClass} /></div>
                      <div><label className="text-xs text-slate-500">{t.installment.amount}</label><input type="number" value={flexAmount} onChange={(e) => setFlexAmount(Number(e.target.value))} className={inputClass} /></div>
                    </div>
                    <button onClick={handleAddFlexInstallment} disabled={saving} className="w-full rounded border border-black/15 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">添加</button>
                  </div>
                )}
              </div>

              {/* Transfer status update */}
              {selected.status === "active" && (
                <div className="border-t border-black/10 pt-4">
                  <h4 className="text-sm font-bold text-brand-ink">过户跟进</h4>
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="text-xs text-slate-500">{t.form.transferStatus}</label>
                      <select value={trStatus} onChange={(e) => setTrStatus(e.target.value)} className={inputClass}>
                        <option value="not_started">{t.transferStatus.not_started}</option>
                        <option value="in_progress">{t.transferStatus.in_progress}</option>
                        <option value="completed">{t.transferStatus.completed}</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-slate-500">{t.form.transferDate}</label><input type="date" value={trDate} onChange={(e) => setTrDate(e.target.value)} className={inputClass} /></div>
                      <div><label className="text-xs text-slate-500">{t.form.titleCertificateNo}</label><input type="text" value={trCertNo} onChange={(e) => setTrCertNo(e.target.value)} className={inputClass} /></div>
                    </div>
                    <button onClick={handleTransferUpdate} disabled={saving} className="w-full rounded border border-black/15 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{saving ? "..." : "更新过户状态"}</button>
                  </div>
                </div>
              )}

              {/* Payment history */}
              {contractPayments.length > 0 && (
                <div className="border-t border-black/10 pt-4">
                  <h4 className="text-sm font-bold text-brand-ink">{t.payment.title} ({contractPayments.length})</h4>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {contractPayments.map(p => (
                      <li key={p.id} className="flex justify-between">{p.payment_date}{p.receipt_no ? ` (${p.receipt_no})` : ""} <span className="font-semibold">{formatXof(Number(p.amount))}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Terminate */}
              {selected.status === "active" && (
                <div className="border-t border-black/10 pt-4">
                  <h4 className="text-sm font-bold text-red-600">{t.terminate.title}</h4>
                  <p className="text-xs text-slate-500 mt-1">{t.terminate.description}</p>
                  <div className="mt-2 space-y-2">
                    <div><label className="text-xs text-slate-500">{t.terminate.reason}</label><input type="text" value={termReason} onChange={(e) => setTermReason(e.target.value)} className={inputClass} /></div>
                    <button onClick={handleTerminate} disabled={saving} className="w-full rounded border border-red-300 bg-red-50 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">{t.terminate.confirm}</button>
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
