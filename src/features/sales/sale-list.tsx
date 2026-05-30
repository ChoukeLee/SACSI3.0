"use client";

import { useState, useMemo } from "react";
import { Plus, X, DollarSign, FileText, CalendarPlus, TrendingUp, AlertTriangle, Eye } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { contractStatusVariant as statusVariant } from "@/lib/status-styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { EmptyState } from "@/components/empty-state";
import type { SaleContractRow, SalePaymentScheduleRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";
import { createSaleContract, recordSalePayment, addFlexibleInstallment, updateTransferStatus, terminateSaleContract } from "./actions";

interface SaleListProps { contracts: SaleContractRow[]; schedules: SalePaymentScheduleRow[]; units: UnitRow[]; customers: CustomerRow[]; payments: PaymentRow[]; receivables: ReceivableRow[]; locale: Locale }
type PanelType = "new" | "detail" | null;

export function SaleList({ contracts, schedules, units, customers, payments, receivables, locale }: SaleListProps) {
  const t = dictionaries[locale].sales;
  const [statusFilter, setStatusFilter] = useState("all");
  const [panel, setPanel] = useState<PanelType>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [fContractNo, setFContractNo] = useState(""); const [fUnitId, setFUnitId] = useState(""); const [fCustomerId, setFCustomerId] = useState("");
  const [fSignedDate, setFSignedDate] = useState(new Date().toISOString().slice(0,10)); const [fTotalAmount, setFTotalAmount] = useState(0);
  const [fPlanType, setFPlanType] = useState("lump_sum"); const [fNumInstallments, setFNumInstallments] = useState(3);
  const [fAgency, setFAgency] = useState(""); const [fAgent, setFAgent] = useState(""); const [fCommission, setFCommission] = useState(0); const [fCommissionPaid, setFCommissionPaid] = useState(false);
  const [payScheduleId, setPayScheduleId] = useState(""); const [payAmount, setPayAmount] = useState(0);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0,10)); const [payReceiptNo, setPayReceiptNo] = useState("");
  const [flexDueDate, setFlexDueDate] = useState(""); const [flexAmount, setFlexAmount] = useState(0);
  const [trStatus, setTrStatus] = useState("not_started"); const [trDate, setTrDate] = useState(""); const [trCertNo, setTrCertNo] = useState("");
  const [termReason, setTermReason] = useState("");
  const [showFlexForm, setShowFlexForm] = useState(false);

  const filtered = useMemo(() => statusFilter==="all"?contracts:contracts.filter(c=>c.status===statusFilter), [contracts,statusFilter]);
  const unitMap = useMemo(()=>new Map(units.map(u=>[u.id,u])), [units]);
  const customerMap = useMemo(()=>new Map(customers.map(c=>[c.id,c])), [customers]);

  const groupedContracts = useMemo(() => {
    const g=new Map<string,SaleContractRow[]>();
    for(const c of filtered){const unit=unitMap.get(c.unit_id);const floor=normalizeFloorLabel(unit?.floor_label??null,unit?.unit_no??"");if(!g.has(floor))g.set(floor,[]);g.get(floor)!.push(c);}
    return Array.from(g.entries()).sort((a,b)=>floorSortValue(a[0])-floorSortValue(b[0]));
  }, [filtered,unitMap]);

  const selected = selectedId?contracts.find(c=>c.id===selectedId):null;
  const selectedUnit = selected?units.find(u=>u.id===selected.unit_id):null;
  const selectedCustomer = selected?customers.find(c=>c.id===selected.customer_id):null;

  const dashboardStats = useMemo(()=>{
    const active=contracts.filter(c=>c.status==="active");let received=0,receivable=0,overdue=0;const today=new Date().toISOString().slice(0,10);
    for(const r of receivables){if(r.source_type!=="sale_contract"||r.status==="cancelled")continue;received+=Number(r.paid_amount_xof);receivable+=Number(r.amount_xof);const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<today))overdue+=os;}
    return {active:active.length,total:active.reduce((s,c)=>s+Number(c.total_amount_xof),0),received,receivable,overdue,transferDone:active.filter(c=>c.transfer_status==="completed").length};
  }, [contracts,receivables]);

  const contractSchedules = useMemo(()=>selectedId?schedules.filter(s=>s.sale_contract_id===selectedId).sort((a,b)=>a.installment_no-b.installment_no):[], [schedules,selectedId]);
  const contractReceivables = useMemo(()=>selectedId?receivables.filter(r=>r.source_type==="sale_contract"&&r.source_id===selectedId&&r.status!=="cancelled"):[], [receivables,selectedId]);
  const contractPayments = useMemo(()=>selectedId?payments.filter(p=>p.source_id===selectedId):[], [payments,selectedId]);
  const totalPaidRec = useMemo(()=>contractReceivables.reduce((s,r)=>s+Number(r.paid_amount_xof),0),[contractReceivables]);
  const totalRec = useMemo(()=>contractReceivables.reduce((s,r)=>s+Number(r.amount_xof),0),[contractReceivables]);
  const totalOverdueRec = useMemo(()=>{let o=0;const today=new Date().toISOString().slice(0,10);for(const r of contractReceivables){const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<today))o+=os;}return o;},[contractReceivables]);
  const totalPaidPayments = contractPayments.reduce((s,p)=>s+Number(p.amount),0);

  const getContractSummary = (cid: string) => {const rr=receivables.filter(r=>r.source_type==="sale_contract"&&r.source_id===cid&&r.status!=="cancelled");let t=0,p=0,o=0;const today=new Date().toISOString().slice(0,10);for(const r of rr){t+=Number(r.amount_xof);p+=Number(r.paid_amount_xof);const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<today))o+=os;}return {total:t,paid:p,outstanding:t-p,overdue:o};};

  const getSchedStatus = (s: SalePaymentScheduleRow, rr: ReceivableRow[]) => {const rec=rr.find(r=>r.due_date===s.due_date&&Math.abs(Number(r.amount_xof)-Number(s.amount_xof))<1);if(!rec||rec.status==="cancelled")return s.status;return rec.status==="paid"?"paid":Number(rec.paid_amount_xof)>0&&Number(rec.paid_amount_xof)<Number(rec.amount_xof)?"partial":rec.status==="overdue"?"overdue":s.status==="paid"?"paid":"pending";};

  const openNew = () => {setPanel("new");setSelectedId(null);setError("");};
  const openDetail = (id:string) => {setSelectedId(id);setPanel("detail");setError("");};

  const handleCreate = async () => {if(!fUnitId||!fCustomerId||!fSignedDate||fTotalAmount<=0){setError(locale==="zh"?"请填写必填字段":"Champs obligatoires");return;}setSaving(true);setError("");const r=await createSaleContract({unitId:fUnitId,customerId:fCustomerId,contractNo:fContractNo||"",signedDate:fSignedDate,totalAmountXof:fTotalAmount,paymentPlanType:fPlanType,numInstallments:fPlanType==="fixed_installment"?fNumInstallments:undefined,agencyCompany:fAgency||undefined,agentName:fAgent||undefined,agencyCommissionXof:fCommission,agencyCommissionPaid:fCommissionPaid});setSaving(false);if(r.success){setPanel(null);}else setError(r.error??"Failed");};
  const handlePay = async () => {if(!payScheduleId||payAmount<=0){setError(locale==="zh"?"请选择分期并输入金额":"Champs obligatoires");return;}setSaving(true);setError("");const r=await recordSalePayment({contractId:selectedId!,scheduleId:payScheduleId,amount:payAmount,paymentDate:payDate,receiptNo:payReceiptNo||undefined});setSaving(false);if(r.success){setPayScheduleId("");setPayAmount(0);setPayReceiptNo("");}else setError(r.error??"Failed");};
  const handleAddFlex = async () => {if(!flexDueDate||flexAmount<=0){setError(locale==="zh"?"请填写到期日和金额":"Champs obligatoires");return;}setSaving(true);setError("");const r=await addFlexibleInstallment({contractId:selectedId!,installmentNo:contractSchedules.length+1,dueDate:flexDueDate,amountXof:flexAmount});setSaving(false);if(r.success){setShowFlexForm(false);setFlexDueDate("");setFlexAmount(0);}else setError(r.error??"Failed");};
  const handleTransfer = async () => {if(!trDate){setError(locale==="zh"?"请选择过户日期":"Champs obligatoires");return;}setSaving(true);setError("");const r=await updateTransferStatus(selectedId!,trStatus,trDate,trCertNo||undefined);setSaving(false);if(r.success)setPanel(null);else setError(r.error??"Failed");};
  const handleTerminateSale = async () => {setSaving(true);setError("");const r=await terminateSaleContract(selectedId!,termReason||(locale==="zh"?"手动终止":"Manuel"));setSaving(false);if(r.success)setPanel(null);else setError(r.error??"Failed");};

  const inputClass="w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
  const labelClass="block text-xs font-semibold text-muted-foreground mb-1";
  const schedLabel = (s: string) => { const l: Record<string,string>=locale==="zh"?{pending:"待付",paid:"已付",overdue:"逾期",cancelled:"取消"}:{pending:"Attente",paid:"Paye",overdue:"Retard",cancelled:"Annule"}; return l[s]??s; };
  const transText = (s:string)=>locale==="zh"?{not_started:"未开始",in_progress:"办理中",completed:"已完成"}[s]??s:{not_started:"Non debute",in_progress:"En cours",completed:"Termine"}[s]??s;

  const sellableUnits = useMemo(()=>units.filter(u=>(u.kind==="apartment"||u.kind==="parking")&&(u.status==="available"||u.status==="sold")),[units]);

