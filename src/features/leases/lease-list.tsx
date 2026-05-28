"use client";

import { useState, useMemo } from "react";
import { Plus, X, AlertTriangle, FileText, DollarSign, LogOut, Printer, RefreshCw } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { RoomCard } from "@/components/room-card";
import { EmptyState } from "@/components/empty-state";
import type { RoomVisualStatus } from "@/lib/status-styles";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import { contractStatusVariant as statusVariant, receivableStatusStyles as STATUS_STYLES, receivableRowBg as ROW_BG } from "@/lib/status-styles";
import { printLeaseContract } from "@/features/print";
import { createLeaseContract, activateContract, terminateContract, recordReceivablePayment, generateLeaseReceivables, processMoveOut } from "./actions";

interface LeaseListProps { contracts: LeaseContractRow[]; units: UnitRow[]; customers: CustomerRow[]; payments: PaymentRow[]; receivables: ReceivableRow[]; locale: Locale }
type PanelType = "new" | "detail" | "moveout" | null;
const paymentCycles = ["monthly", "quarterly", "semiannual", "annual"];

export function LeaseList({ contracts, units, customers, payments, receivables, locale }: LeaseListProps) {
  const t = dictionaries[locale].leases;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [panel, setPanel] = useState<PanelType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [genMsg, setGenMsg] = useState("");
  const [fContractNo, setFContractNo] = useState(""); const [fUnitId, setFUnitId] = useState(""); const [fCustomerId, setFCustomerId] = useState("");
  const [fStartDate, setFStartDate] = useState(""); const [fEndDate, setFEndDate] = useState(""); const [fCycle, setFCycle] = useState("monthly");
  const [fPayDay, setFPayDay] = useState(5); const [fRent, setFRent] = useState(0); const [fDeposit, setFDeposit] = useState(0);
  const [fDepositReceived, setFDepositReceived] = useState(false); const [fFreeDays, setFFreeDays] = useState(0);
  const [fSigner, setFSigner] = useState(""); const [fStatus, setFStatus] = useState<ContractStatus>("draft");
  const [payReceivableId, setPayReceivableId] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0,10)); const [payReceiptNo, setPayReceiptNo] = useState("");
  const [moEndDate, setMoEndDate] = useState(new Date().toISOString().slice(0,10)); const [moUnpaid, setMoUnpaid] = useState(0);
  const [moUtility, setMoUtility] = useState(false); const [moDeduction, setMoDeduction] = useState(0); const [moRefund, setMoRefund] = useState(0);

  const filtered = useMemo(() => statusFilter === "all" ? contracts : contracts.filter((c) => c.status === statusFilter), [contracts, statusFilter]);
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const groupedContracts = useMemo(() => {
    const grouped = new Map<string, LeaseContractRow[]>();
    for (const contract of filtered) { const unit = unitMap.get(contract.unit_id); const floor = normalizeFloorLabel(unit?.floor_label ?? null, unit?.unit_no ?? ""); if (!grouped.has(floor)) grouped.set(floor, []); grouped.get(floor)!.push(contract); }
    return Array.from(grouped.entries()).sort((a, b) => floorSortValue(a[0]) - floorSortValue(b[0]));
  }, [filtered, unitMap]);

  const getContractReceivableSummary = (contractId: string) => {
    const related = receivables.filter((r) => r.source_type === "lease_contract" && r.source_id === contractId && r.status !== "cancelled");
    const today = new Date().toISOString().slice(0, 10); let total = 0, paid = 0, overdue = 0; let nextDue: string | null = null;
    for (const r of related) { const amount = Number(r.amount_xof); const paidAmount = Number(r.paid_amount_xof); const outstanding = Math.max(0, amount - paidAmount); total += amount; paid += paidAmount; if (outstanding > 0 && (r.status === "overdue" || r.due_date < today)) overdue += outstanding; if (outstanding > 0 && (!nextDue || r.due_date < nextDue)) nextDue = r.due_date; }
    return { total, paid, outstanding: Math.max(0, total - paid), overdue, nextDue, count: related.length };
  };

  const selected = selectedId ? contracts.find((c) => c.id === selectedId) : null;
  const selectedUnit = selected ? units.find((u) => u.id === selected.unit_id) : null;
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer_id) : null;

  const dashboardStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10); const active = contracts.filter((c) => c.status === "active");
    const expiring = active.filter((c) => { const days = Math.floor((new Date(c.expected_end_date).getTime() - Date.now()) / 86400000); return days >= 0 && days <= 30; }).length;
    let due = 0, overdue = 0;
    for (const r of receivables) { if (r.source_type !== "lease_contract" || r.status === "cancelled") continue; const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof); if (outstanding <= 0) continue; due += outstanding; if (r.status === "overdue" || r.due_date < today) overdue += outstanding; }
    return { active: active.length, rent: active.reduce((sum, c) => sum + Number(c.monthly_rent_xof), 0), expiring, due, overdue };
  }, [contracts, receivables]);

  const contractReceivables = useMemo(() => selectedId ? receivables.filter(r => r.source_type === "lease_contract" && r.source_id === selectedId && r.status !== "cancelled") : [], [receivables, selectedId]);
  const contractPayments = useMemo(() => selectedId ? payments.filter((p) => p.source_id === selectedId) : [], [payments, selectedId]);
  const totalPaid = contractPayments.reduce((s, p) => s + Number(p.amount), 0);
  const receivableStats = useMemo(() => { let totalRec=0,totalPd=0,overdue=0; const today=new Date().toISOString().slice(0,10); for(const r of contractReceivables){totalRec+=Number(r.amount_xof);totalPd+=Number(r.paid_amount_xof);const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<today))overdue+=os;} return {totalReceivable:totalRec,totalPaid:totalPd,outstanding:totalRec-totalPd,overdue}; }, [contractReceivables]);
  const contractRisk = useMemo(() => { if(!selected||selected.status!=="active")return {expiringSoon:false,daysLeft:0}; const today=new Date(); const diff=Math.floor((new Date(selected.expected_end_date).getTime()-today.getTime())/86400000); return {expiringSoon:diff<=30&&diff>=0,daysLeft:Math.max(0,diff)}; }, [selected]);
  const availableUnits = useMemo(() => units.filter((u) => u.kind === "apartment" && u.status === "available"), [units]);

  const resetNewForm = () => { setFContractNo(""); setFUnitId(""); setFCustomerId(""); setFStartDate(""); setFEndDate(""); setFCycle("monthly"); setFPayDay(5); setFRent(0); setFDeposit(0); setFDepositReceived(false); setFFreeDays(0); setFSigner(""); setFStatus("draft"); setError(""); };
  const openNew = () => { resetNewForm(); setPanel("new"); setSelectedId(null); };
  const openDetail = (id: string) => { setSelectedId(id); setPanel("detail"); setError(""); };
  const openMoveOut = (id: string) => { setSelectedId(id); setPanel("moveout"); setError(""); const os = receivableStats.outstanding; setMoUnpaid(os > 0 ? os : 0); setMoEndDate(new Date().toISOString().slice(0,10)); };

  const handleCreate = async () => { /* ... all existing validation logic kept ... */
    if (!fUnitId || !fCustomerId || !fStartDate || !fEndDate) { setError(locale==="zh"?"请填写必填字段":"Champs obligatoires"); return; }
    setSaving(true); setError(""); const result = await createLeaseContract({ unitId:fUnitId, customerId:fCustomerId, contractNo:fContractNo||"", startDate:fStartDate, expectedEndDate:fEndDate, paymentCycle:fCycle as never, paymentDay:fPayDay, monthlyRentXof:fRent, depositAmountXof:fDeposit, depositReceived:fDepositReceived, rentFreeDays:fFreeDays, signerName:fSigner||undefined, status:fStatus });
    setSaving(false); if(result.success) { setPanel(null); resetNewForm(); } else setError(result.error??"Failed");
  };
  const handleActivate = async (id: string) => { setSaving(true); const result = await activateContract(id); setSaving(false); if(!result.success) setError(result.error??"Failed"); else setGenMsg(locale==="zh"?"合同已激活，应收已自动生成":"Contrat active, echeances generees"); };
  const handleTerminate = async (id: string) => { setSaving(true); const result = await terminateContract(id); setSaving(false); if(!result.success) setError(result.error??"Failed"); };
  const handleGenerateReceivables = async (id: string) => { setSaving(true); setGenMsg(""); const result = await generateLeaseReceivables(id); setSaving(false); if(result.success) setGenMsg(t.receivable.generated.replace("{count}",String(result.count))); else setError(result.error??"Failed"); };
  const handleCollectReceivable = async () => { if(!payReceivableId)return; setSaving(true);setError("");const result=await recordReceivablePayment({receivableId:payReceivableId,paymentDate:payDate,receiptNo:payReceiptNo||undefined});setSaving(false);if(result.success){setPayReceivableId(null);setPayReceiptNo("");}else setError(result.error??"Failed");};
  const handleMoveOut = async () => { if(!selectedId)return;setSaving(true);setError("");const result=await processMoveOut({contractId:selectedId,actualEndDate:moEndDate,unpaidRentXof:moUnpaid,utilityCleared:moUtility,depositDeductionXof:moDeduction,depositRefundXof:moRefund});setSaving(false);if(result.success)setPanel(null);else setError(result.error??"Failed");};

  const inputClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";

  const statusLabel = (status: string) => { const labels: Record<string,string> = locale==="zh" ? {pending:"待收",partial:"部分",paid:"已收",overdue:"逾期",cancelled:"已取消"} : {pending:"Attente",partial:"Partiel",paid:"Paye",overdue:"Retard",cancelled:"Annule"}; return labels[status]??status; };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Summary cards ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard title={locale==="zh"?"生效合同":"Actifs"} value={String(dashboardStats.active)} tone="indigo" />
        <MetricCard title={locale==="zh"?"月租规模":"Loyer/mois"} value={formatXof(dashboardStats.rent)} tone="green" />
        <MetricCard title={locale==="zh"?"30天到期":"30 jours"} value={String(dashboardStats.expiring)} tone="amber" />
        <MetricCard title={locale==="zh"?"待收账款":"A recevoir"} value={formatXof(dashboardStats.due)} tone="indigo" />
        <MetricCard title={locale==="zh"?"逾期金额":"Retard"} value={formatXof(dashboardStats.overdue)} tone="red" />
      </div>

      {/* ── Filter bar + new contract ── */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {["all","draft","active","terminated","expired"].map((s) => (
              <button key={s} onClick={()=>setStatusFilter(s)} className={cn("rounded-md px-3 py-1.5 text-xs font-semibold transition", statusFilter===s ? "bg-primary text-primary-foreground shadow-sm" : "border bg-card text-muted-foreground hover:bg-accent")}>
                {s==="all"?(locale==="fr"?"Tous":"全部"):t.contractStatus[s as keyof typeof t.contractStatus]}
              </button>
            ))}
            <span className="pl-1 text-xs text-muted-foreground">{filtered.length}/{contracts.length} {locale==="fr"?"contrats":"份合同"}</span>
          </div>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4"/>{t.form.newContract}</Button>
        </CardContent>
      </Card>

      {/* ── Contract matrix ── */}
      {groupedContracts.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <div className="space-y-5">
          {groupedContracts.map(([floor, floorContracts]) => (
            <section key={floor}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary"/>
                  <h3 className="text-sm font-bold">{floor}</h3>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{floorContracts.length} {locale==="fr"?"contrats":"份合同"}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                {floorContracts.map((contract) => {
                  const unit = unitMap.get(contract.unit_id);
                  const customer = customerMap.get(contract.customer_id);
                  const summary = getContractReceivableSummary(contract.id);
                  const daysLeft = Math.floor((new Date(contract.expected_end_date).getTime() - Date.now()) / 86400000);
                  const isRisk = summary.overdue > 0 || (contract.status === "active" && daysLeft >= 0 && daysLeft <= 30);
                  return (
                    <RoomCard key={contract.id} roomNo={unit?.unit_no ?? "-"} status="leased"
                      statusLabel={t.contractStatus[contract.status as keyof typeof t.contractStatus]}
                      onClick={() => openDetail(contract.id)}
                      className={isRisk ? "ring-2 ring-amber-300" : ""}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold">{customer?.name ?? "-"}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{contract.contract_no}</p>
                        </div>
                        <Badge variant={statusVariant[contract.status]}>{t.contractStatus[contract.status as keyof typeof t.contractStatus]}</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                        <span><span className="text-muted-foreground">{locale==="zh"?"月租":"Loyer"} </span><span className="font-medium">{formatXof(Number(contract.monthly_rent_xof))}</span></span>
                        <span><span className="text-muted-foreground">{locale==="zh"?"到期":"Fin"} </span><span className={cn(daysLeft>=0&&daysLeft<=30?"text-amber-600":"")}>{contract.expected_end_date}</span></span>
                        <span><span className="text-muted-foreground">{locale==="zh"?"待收":"Solde"} </span><span className={cn("font-medium",summary.outstanding>0?"text-amber-600":"text-emerald-600")}>{formatXof(summary.outstanding)}</span></span>
                        <span><span className="text-muted-foreground">{locale==="zh"?"逾期":"Retard"} </span><span className={cn("font-medium",summary.overdue>0?"text-red-600":"text-emerald-600")}>{formatXof(summary.overdue)}</span></span>
                      </div>
                      <div className="mt-auto pt-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{locale==="zh"?"下一应收":"Prochaine"}</span>
                          <span>{summary.nextDue ?? "-"}</span>
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
      {panel === "new" && (<PanelShell onClose={()=>setPanel(null)} title={t.form.newContract}>{/* form fields same as before, using shadcn tokens */}{/* kept compact */}
        <div className="space-y-4">
          <div><label className={labelClass}>{t.form.contractNo} *</label><input type="text" value={fContractNo} onChange={e=>setFContractNo(e.target.value)} className={inputClass}/></div>
          <div><label className={labelClass}>{t.form.unit} *</label><select value={fUnitId} onChange={e=>setFUnitId(e.target.value)} className={inputClass}><option value="">{t.form.noUnit}</option>{availableUnits.map(u=><option key={u.id} value={u.id}>{u.unit_no} ({u.floor_label})</option>)}</select></div>
          <div><label className={labelClass}>{t.form.customer} *</label><select value={fCustomerId} onChange={e=>setFCustomerId(e.target.value)} className={inputClass}><option value="">{t.form.noCustomer}</option>{customers.filter(cc=>!cc.is_blacklisted).map(cc=><option key={cc.id} value={cc.id}>{cc.name} {cc.phone?`(${cc.phone})`:""}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t.form.startDate}</label><input type="date" value={fStartDate} onChange={e=>setFStartDate(e.target.value)} className={inputClass}/></div><div><label className={labelClass}>{t.form.expectedEndDate}</label><input type="date" value={fEndDate} onChange={e=>setFEndDate(e.target.value)} className={inputClass}/></div></div>
          <div className="grid grid-cols-3 gap-3"><div><label className={labelClass}>{t.form.paymentCycle}</label><select value={fCycle} onChange={e=>setFCycle(e.target.value)} className={inputClass}>{paymentCycles.map(pc=><option key={pc} value={pc}>{t.paymentCycle[pc as keyof typeof t.paymentCycle]}</option>)}</select></div><div><label className={labelClass}>{t.form.paymentDay}</label><input type="number" min={1} max={31} value={fPayDay} onChange={e=>setFPayDay(Number(e.target.value))} className={inputClass}/></div><div><label className={labelClass}>{t.form.monthlyRent}</label><input type="number" value={fRent} onChange={e=>setFRent(Number(e.target.value))} className={inputClass}/></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t.form.deposit}</label><input type="number" value={fDeposit} onChange={e=>setFDeposit(Number(e.target.value))} className={inputClass}/></div><div><label className={labelClass}>{t.form.rentFreeDays}</label><input type="number" value={fFreeDays} onChange={e=>setFFreeDays(Number(e.target.value))} className={inputClass}/></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fDepositReceived} onChange={e=>setFDepositReceived(e.target.checked)} className="h-4 w-4 rounded border"/>{t.form.depositReceived}</label>
          <div><label className={labelClass}>{t.form.signerName}</label><input type="text" value={fSigner} onChange={e=>setFSigner(e.target.value)} className={inputClass}/></div>
          <div><label className={labelClass}>{t.form.statusLabel}</label><select value={fStatus} onChange={e=>setFStatus(e.target.value as ContractStatus)} className={inputClass}><option value="draft">{t.contractStatus.draft}</option><option value="active">{t.contractStatus.active}</option></select></div>
          {error&&<p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" onClick={handleCreate} disabled={saving}>{saving?"...":t.form.newContract}</Button>
        </div>
      </PanelShell>)}

      {/* ── Detail Panel ── */}
      {panel==="detail"&&selected&&(<PanelShell onClose={()=>setPanel(null)} title={selected.contract_no} badge={<Badge variant={statusVariant[selected.status]}>{t.contractStatus[selected.status as keyof typeof t.contractStatus]}</Badge>} actions={<button onClick={()=>printLeaseContract({contract:selected,unit:selectedUnit??null,customer:selectedCustomer??null},locale)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground" title={dictionaries[locale].settings.print.print}><Printer className="h-4 w-4"/></button>}>
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-xs text-muted-foreground">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no??"-"} ({selectedUnit?.floor_label??""})</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name??"-"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.startDate}</dt><dd>{selected.start_date}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.expectedEndDate}</dt><dd>{selected.expected_end_date}</dd></div>
            {selected.actual_end_date&&<div><dt className="text-xs text-muted-foreground">{t.form.actualEndDate}</dt><dd>{selected.actual_end_date}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">{t.form.paymentCycle}</dt><dd>{t.paymentCycle[selected.payment_cycle as keyof typeof t.paymentCycle]} / {selected.payment_day}号</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.monthlyRent}</dt><dd className="font-semibold">{formatXof(Number(selected.monthly_rent_xof))}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.deposit}</dt><dd>{formatXof(Number(selected.deposit_amount_xof))} {selected.deposit_received?t.form.depositPaid:t.form.depositUnpaid}</dd></div>
            {selected.rent_free_days>0&&<div><dt className="text-xs text-muted-foreground">{t.form.rentFreeDays}</dt><dd>{selected.rent_free_days}天</dd></div>}
            {selected.signer_name&&<div><dt className="text-xs text-muted-foreground">{t.form.signerName}</dt><dd>{selected.signer_name}</dd></div>}
          </dl>
          {selected.status==="draft"&&<Button className="w-full" variant="default" onClick={()=>handleActivate(selected.id)} disabled={saving}>{saving?"...":t.form.activateContract}</Button>}
          {selected.status==="active"&&<Button className="w-full" variant="outline" onClick={()=>openMoveOut(selected.id)}><LogOut className="mr-1 inline h-4 w-4"/>{t.settlement.moveOut}</Button>}
          {genMsg&&<p className="text-xs text-emerald-600 font-medium">{genMsg}</p>}

          {/* Risk indicators */}
          {selected.status==="active"&&<div className="border-t pt-4">
            <h4 className="text-sm font-bold flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-500"/>{locale==="zh"?"风险概览":"Apercu des risques"}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className={cn("rounded-md border px-3 py-2",receivableStats.outstanding>0?"border-amber-200 bg-amber-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.outstandingTotal}</p><p className={cn("font-bold tabular-nums",receivableStats.outstanding>0?"text-amber-700":"text-emerald-700")}>{formatXof(receivableStats.outstanding)}</p></div>
              <div className={cn("rounded-md border px-3 py-2",receivableStats.overdue>0?"border-red-200 bg-red-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.overdueTotal}</p><p className={cn("font-bold tabular-nums",receivableStats.overdue>0?"text-red-700":"text-emerald-700")}>{formatXof(receivableStats.overdue)}</p></div>
              <div className={cn("rounded-md border px-3 py-2",!selected.deposit_received?"border-red-200 bg-red-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.depositStatus}</p><p className={cn("text-xs font-semibold",selected.deposit_received?"text-emerald-700":"text-red-600")}>{selected.deposit_received?t.form.depositPaid:t.form.depositUnpaid}</p></div>
              <div className={cn("rounded-md border px-3 py-2",contractRisk.expiringSoon?"border-amber-200 bg-amber-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.expiringSoon}</p><p className={cn("text-xs font-semibold",contractRisk.expiringSoon?"text-amber-700":"text-emerald-700")}>{contractRisk.expiringSoon?`${contractRisk.daysLeft} ${locale==="zh"?"天后到期":"j restants"}`:(locale==="zh"?"否":"Non")}</p></div>
            </div>
          </div>}

          {/* Receivable list */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-bold">{t.receivable.title}</h4>{selected.status==="active"&&<button onClick={()=>handleGenerateReceivables(selected.id)} disabled={saving} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"><RefreshCw className="h-3 w-3"/>{t.receivable.generate}</button>}</div>
            {contractReceivables.length===0?<p className="text-xs text-muted-foreground">{t.receivable.none}</p>:<table className="w-full text-left text-[13px]"><thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"><tr><th className="px-2 py-1.5">{t.receivable.dueDate}</th><th className="px-2 py-1.5 text-right">{t.receivable.amount}</th><th className="px-2 py-1.5 text-right">{t.receivable.paid}</th><th className="px-2 py-1.5 text-center">{t.receivable.status}</th><th className="px-2 py-1.5"/></tr></thead><tbody className="divide-y">{contractReceivables.map(r=>{const os=Number(r.amount_xof)-Number(r.paid_amount_xof);const od=new Date(r.due_date).getTime()<Date.now()?Math.floor((Date.now()-new Date(r.due_date).getTime())/86400000):null;return(<tr key={r.id} className={cn("transition-colors hover:bg-accent/50",ROW_BG[r.status])}><td className="px-2 py-1.5">{r.due_date}{od!==null&&od>0&&<span className="ml-1 text-xs text-red-500">+{od}</span>}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatXof(Number(r.amount_xof))}</td><td className="px-2 py-1.5 text-right tabular-nums text-emerald-600">{formatXof(Number(r.paid_amount_xof))}</td><td className="px-2 py-1.5 text-center"><span className={cn("rounded-full px-1.5 py-0.5 text-xs font-semibold",STATUS_STYLES[r.status])}>{statusLabel(r.status)}</span></td><td className="px-2 py-1.5">{os>0&&selected.status==="active"&&(payReceivableId===r.id?<span className="text-xs text-muted-foreground">{locale==="zh"?"收款中...":"En cours..."}</span>:<button onClick={()=>{setPayReceivableId(r.id);setPayDate(new Date().toISOString().slice(0,10));setPayReceiptNo("");setError("");}} className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90">{locale==="zh"?"收款":"Enc"}</button>)}</td></tr>);})}</tbody></table>}
            {payReceivableId&&<div className="mt-3 space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收款日期":"Date"}</label><input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收据号":"Recu"}</label><input type="text" value={payReceiptNo} onChange={e=>setPayReceiptNo(e.target.value)} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handleCollectReceivable} disabled={saving}>{saving?"...":locale==="zh"?"确认收款":"Encaisser"}</Button><Button size="sm" variant="ghost" onClick={()=>{setPayReceivableId(null);setError("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>}
          </div>
        </div>
      </PanelShell>)}

      {/* ── Move-out Panel ── */}
      {panel==="moveout"&&selected&&(<PanelShell onClose={()=>setPanel(null)} title={t.settlement.moveOut}>{/* form kept identical to original */}{/*...*/}<div className="space-y-4"><div><label className={labelClass}>{t.form.actualEndDate}</label><input type="date" value={moEndDate} onChange={e=>setMoEndDate(e.target.value)} className={inputClass}/></div><div><label className={labelClass}>{locale==="zh"?"未付租金":"Loyer impaye"}</label><input type="number" value={moUnpaid} onChange={e=>setMoUnpaid(Number(e.target.value))} className={inputClass}/></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moUtility} onChange={e=>setMoUtility(e.target.checked)}/>{locale==="zh"?"水电已结清":"Charges reglees"}</label><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"押金抵扣":"Retenue depot"}</label><input type="number" value={moDeduction} onChange={e=>setMoDeduction(Number(e.target.value))} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"押金退还":"Remb. depot"}</label><input type="number" value={moRefund} onChange={e=>setMoRefund(Number(e.target.value))} className={inputClass}/></div></div>{error&&<p className="text-sm text-red-600">{error}</p>}<Button className="w-full" onClick={handleMoveOut} disabled={saving}>{saving?"...":locale==="zh"?"确认退租":"Confirmer"}</Button></div></PanelShell>)}
    </div>
  );
}

// ── Shared panel shell ──
function PanelShell({ onClose, title, badge, actions, children }: { onClose:()=>void; title:string; badge?:React.ReactNode; actions?:React.ReactNode; children:React.ReactNode }) {
  return (<>
    <div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={onClose}/>
    <div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l bg-card shadow-lg">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold">{title}</h3>{badge}</div>
        <div className="flex items-center gap-1">{actions}<button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4"/></button></div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  </>);
}
