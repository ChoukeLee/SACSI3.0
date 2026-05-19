"use client";

import { useState, useMemo } from "react";
import { Plus, X, AlertTriangle, FileText, DollarSign, LogOut, Printer } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import { printLeaseContract } from "@/features/print";
import {
  createLeaseContract,
  activateContract,
  terminateContract,
  recordRentPayment,
  processMoveOut,
} from "./actions";

interface LeaseListProps {
  contracts: LeaseContractRow[];
  units: UnitRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  locale: Locale;
}

type PanelType = "new" | "detail" | "moveout" | null;

const paymentCycles = ["monthly", "quarterly", "semiannual", "annual"];

export function LeaseList({ contracts, units, customers, payments, locale }: LeaseListProps) {
  const t = dictionaries[locale].leases;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [panel, setPanel] = useState<PanelType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  // Payment form
  const [payAmount, setPayAmount] = useState(0);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payReceiptNo, setPayReceiptNo] = useState("");
  const [payMonths, setPayMonths] = useState(1);

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

  const selected = selectedId ? contracts.find((c) => c.id === selectedId) : null;
  const selectedUnit = selected ? units.find((u) => u.id === selected.unit_id) : null;
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer_id) : null;
  const contractPayments = useMemo(
    () => (selectedId ? payments.filter((p) => p.source_id === selectedId) : []),
    [payments, selectedId]
  );
  const totalPaid = contractPayments.reduce((s, p) => s + Number(p.amount), 0);

  const availableUnits = useMemo(
    () => units.filter((u) => u.kind === "apartment" && u.status === "available"),
    [units]
  );

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
    const c = contracts.find((c) => c.id === id);
    if (c) {
      setPayAmount(Number(c.monthly_rent_xof));
      setMoUnpaid(0);
      setMoDeduction(0);
      setMoRefund(Number(c.deposit_amount_xof));
    }
  };

  const openMoveOut = (id: string) => {
    setSelectedId(id);
    setPanel("moveout");
    const c = contracts.find((c) => c.id === id);
    if (c) {
      setMoEndDate(new Date().toISOString().slice(0, 10));
      setMoUnpaid(0);
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
  };

  const handleTerminate = async (id: string) => {
    setSaving(true);
    const result = await terminateContract(id);
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
  };

  const handleRecordPayment = async () => {
    if (!selectedId || payAmount <= 0) return;
    setSaving(true);
    setError("");
    const result = await recordRentPayment({
      contractId: selectedId,
      amount: payAmount,
      paymentDate: payDate,
      receiptNo: payReceiptNo || undefined,
      coveringMonths: payMonths,
    });
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
    else setPayAmount(0);
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
    "w-full rounded border border-brand-warm-400 bg-white px-3 py-2 text-sm text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30";
  const labelClass = "block text-xs font-semibold uppercase tracking-wide text-brand-ink-400 mb-1";

  const statusColor: Record<string, string> = {
    draft: "bg-brand-warm-200 text-brand-ink-500",
    active: "bg-brand-green-100 text-brand-green-700",
    terminated: "bg-brand-red-100 text-brand-red-700",
    expired: "bg-brand-amber-100 text-brand-amber-700",
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {["all", "draft", "active", "terminated", "expired"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition",
                statusFilter === s
                  ? "bg-brand-ink-900 text-white"
                  : "border border-brand-warm-400 bg-white text-brand-ink-500 hover:bg-brand-warm-50"
              )}
            >
              {s === "all" ? (locale === "fr" ? "Tous" : "全部") : t.contractStatus[s as keyof typeof t.contractStatus]}
            </button>
          ))}
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-ink-700"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.form.newContract}
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-brand-warm-400 bg-white py-16 shadow-card">
          <p className="text-sm text-brand-ink-300">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-brand-warm-400 bg-white shadow-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-warm-50 text-xs uppercase tracking-wide text-brand-ink-400">
              <tr>
                <th className="px-4 py-3">{t.form.contractNo}</th>
                <th className="px-4 py-3">{t.form.unit}</th>
                <th className="px-4 py-3">{t.form.customer}</th>
                <th className="px-4 py-3">{t.form.startDate}</th>
                <th className="px-4 py-3">{t.form.expectedEndDate}</th>
                <th className="px-4 py-3">{t.form.monthlyRent}</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-warm-400">
              {filtered.map((c) => {
                const unit = units.find((u) => u.id === c.unit_id);
                const cust = customers.find((cu) => cu.id === c.customer_id);
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition hover:bg-brand-orange-50/50"
                    onClick={() => openDetail(c.id)}
                  >
                    <td className="px-4 py-3 font-semibold text-brand-ink-900">{c.contract_no}</td>
                    <td className="px-4 py-3 text-brand-ink-500">{unit?.unit_no ?? "-"}</td>
                    <td className="px-4 py-3 text-brand-ink-500">{cust?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-brand-ink-500">{c.start_date}</td>
                    <td className="px-4 py-3 text-brand-ink-500">{c.expected_end_date}</td>
                    <td className="px-4 py-3 text-brand-ink-500">{formatXof(Number(c.monthly_rent_xof))}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold", statusColor[c.status])}>
                        {t.contractStatus[c.status as keyof typeof t.contractStatus]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-brand-ink-300">
        {filtered.length} / {contracts.length} {locale === "fr" ? "contrats" : "份合同"}
      </p>

      {/* ── New Contract Panel ── */}
      {panel === "new" && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto border-l border-brand-warm-400 bg-white shadow-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-400 bg-white px-5 py-4">
              <h3 className="text-lg font-bold text-brand-ink-900">{t.form.newContract}</h3>
              <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-300 hover:bg-brand-warm-100"><X className="h-5 w-5" /></button>
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
                  {customers.filter((c) => !c.is_blacklisted).map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
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
                <input type="checkbox" checked={fDepositReceived} onChange={(e) => setFDepositReceived(e.target.checked)} className="h-4 w-4 rounded border-brand-warm-400" />
                {t.form.depositReceived}
              </label>
              <div><label className={labelClass}>{t.form.signerName}</label><input type="text" value={fSigner} onChange={(e) => setFSigner(e.target.value)} className={inputClass} /></div>
              <div>
                <label className={labelClass}>状态</label>
                <select value={fStatus} onChange={(e) => setFStatus(e.target.value as ContractStatus)} className={inputClass}>
                  <option value="draft">{t.contractStatus.draft}</option>
                  <option value="active">{t.contractStatus.active}</option>
                </select>
              </div>
              {error && <p className="text-sm text-brand-red-600">{error}</p>}
              <button onClick={handleCreate} disabled={saving} className="w-full rounded bg-brand-orange py-2.5 text-sm font-semibold text-white hover:bg-brand-ink-700 disabled:opacity-50">{saving ? "..." : t.form.newContract}</button>
            </div>
          </div>
        </>
      )}

      {/* ── Detail Panel ── */}
      {panel === "detail" && selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto border-l border-brand-warm-400 bg-white shadow-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-400 bg-white px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-brand-ink-900">{selected.contract_no}</h3>
                <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold", statusColor[selected.status])}>{t.contractStatus[selected.status as keyof typeof t.contractStatus]}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => printLeaseContract({ contract: selected, unit: selectedUnit ?? null, customer: selectedCustomer ?? null }, locale)}
                  className="rounded p-1 text-brand-ink-300 hover:bg-brand-warm-100 hover:text-brand-orange-600"
                  title={dictionaries[locale].settings.print.print}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-300 hover:bg-brand-warm-100"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="space-y-4 px-5 py-5">
              {/* Contract info */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-brand-ink-300">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no ?? "-"} ({selectedUnit?.floor_label ?? ""})</dd></div>
                <div><dt className="text-xs text-brand-ink-300">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name ?? "-"}</dd></div>
                <div><dt className="text-xs text-brand-ink-300">{t.form.startDate}</dt><dd>{selected.start_date}</dd></div>
                <div><dt className="text-xs text-brand-ink-300">{t.form.expectedEndDate}</dt><dd>{selected.expected_end_date}</dd></div>
                {selected.actual_end_date && <div><dt className="text-xs text-brand-ink-300">{t.form.actualEndDate}</dt><dd>{selected.actual_end_date}</dd></div>}
                <div><dt className="text-xs text-brand-ink-300">{t.form.paymentCycle}</dt><dd>{t.paymentCycle[selected.payment_cycle as keyof typeof t.paymentCycle]} / {selected.payment_day}号</dd></div>
                <div><dt className="text-xs text-brand-ink-300">{t.form.monthlyRent}</dt><dd className="font-semibold">{formatXof(Number(selected.monthly_rent_xof))}</dd></div>
                <div><dt className="text-xs text-brand-ink-300">{t.form.deposit}</dt><dd>{formatXof(Number(selected.deposit_amount_xof))} {selected.deposit_received ? "✓已收" : "未收"}</dd></div>
                {selected.rent_free_days > 0 && <div><dt className="text-xs text-brand-ink-300">{t.form.rentFreeDays}</dt><dd>{selected.rent_free_days}天</dd></div>}
                {selected.signer_name && <div><dt className="text-xs text-brand-ink-300">{t.form.signerName}</dt><dd>{selected.signer_name}</dd></div>}
              </dl>

              {/* Actions */}
              {selected.status === "draft" && (
                <button onClick={() => handleActivate(selected.id)} disabled={saving} className="w-full rounded bg-brand-green-500 py-2 text-sm font-semibold text-white hover:bg-brand-green-600 disabled:opacity-50">{saving ? "..." : "激活合同"}</button>
              )}
              {selected.status === "active" && (
                <div className="flex gap-2">
                  <button onClick={() => openMoveOut(selected.id)} className="flex-1 rounded bg-brand-amber-500 py-2 text-sm font-semibold text-white hover:bg-brand-amber-600"><LogOut className="mr-1 inline h-4 w-4" />{t.settlement.moveOut}</button>
                </div>
              )}

              {/* Payment history + new payment */}
              <div className="border-t border-brand-warm-400 pt-4">
                <h4 className="text-sm font-bold text-brand-ink-900">{t.payment.title}</h4>
                {contractPayments.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {contractPayments.map((p) => (
                      <li key={p.id} className="flex justify-between text-brand-ink-500">
                        <span>{p.payment_date}{p.receipt_no ? ` (${p.receipt_no})` : ""}</span>
                        <span className="font-semibold">{formatXof(Number(p.amount))}</span>
                      </li>
                    ))}
                    <li className="flex justify-between border-t border-brand-warm-400 pt-1 text-sm font-bold">
                      <span>{t.payment.totalPaid}</span>
                      <span>{formatXof(totalPaid)}</span>
                    </li>
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-brand-ink-300">暂无收款记录</p>
                )}

                {/* Record new payment */}
                {selected.status === "active" && (
                  <div className="mt-3 space-y-2 rounded border border-brand-warm-400 bg-brand-warm-50 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-brand-ink-400">{t.payment.amount}</label><input type="number" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} className={inputClass} /></div>
                      <div><label className="text-xs text-brand-ink-400">{t.payment.paymentDate}</label><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputClass} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-brand-ink-400">{t.payment.receiptNo}</label><input type="text" value={payReceiptNo} onChange={(e) => setPayReceiptNo(e.target.value)} className={inputClass} /></div>
                      <div><label className="text-xs text-brand-ink-400">{t.payment.coveringMonths}</label><input type="number" min={1} value={payMonths} onChange={(e) => setPayMonths(Number(e.target.value))} className={inputClass} /></div>
                    </div>
                    <button onClick={handleRecordPayment} disabled={saving} className="w-full rounded bg-brand-orange py-1.5 text-xs font-semibold text-white hover:bg-brand-ink-700 disabled:opacity-50"><DollarSign className="mr-1 inline h-3 w-3" />{t.payment.record}</button>
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-brand-red-600">{error}</p>}
            </div>
          </div>
        </>
      )}

      {/* ── Move-out Settlement Panel ── */}
      {panel === "moveout" && selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setPanel(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto border-l border-brand-warm-400 bg-white shadow-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-warm-400 bg-white px-5 py-4">
              <h3 className="text-lg font-bold text-brand-ink-900">{t.settlement.title}</h3>
              <button onClick={() => setPanel(null)} className="rounded p-1 text-brand-ink-300 hover:bg-brand-warm-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <p className="text-sm text-brand-ink-500">{selected.contract_no} — {selectedCustomer?.name}</p>

              <div><label className={labelClass}>{t.form.actualEndDate}</label><input type="date" value={moEndDate} onChange={(e) => setMoEndDate(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{t.settlement.unpaidRent}</label><input type="number" value={moUnpaid} onChange={(e) => setMoUnpaid(Number(e.target.value))} className={inputClass} /></div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={moUtility} onChange={(e) => setMoUtility(e.target.checked)} className="h-4 w-4 rounded border-brand-warm-400" />
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
              <p className="text-xs text-brand-ink-300">{t.settlement.settlementNote}</p>
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