// ── Card helpers ──
function SaleInfo({ label, value, good, warn, danger }: { label: string; value: string; good?: boolean; warn?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1 text-[12px]">
      <span className="text-[#5D7186] shrink-0">{label}</span>
      <span className={cn("font-medium tabular-nums truncate text-right", danger ? "text-[#C0394A]" : warn ? "text-amber-600" : good ? "text-emerald-600" : "text-[#17324D]")}>{value}</span>
    </div>
  )
}
function SaleActionBtn({ icon: Icon, label, onClick }: { icon: typeof Eye; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(23,50,77,0.10)] bg-white/80 text-[#27506F] shadow-[0_1px_2px_rgba(25,58,92,0.04)] transition-all hover:bg-white hover:-translate-y-px"
      aria-label={label} title={label}>
      <Icon className="h-[14px] w-[14px]" strokeWidth={1.5} />
    </button>
  )
}

  const statBlocks = [
    { key: "active", label: locale==="zh"?"生效出售":"Ventes actives", value: String(dashboardStats.active), dot: "bg-accentGreen-500" },
    { key: "total", label: locale==="zh"?"合同总额":"Total contrats", value: formatXof(dashboardStats.total), dot: "bg-accentBlue-500" },
    { key: "received", label: locale==="zh"?"已回款":"Recu", value: formatXof(dashboardStats.received), dot: "bg-accentGreen-500" },
    { key: "receivable", label: locale==="zh"?"待回款":"A recevoir", value: formatXof(dashboardStats.receivable-dashboardStats.received), dot: "bg-accentAmber-500" },
    { key: "overdue", label: locale==="zh"?"逾期回款":"Retard", value: formatXof(dashboardStats.overdue), dot: dashboardStats.overdue > 0 ? "bg-accentRed-500" : "bg-muted-foreground/40" },
    { key: "transfer", label: locale==="zh"?"已过户":"Transfert", value: String(dashboardStats.transferDone), dot: "bg-accentPurple-500" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page chrome ── */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {locale === "zh" ? "出售业务" : "Ventes"}
        </p>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {locale === "zh" ? "出售合同" : "Contrats de vente"}
          </h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {contracts.length} {locale==="fr"?"contrats":"份合同"}
          </span>
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {statBlocks.map(b => (
          <div key={b.key} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", b.dot)} />
            <div className="min-w-0">
              <p className="text-xl font-bold tracking-tight tabular-nums leading-none">{b.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{b.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {["all","draft","active","terminated","expired"].map(s=>(<button key={s} onClick={()=>setStatusFilter(s)} className={cn("rounded-md px-3 py-1.5 text-xs font-semibold transition",statusFilter===s?"bg-primary text-primary-foreground shadow-sm":"border bg-card text-muted-foreground hover:bg-accent")}>{s==="all"?(locale==="fr"?"Tous":"全部"):t.contractStatus[s as keyof typeof t.contractStatus]}</button>))}
          <span className="pl-1 text-xs text-muted-foreground">{filtered.length}/{contracts.length} {locale==="fr"?"contrats":"份合同"}</span>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4"/>{t.form.newContract}</Button>
      </div>

      {/* ── Contract matrix (BusinessRoomCard) ── */}
      {groupedContracts.length===0?(<EmptyState title={t.empty}/>):(
        groupedContracts.map(([floor,fc])=>(
          <RoomBoard
            key={floor}
            header={<>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <h3 className="text-sm font-semibold">{floor}</h3>
              </div>
              <span className="text-[12px] font-medium text-[#5D7186]">{fc.length} {locale==="fr"?"contrats":"份合同"}</span>
            </>}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              {fc.map(contract=>{const unit=unitMap.get(contract.unit_id);const customer=customerMap.get(contract.customer_id);const s=getContractSummary(contract.id);const isRisk=s.overdue>0||(contract.status==="active"&&contract.transfer_status!=="completed");return(<RoomCard key={contract.id} roomNo={unit?.unit_no??"-"} status="sold" statusLabel={t.contractStatus[contract.status as keyof typeof t.contractStatus]} onClick={()=>openDetail(contract.id)} className={isRisk?"ring-2 ring-amber-300":""}>
                {/* Name + status badge */}
                <div className="flex items-start justify-between gap-1.5">
                  <p className="text-[13px] font-medium leading-tight truncate" title={customer?.name??""}>{customer?.name??"-"}</p>
                  <Badge variant={statusVariant[contract.status]} className="shrink-0 text-[10px]">{t.contractStatus[contract.status as keyof typeof t.contractStatus]}</Badge>
                </div>
                {/* Compact info row */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#5D7186]">
                  <span title={contract.contract_no} className="truncate max-w-[90px]">{contract.contract_no}</span>
                  <span>·</span>
                  <span className="tabular-nums">{formatXof(Number(contract.total_amount_xof))}</span>
                  {s.outstanding>0 && <span className="text-amber-600 font-medium">{formatXof(s.outstanding)} {locale==="zh"?"待收":"dû"}</span>}
                </div>
                {/* Transfer status + action buttons */}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className={cn("text-[11px]", contract.transfer_status==="completed"?"text-emerald-600":"text-[#5D7186]")}>{transText(contract.transfer_status)}</span>
                  <div className="flex gap-1.5">
                    <SaleActionBtn icon={Eye} label={locale==="zh"?"查看":"Voir"} onClick={() => openDetail(contract.id)} />
                    <SaleActionBtn icon={DollarSign} label={locale==="zh"?"回款":"Pmt"} onClick={() => { openDetail(contract.id); }} />
                    <SaleActionBtn icon={FileText} label={locale==="zh"?"单据":"Docs"} onClick={() => { openDetail(contract.id); }} />
                  </div>
                </div>
              </RoomCard>);})}
            </div>
          </RoomBoard>
        ))
      )}

      {/* ── New Contract Panel ── */}
      {panel==="new"&&(<><div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={()=>setPanel(null)}/><div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l bg-card shadow-lg"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-4 backdrop-blur"><h3 className="text-sm font-bold">{t.form.newContract}</h3><button onClick={()=>setPanel(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4"/></button></div>
        <div className="space-y-4 px-5 py-5"><div><label className={labelClass}>{t.form.contractNo}</label><input type="text" value={fContractNo} onChange={e=>setFContractNo(e.target.value)} className={inputClass}/></div><div><label className={labelClass}>{t.form.unit} *</label><select value={fUnitId} onChange={e=>setFUnitId(e.target.value)} className={inputClass}><option value="">{t.form.noUnit}</option>{sellableUnits.map(u=><option key={u.id} value={u.id}>{u.unit_no} ({u.floor_label})</option>)}</select></div><div><label className={labelClass}>{t.form.customer} *</label><select value={fCustomerId} onChange={e=>setFCustomerId(e.target.value)} className={inputClass}><option value="">{t.form.noCustomer}</option>{customers.filter(cc=>!cc.is_blacklisted).map(cc=><option key={cc.id} value={cc.id}>{cc.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t.form.signedDate}</label><input type="date" value={fSignedDate} onChange={e=>setFSignedDate(e.target.value)} className={inputClass}/></div><div><label className={labelClass}>{t.form.totalAmount} *</label><input type="number" value={fTotalAmount} onChange={e=>setFTotalAmount(Number(e.target.value))} className={inputClass}/></div></div>
          <div><label className={labelClass}>{locale==="zh"?"付款计划":"Plan"}</label><select value={fPlanType} onChange={e=>setFPlanType(e.target.value)} className={inputClass}><option value="lump_sum">{t.paymentPlan.lump_sum}</option><option value="fixed_installment">{t.paymentPlan.fixed_installment}</option><option value="flexible_installment">{t.paymentPlan.flexible_installment}</option></select></div>
          {fPlanType==="fixed_installment"&&<div><label className={labelClass}>{locale==="zh"?"分期数":"Nb echeances"}</label><input type="number" min={2} max={24} value={fNumInstallments} onChange={e=>setFNumInstallments(Number(e.target.value))} className={inputClass}/></div>}
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{locale==="zh"?"中介公司":"Agence"}</label><input type="text" value={fAgency} onChange={e=>setFAgency(e.target.value)} className={inputClass}/></div><div><label className={labelClass}>{locale==="zh"?"中介":"Agent"}</label><input type="text" value={fAgent} onChange={e=>setFAgent(e.target.value)} className={inputClass}/></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{locale==="zh"?"佣金":"Commission"}</label><input type="number" value={fCommission} onChange={e=>setFCommission(Number(e.target.value))} className={inputClass}/></div><label className="flex items-center gap-2 text-sm pt-6"><input type="checkbox" checked={fCommissionPaid} onChange={e=>setFCommissionPaid(e.target.checked)}/>{locale==="zh"?"佣金已付":"Com. payee"}</label></div>
          {error&&<p className="text-sm text-red-600">{error}</p>}<Button className="w-full" onClick={handleCreate} disabled={saving}>{saving?"...":t.form.newContract}</Button></div></div></>)}

      {/* ── Detail Panel ── */}
      {panel==="detail"&&selected&&(<><div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={()=>setPanel(null)}/><div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l bg-card shadow-lg"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-4 backdrop-blur"><div><h3 className="text-sm font-bold">{selected.contract_no}</h3><Badge variant={statusVariant[selected.status]}>{t.contractStatus[selected.status as keyof typeof t.contractStatus]}</Badge></div><button onClick={()=>setPanel(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4"/></button></div>
        <div className="space-y-4 px-5 py-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-xs text-muted-foreground">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no??"-"} ({selectedUnit?.floor_label??""})</dd></div><div><dt className="text-xs text-muted-foreground">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name??"-"}</dd></div><div><dt className="text-xs text-muted-foreground">{t.form.signedDate}</dt><dd>{selected.signed_date}</dd></div><div><dt className="text-xs text-muted-foreground">{t.form.totalAmount}</dt><dd className="font-semibold">{formatXof(Number(selected.total_amount_xof))}</dd></div><div><dt className="text-xs text-muted-foreground">{locale==="zh"?"过户状态":"Transfert"}</dt><dd className={cn("font-medium",selected.transfer_status==="completed"?"text-emerald-600":"")}>{transText(selected.transfer_status)}</dd></div></dl>
          {selected.status==="active"&&<div className="grid grid-cols-2 gap-2"><Button size="sm" onClick={()=>{setPayScheduleId(contractSchedules.find(s=>s.status!=="paid")?.id??"");setPayAmount(0);}}><DollarSign className="h-4 w-4"/>{locale==="zh"?"收款":"Paiement"}</Button><Button size="sm" variant="outline" onClick={()=>{setShowFlexForm(true);setFlexDueDate("");setFlexAmount(0);setError("");}}><CalendarPlus className="h-4 w-4"/>{locale==="zh"?"新增分期":"+Echeance"}</Button><Button size="sm" variant="outline" onClick={()=>{setTrDate(new Date().toISOString().slice(0,10));setTrStatus(selected.transfer_status);}}><TrendingUp className="h-4 w-4"/>{locale==="zh"?"过户":"Transfert"}</Button><Button size="sm" variant="ghost" onClick={handleTerminateSale}><AlertTriangle className="h-4 w-4"/>{locale==="zh"?"终止":"Resilier"}</Button></div>}

          {/* Installment plan */}
          <div className="border-t pt-4"><h4 className="text-sm font-bold mb-2">{locale==="zh"?"分期计划":"Plan de paiement"}</h4>
            {contractSchedules.length===0?<p className="text-xs text-muted-foreground">{locale==="zh"?"暂无数据":"Aucun"}</p>:<table className="w-full text-left text-[13px]"><thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"><tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">{locale==="zh"?"到期日":"Echeance"}</th><th className="px-2 py-1.5 text-right">{locale==="zh"?"金额":"Montant"}</th><th className="px-2 py-1.5 text-center">{locale==="zh"?"状态":"Statut"}</th><th className="px-2 py-1.5 text-right">{locale==="zh"?"已收":"Paye"}</th></tr></thead><tbody className="divide-y">{contractSchedules.map(s=>{const stat=getSchedStatus(s,contractReceivables);const recPaid=contractReceivables.find(r=>r.due_date===s.due_date&&Math.abs(Number(r.amount_xof)-Number(s.amount_xof))<1);return(<tr key={s.id} className={cn("transition-colors hover:bg-accent/50",stat==="overdue"&&"bg-red-50/30")}><td className="px-2 py-1.5 font-mono text-xs">{s.installment_no}</td><td className="px-2 py-1.5">{s.due_date}</td><td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatXof(Number(s.amount_xof))}</td><td className="px-2 py-1.5 text-center"><Badge variant={stat==="paid"?"success":stat==="overdue"?"destructive":"warning"}>{schedLabel(stat)}</Badge></td><td className="px-2 py-1.5 text-right tabular-nums text-emerald-600">{recPaid?formatXof(Number(recPaid.paid_amount_xof)):"-"}</td></tr>);})}</tbody></table>}
          </div>

          {/* Pay form */}
          {payScheduleId&&<div className="space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"选择分期":"Echeance"}</label><select value={payScheduleId} onChange={e=>{setPayScheduleId(e.target.value);if(!e.target.value){setPayAmount(0);return;}const s=contractSchedules.find(i=>i.id===e.target.value);if(s){const matchingRec=contractReceivables.find(r=>r.due_date===s.due_date&&Math.abs(Number(r.amount_xof)-Number(s.amount_xof))<1);const unpaid=matchingRec?Number(matchingRec.amount_xof)-Number(matchingRec.paid_amount_xof):Number(s.amount_xof);setPayAmount(unpaid);}}} className={inputClass}><option value="">-</option>{contractSchedules.filter(s=>s.status!=="paid").map(s=><option key={s.id} value={s.id}>#{s.installment_no} {s.due_date} {formatXof(Number(s.amount_xof))}</option>)}</select></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收款日期":"Date"}</label><input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"金额":"Montant"}</label><input type="number" value={payAmount} onChange={e=>setPayAmount(Number(e.target.value))} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收据号":"Recu"}</label><input type="text" value={payReceiptNo} onChange={e=>setPayReceiptNo(e.target.value)} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handlePay} disabled={saving}>{saving?"...":locale==="zh"?"确认收款":"Encaisser"}</Button><Button size="sm" variant="ghost" onClick={()=>{setPayScheduleId("");setError("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>}

          {/* Flex installment form */}
          {showFlexForm&&<div className="space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"到期日":"Echeance"}</label><input type="date" value={flexDueDate} onChange={e=>setFlexDueDate(e.target.value)} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"金额":"Montant"}</label><input type="number" value={flexAmount} onChange={e=>setFlexAmount(Number(e.target.value))} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handleAddFlex} disabled={saving}>{saving?"...":locale==="zh"?"新增":"Ajouter"}</Button><Button size="sm" variant="ghost" onClick={()=>{setShowFlexForm(false);setFlexDueDate("");setFlexAmount(0);setError("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>}

          {/* Transfer form */}
          {selected.status==="active"&&trDate&&(<div className="space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"过户状态":"Transfert"}</label><select value={trStatus} onChange={e=>setTrStatus(e.target.value)} className={inputClass}><option value="not_started">{transText("not_started")}</option><option value="in_progress">{transText("in_progress")}</option><option value="completed">{transText("completed")}</option></select></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"过户日期":"Date"}</label><input type="date" value={trDate} onChange={e=>setTrDate(e.target.value)} className={inputClass}/></div><div className="col-span-2"><label className="text-xs text-muted-foreground">{locale==="zh"?"产权证号":"Titre"}</label><input type="text" value={trCertNo} onChange={e=>setTrCertNo(e.target.value)} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handleTransfer} disabled={saving}>{saving?"...":locale==="zh"?"保存":"OK"}</Button><Button size="sm" variant="ghost" onClick={()=>{setTrDate("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>)}
        </div></div></>)}
    </div>
  );
}
