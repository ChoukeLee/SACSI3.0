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
import { DateInput } from "@/components/ui/date-input";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, SegmentedControl, controlClass } from "@/components/ui/operational";
import type { SaleContractRow, SalePaymentScheduleRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";
import { createSaleContract, recordSalePayment, addFlexibleInstallment, updateTransferStatus, terminateSaleContract } from "./actions";

interface SaleListProps { contracts: SaleContractRow[]; schedules: SalePaymentScheduleRow[]; units: UnitRow[]; customers: CustomerRow[]; payments: PaymentRow[]; receivables: ReceivableRow[]; buildings: { id: string; code: string; display_name: string }[]; locale: Locale }
type PanelType = "new" | "detail" | "insight" | null;
type SaleStatKey = "active" | "total" | "received" | "receivable" | "overdue" | "transfer";

export function SaleList({ contracts, schedules, units, customers, payments, receivables, buildings, locale }: SaleListProps) {
  const t = dictionaries[locale].sales;
  const [statusFilter, setStatusFilter] = useState("all");
  const [statFilter, setStatFilter] = useState<SaleStatKey | null>(null);
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

  // Building switcher
  const [activeBuildingId, setActiveBuildingId] = useState<string>(() => (
    buildings.find((building) => building.code === "SACSI11")?.id ?? buildings[0]?.id ?? ""
  ));

  const unitBuildingMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.building_id);
    return m;
  }, [units]);

  const filteredByBuilding = useMemo(() => {
    if (!activeBuildingId) return contracts;
    return contracts.filter((c) => unitBuildingMap.get(c.unit_id) === activeBuildingId);
  }, [contracts, activeBuildingId, unitBuildingMap]);

  const filtered = useMemo(() => statusFilter==="all"?filteredByBuilding:filteredByBuilding.filter(c=>c.status===statusFilter), [filteredByBuilding,statusFilter]);
  const unitMap = useMemo(()=>new Map(units.map(u=>[u.id,u])), [units]);
  const customerMap = useMemo(()=>new Map(customers.map(c=>[c.id,c])), [customers]);

  const groupedContracts = useMemo(() => {
    const g=new Map<string,SaleContractRow[]>();
    for(const c of filtered){const unit=unitMap.get(c.unit_id);const floor=normalizeFloorLabel(unit?.floor_label??null,unit?.unit_no??"");if(!g.has(floor))g.set(floor,[]);g.get(floor)!.push(c);}
    return Array.from(g.entries())
      .map(([floor, floorContracts]) => [
        floor,
        [...floorContracts].sort((a,b)=>{
          const aUnit=unitMap.get(a.unit_id)?.unit_no??"";
          const bUnit=unitMap.get(b.unit_id)?.unit_no??"";
          return aUnit.localeCompare(bUnit, undefined, { numeric: true });
        }),
      ] as [string, SaleContractRow[]])
      .sort((a,b)=>floorSortValue(a[0])-floorSortValue(b[0]));
  }, [filtered,unitMap]);

  const selected = selectedId?contracts.find(c=>c.id===selectedId):null;
  const selectedUnit = selected?units.find(u=>u.id===selected.unit_id):null;
  const selectedCustomer = selected?customers.find(c=>c.id===selected.customer_id):null;

  const dashboardStats = useMemo(()=>{
    const buildingContractIds=new Set(filteredByBuilding.map(c=>c.id));
    const active=filteredByBuilding.filter(c=>c.status==="active");
    const activeIds=new Set(active.map(c=>c.id));
    const paidByContract=new Map<string,number>();
    const receivablePaidByContract=new Map<string,number>();
    let overdue=0;
    const today=new Date().toISOString().slice(0,10);
    for(const p of payments){
      if(!p.source_id||!activeIds.has(p.source_id)||!["sale","sale_contract","property_fee"].includes(p.source_type))continue;
      paidByContract.set(p.source_id,(paidByContract.get(p.source_id)??0)+Number(p.amount));
    }
    for(const r of receivables){
      if(r.source_type!=="sale_contract"||r.status==="cancelled"||!r.source_id||!buildingContractIds.has(r.source_id))continue;
      receivablePaidByContract.set(r.source_id,(receivablePaidByContract.get(r.source_id)??0)+Number(r.paid_amount_xof));
      const os=Number(r.amount_xof)-Number(r.paid_amount_xof);
      if(os>0&&(r.status==="overdue"||r.due_date<today))overdue+=os;
    }
    const total=active.reduce((s,c)=>s+Number(c.total_amount_xof),0);
    const received=active.reduce((sum,c)=>sum+Math.max(paidByContract.get(c.id)??0,receivablePaidByContract.get(c.id)??0),0);
    return {active:active.length,total,received,outstanding:Math.max(0,total-received),overdue,transferDone:active.filter(c=>c.transfer_status==="completed").length};
  }, [filteredByBuilding,payments,receivables]);

  const saleInsightContracts = useMemo(() => {
    const today = new Date().toISOString().slice(0,10);
    return filteredByBuilding
      .map((contract) => {
        const unit = unitMap.get(contract.unit_id);
        const customer = customerMap.get(contract.customer_id);
        const related = receivables.filter((r) => r.source_type === "sale_contract" && r.source_id === contract.id && r.status !== "cancelled");
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
        return {
          contract,
          unit,
          customer,
          summary: { total, paid, outstanding: Math.max(0, total - paid), overdue, nextDue, count: related.length },
        };
      })
      .filter((row) => row.unit)
      .sort((a, b) => (a.unit?.unit_no ?? "").localeCompare(b.unit?.unit_no ?? "", undefined, { numeric: true }));
  }, [customerMap, filteredByBuilding, receivables, unitMap]);

  const contractSchedules = useMemo(()=>selectedId?schedules.filter(s=>s.sale_contract_id===selectedId).sort((a,b)=>a.installment_no-b.installment_no):[], [schedules,selectedId]);
  const contractReceivables = useMemo(()=>selectedId?receivables.filter(r=>r.source_type==="sale_contract"&&r.source_id===selectedId&&r.status!=="cancelled"):[], [receivables,selectedId]);
  const contractPayments = useMemo(()=>selectedId?payments.filter(p=>p.source_id===selectedId):[], [payments,selectedId]);
  const totalPaidRec = useMemo(()=>contractReceivables.reduce((s,r)=>s+Number(r.paid_amount_xof),0),[contractReceivables]);
  const totalRec = useMemo(()=>contractReceivables.reduce((s,r)=>s+Number(r.amount_xof),0),[contractReceivables]);
  const totalOverdueRec = useMemo(()=>{let o=0;const today=new Date().toISOString().slice(0,10);for(const r of contractReceivables){const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<today))o+=os;}return o;},[contractReceivables]);
  const totalPaidPayments = contractPayments
    .filter(p=>["sale","sale_contract","property_fee"].includes(p.source_type))
    .reduce((s,p)=>s+Number(p.amount),0);
  const explicitFinancialExpense = contractPayments
    .filter(p=>p.source_type==="sale_agency_expense")
    .reduce((s,p)=>s+Number(p.amount),0);
  const legacyFinancialExpense = explicitFinancialExpense>0
    ? 0
    : selected?.agency_commission_paid
      ? Number(selected.agency_commission_amount_xof ?? 0)
      : 0;
  const saleFinancialIncome = contractPayments
    .filter(p=>p.source_type!=="sale_agency_expense")
    .reduce((s,p)=>s+Number(p.amount),0);
  const saleFinancialExpense = explicitFinancialExpense+legacyFinancialExpense;
  const saleFinancialNet = saleFinancialIncome - saleFinancialExpense;
  const saleContractReceived = Math.max(totalPaidRec, totalPaidPayments);
  const selectedContractTotal = Number(selected?.total_amount_xof ?? 0);
  const selectedOutstanding = Math.max(0, (totalRec > 0 ? totalRec : selectedContractTotal) - saleContractReceived);

  const getContractSummary = (cid: string) => {const rr=receivables.filter(r=>r.source_type==="sale_contract"&&r.source_id===cid&&r.status!=="cancelled");let t=0,p=0,o=0;const today=new Date().toISOString().slice(0,10);for(const r of rr){t+=Number(r.amount_xof);p+=Number(r.paid_amount_xof);const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<today))o+=os;}return {total:t,paid:p,outstanding:t-p,overdue:o};};

  const getSchedStatus = (s: SalePaymentScheduleRow, rr: ReceivableRow[]) => {const rec=rr.find(r=>r.due_date===s.due_date&&Math.abs(Number(r.amount_xof)-Number(s.amount_xof))<1);if(!rec||rec.status==="cancelled")return s.status;return rec.status==="paid"?"paid":Number(rec.paid_amount_xof)>0&&Number(rec.paid_amount_xof)<Number(rec.amount_xof)?"partial":rec.status==="overdue"?"overdue":s.status==="paid"?"paid":"pending";};

  const openNew = () => {setPanel("new");setSelectedId(null);setError("");};
  const openDetail = (id:string) => {setSelectedId(id);setPanel("detail");setError("");};
  const openInsight = (key: SaleStatKey) => {setStatFilter(key);setPanel("insight");setSelectedId(null);setError("");};

  const handleCreate = async () => {if(!fUnitId||!fCustomerId||!fSignedDate||fTotalAmount<=0){setError(locale==="zh"?"请填写必填字段":"Champs obligatoires");return;}setSaving(true);setError("");setPanel(null);const r=await createSaleContract({unitId:fUnitId,customerId:fCustomerId,contractNo:fContractNo||"",signedDate:fSignedDate,totalAmountXof:fTotalAmount,paymentPlanType:fPlanType,numInstallments:fPlanType==="fixed_installment"?fNumInstallments:undefined,agencyCompany:fAgency||undefined,agentName:fAgent||undefined,agencyCommissionXof:fCommission,agencyCommissionPaid:fCommissionPaid});setSaving(false);if(!r.success){setPanel("new");setError(r.error??"Failed");}};
  const handlePay = async () => {if(!payScheduleId||payAmount<=0){setError(locale==="zh"?"请选择分期并输入金额":"Champs obligatoires");return;}const currentScheduleId=payScheduleId;setSaving(true);setError("");setPayScheduleId("");const r=await recordSalePayment({contractId:selectedId!,scheduleId:currentScheduleId,amount:payAmount,paymentDate:payDate,receiptNo:payReceiptNo||undefined});setSaving(false);if(r.success){setPayAmount(0);setPayReceiptNo("");}else {setPayScheduleId(currentScheduleId);setError(r.error??"Failed");}};
  const handleAddFlex = async () => {if(!flexDueDate||flexAmount<=0){setError(locale==="zh"?"请填写到期日和金额":"Champs obligatoires");return;}setSaving(true);setError("");setShowFlexForm(false);const r=await addFlexibleInstallment({contractId:selectedId!,installmentNo:contractSchedules.length+1,dueDate:flexDueDate,amountXof:flexAmount});setSaving(false);if(r.success){setFlexDueDate("");setFlexAmount(0);}else {setShowFlexForm(true);setError(r.error??"Failed");}};
  const handleTransfer = async () => {if(!trDate){setError(locale==="zh"?"请选择过户日期":"Champs obligatoires");return;}const currentId=selectedId!;setSaving(true);setError("");setPanel(null);const r=await updateTransferStatus(currentId,trStatus,trDate,trCertNo||undefined);setSaving(false);if(!r.success){setSelectedId(currentId);setPanel("detail");setError(r.error??"Failed");}};
  const handleTerminateSale = async () => {const currentId=selectedId!;setSaving(true);setError("");setPanel(null);const r=await terminateSaleContract(currentId,termReason||(locale==="zh"?"手动终止":"Manuel"));setSaving(false);if(!r.success){setSelectedId(currentId);setPanel("detail");setError(r.error??"Failed");}};

  const inputClass="w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-border-strong outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60";
  const labelClass="block text-xs font-semibold text-muted-foreground mb-1";
  const schedLabel = (s: string) => { const l: Record<string,string>=locale==="zh"?{pending:"待付",paid:"已付",overdue:"逾期",cancelled:"取消"}:{pending:"Attente",paid:"Paye",overdue:"Retard",cancelled:"Annule"}; return l[s]??s; };
  const transText = (s:string)=>locale==="zh"?{not_started:"未开始",in_progress:"办理中",completed:"已完成"}[s]??s:{not_started:"Non debute",in_progress:"En cours",completed:"Termine"}[s]??s;
  const salePaymentKindLabel = (payment: PaymentRow) => {
    if (payment.source_type === "sale_registration_fee") return locale === "zh" ? "注册金收入" : "Frais d'inscription";
    if (payment.source_type === "sale_agency_income") return locale === "zh" ? "中介费收入" : "Commission reçue";
    if (payment.source_type === "sale_agency_expense") {
      const txt = `${payment.notes ?? ""} ${payment.receipt_no ?? ""}`;
      if (txt.includes("退款") || txt.includes("REFUND")) return locale === "zh" ? "合同退款" : "Remboursement";
      return locale === "zh" ? "中介费支出" : "Commission versée";
    }
    if (payment.source_type === "property_fee") return locale === "zh" ? "物业费收入" : "Frais de copropriété";
    const text = `${payment.notes ?? ""} ${payment.receipt_no ?? ""}`;
    if (text.includes("车位")) return locale === "zh" ? "车位款收入" : "Paiement parking";
    if (text.includes("注册金")) return locale === "zh" ? "注册金收入" : "Frais d'inscription";
    if (text.includes("定金")) return locale === "zh" ? "定金收入" : "Acompte";
    return locale === "zh" ? "房款收入" : "Paiement du bien";
  };

  const sellableUnits = useMemo(()=>units.filter(u=>(u.kind==="apartment"||u.kind==="parking")&&(u.status==="available"||u.status==="sold")),[units]);
  const getSaleDataFlags = (contract: SaleContractRow, customer?: CustomerRow | null) => ({
    needsData: contract.payment_plan_type === "legacy_pending"
      || Number(contract.total_amount_xof) <= 0
      || customer?.name.includes("资料待补")
      || customer?.notes?.includes("legacy_placeholder=true"),
    needsNumberCleanup: contract.contract_no.startsWith("LEGACY-SALE-"),
  });

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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
      aria-label={label} title={label}>
      <Icon className="h-[14px] w-[14px]" strokeWidth={1.5} />
    </button>
  )
}

  const statBlocks: Array<{ key: SaleStatKey; label: string; value: string; dot: string; hint: string }> = [
    { key: "active", label: locale==="zh"?"生效出售":"Ventes actives", value: String(dashboardStats.active), dot: "bg-accentGreen-500", hint: locale==="zh"?"打开生效出售侧栏":"Ouvrir les ventes actives" },
    { key: "total", label: locale==="zh"?"合同总额":"Total contrats", value: formatXof(dashboardStats.total), dot: "bg-accentBlue-500", hint: locale==="zh"?"打开合同总额明细":"Ouvrir le detail des contrats" },
    { key: "received", label: locale==="zh"?"已回款":"Recu", value: formatXof(dashboardStats.received), dot: "bg-accentGreen-500", hint: locale==="zh"?"打开已回款明细":"Ouvrir les encaissements" },
    { key: "receivable", label: locale==="zh"?"待回款":"A recevoir", value: formatXof(dashboardStats.outstanding), dot: "bg-accentAmber-500", hint: locale==="zh"?"打开待回款侧栏":"Ouvrir les montants a recevoir" },
    { key: "overdue", label: locale==="zh"?"逾期回款":"Retard", value: formatXof(dashboardStats.overdue), dot: dashboardStats.overdue > 0 ? "bg-accentRed-500" : "bg-muted-foreground/40", hint: locale==="zh"?"打开逾期回款侧栏":"Ouvrir les retards" },
    { key: "transfer", label: locale==="zh"?"已过户":"Transfert", value: String(dashboardStats.transferDone), dot: "bg-accentPurple-500", hint: locale==="zh"?"打开过户明细":"Ouvrir les transferts" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page chrome ── */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          {locale === "zh" ? "出售业务" : "Ventes"}
        </p>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {locale === "zh" ? "出售合同" : "Contrats de vente"}
          </h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {filteredByBuilding.length} {locale==="fr"?"contrats":"份合同"}
          </span>
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {statBlocks.map(b => (
          <button
            key={b.key}
            type="button"
            onClick={() => openInsight(b.key)}
            aria-pressed={panel === "insight" && statFilter === b.key}
            title={b.hint}
            className={cn(
              "flex min-h-[76px] flex-col rounded-xl border bg-card p-3 text-left text-card-foreground shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60",
              panel === "insight" && statFilter === b.key ? "border-foreground/20 ring-1 ring-foreground/10" : "border-border",
            )}
          >
            <div className="flex min-w-0 items-center justify-between gap-3 pb-2">
              <p className="min-w-0 truncate text-sm font-medium leading-tight tracking-tight text-foreground">{b.label}</p>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", b.dot)} />
            </div>
            <p className="text-lg font-semibold leading-none tabular-nums text-foreground">{b.value}</p>
            <span className={cn("mt-2 text-[11px] font-medium", panel === "insight" && statFilter === b.key ? "text-foreground" : "text-muted-foreground")}>
              {panel === "insight" && statFilter === b.key ? (locale === "zh" ? "已打开" : "Ouvert") : b.hint}
            </span>
          </button>
        ))}
      </div>

      {/* ── Building switcher ── */}
      {buildings.length > 1 && (
        <SegmentedControl
          value={activeBuildingId}
          onChange={setActiveBuildingId}
          ariaLabel={locale === "zh" ? "楼栋切换" : "Selection du batiment"}
          className="self-start"
          items={buildings.map((b) => ({
            value: b.id,
            label: b.display_name || b.code,
          }))}
        />
      )}

      {/* ── Filter bar ── */}
      <FilterBar
        meta={
          <div className="flex items-center gap-3">
            <span>{filtered.length}/{filteredByBuilding.length} {locale === "fr" ? "contrats" : "份合同"}</span>
            <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" />{t.form.newContract}</Button>
          </div>
        }
      >
        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel={locale === "zh" ? "合同状态筛选" : "Filtre statut contrat"}
          items={["all", "draft", "active", "terminated", "expired"].map((value) => ({
            value,
            label: value === "all" ? (locale === "fr" ? "Tous" : "全部") : t.contractStatus[value as keyof typeof t.contractStatus],
          }))}
        />
      </FilterBar>

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
              {fc.map(contract=>{const unit=unitMap.get(contract.unit_id);const customer=customerMap.get(contract.customer_id);const s=getContractSummary(contract.id);const isRisk=s.overdue>0||(contract.status==="active"&&contract.transfer_status!=="completed");const dataFlags=getSaleDataFlags(contract,customer);return(<RoomCard key={contract.id} roomNo={unit?.unit_no??"-"} status="sold" statusLabel={t.contractStatus[contract.status as keyof typeof t.contractStatus]} onClick={()=>openDetail(contract.id)} className={isRisk?"border-amber-200 shadow-[0_10px_24px_rgba(180,120,24,0.14)]":""}>
                {/* Name + status badge */}
                <div className="flex min-h-[52px] items-start justify-between gap-1.5">
                  <p className="text-[13px] font-medium leading-tight truncate" title={customer?.name??""}>{customer?.name??"-"}</p>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {dataFlags.needsData && <Badge variant="warning" className="text-[10px]">{locale==="zh"?"资料待补":"A compléter"}</Badge>}
                    {!dataFlags.needsData && dataFlags.needsNumberCleanup && <Badge variant="info" className="text-[10px]">{locale==="zh"?"编号待整理":"N° à vérifier"}</Badge>}
                    <Badge variant={statusVariant[contract.status]} className="text-[10px]">{t.contractStatus[contract.status as keyof typeof t.contractStatus]}</Badge>
                  </div>
                </div>
                {/* Compact info row */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#5D7186]">
                  <span title={contract.contract_no} className="truncate max-w-[90px]">{contract.contract_no}</span>
                  <span>·</span>
                  <span className="tabular-nums">{Number(contract.total_amount_xof)>0?formatXof(Number(contract.total_amount_xof)):(locale==="zh"?"金额待补":"Montant à compléter")}</span>
                  {s.outstanding>0 && <span className="text-amber-600 font-medium">{formatXof(s.outstanding)} {locale==="zh"?"待收":"dû"}</span>}
                </div>
                {/* Transfer status + action buttons */}
                <div className="mt-auto flex items-center justify-between gap-4 border-t border-[rgba(23,50,77,0.06)] pt-3">
                  <span className={cn("text-[11px]", contract.transfer_status==="completed"?"text-emerald-600":"text-[#5D7186]")}>{transText(contract.transfer_status)}</span>
                  <div className="flex justify-center gap-5">
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

      {/* ── KPI insight panel ── */}
      {panel === "insight" && statFilter && (() => {
        const titleMap: Record<SaleStatKey, string> = {
          active: locale === "zh" ? "生效出售明细" : "Ventes actives",
          total: locale === "zh" ? "合同总额明细" : "Total des contrats",
          received: locale === "zh" ? "已回款明细" : "Encaissements",
          receivable: locale === "zh" ? "待回款明细" : "Montants a recevoir",
          overdue: locale === "zh" ? "逾期回款明细" : "Retards de paiement",
          transfer: locale === "zh" ? "已过户明细" : "Transferts completes",
        };
        const activeRows = saleInsightContracts.filter((row) => row.contract.status === "active");
        const insightRows = statFilter === "active"
          ? activeRows
          : statFilter === "total"
            ? [...activeRows].sort((a, b) => Number(b.contract.total_amount_xof) - Number(a.contract.total_amount_xof))
            : statFilter === "received"
              ? saleInsightContracts.filter((row) => row.summary.paid > 0).sort((a, b) => b.summary.paid - a.summary.paid)
              : statFilter === "receivable"
                ? saleInsightContracts.filter((row) => row.summary.outstanding > 0).sort((a, b) => (a.summary.nextDue ?? "9999-12-31").localeCompare(b.summary.nextDue ?? "9999-12-31"))
                : statFilter === "overdue"
                  ? saleInsightContracts.filter((row) => row.summary.overdue > 0).sort((a, b) => b.summary.overdue - a.summary.overdue)
                  : activeRows.filter((row) => row.contract.transfer_status === "completed");
        const metricValue = statFilter === "active" || statFilter === "transfer"
          ? String(insightRows.length)
          : formatXof(insightRows.reduce((sum, row) => {
              if (statFilter === "total") return sum + Number(row.contract.total_amount_xof);
              if (statFilter === "received") return sum + row.summary.paid;
              if (statFilter === "overdue") return sum + row.summary.overdue;
              return sum + row.summary.outstanding;
            }, 0));
        const valueForRow = (row: typeof insightRows[number]) => {
          if (statFilter === "received") return row.summary.paid;
          if (statFilter === "overdue") return row.summary.overdue;
          if (statFilter === "receivable") return row.summary.outstanding;
          return Number(row.contract.total_amount_xof);
        };
        const badgeVariant = statFilter === "overdue" ? "destructive" : statFilter === "receivable" ? "warning" : statFilter === "transfer" ? "secondary" : "success";

        return (
          <SalePanelShell
            onClose={() => setPanel(null)}
            title={titleMap[statFilter]}
            badge={<Badge variant={badgeVariant}>{insightRows.length}</Badge>}
          >
            <div className="space-y-4">
              <div className={cn(
                "rounded-xl border p-3",
                statFilter === "overdue" ? "border-red-200 bg-red-50/50" :
                statFilter === "receivable" ? "border-amber-200 bg-amber-50/50" :
                "border-border bg-muted/35"
              )}>
                <p className="text-xs text-muted-foreground">{locale === "zh" ? "当前楼栋合计" : "Total du batiment"}</p>
                <p className={cn(
                  "mt-1 text-xl font-semibold tabular-nums",
                  statFilter === "overdue" ? "text-red-700" : statFilter === "receivable" ? "text-amber-700" : "text-foreground"
                )}>{metricValue}</p>
              </div>
              {insightRows.length === 0 ? (
                <EmptyState title={locale === "zh" ? "当前没有对应合同" : "Aucun contrat correspondant"} />
              ) : (
                <div className="space-y-2.5">
                  {insightRows.map((row) => (
                    <div key={row.contract.id} className="rounded-xl border border-border bg-card p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{row.unit?.unit_no ?? "-"} · {row.customer?.name ?? (locale === "zh" ? "客户待补" : "Client a completer")}</span>
                            <Badge variant={row.contract.transfer_status === "completed" ? "success" : "secondary"} className="h-5 px-2 text-[10px]">
                              {transText(row.contract.transfer_status)}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{row.contract.contract_no}</p>
                        </div>
                        <p className={cn(
                          "shrink-0 text-sm font-semibold tabular-nums",
                          statFilter === "overdue" ? "text-red-700" : statFilter === "receivable" ? "text-amber-700" : statFilter === "received" ? "text-emerald-700" : "text-foreground"
                        )}>{formatXof(valueForRow(row))}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                        <span>{locale === "zh" ? "签约" : "Signe"} {row.contract.signed_date}</span>
                        <span className="text-right">{locale === "zh" ? "总额" : "Total"} {formatXof(Number(row.contract.total_amount_xof))}</span>
                        <span>{locale === "zh" ? "已回款" : "Recu"} {formatXof(row.summary.paid)}</span>
                        <span className="text-right">{locale === "zh" ? "待回款" : "Reste"} {formatXof(row.summary.outstanding)}</span>
                        {row.summary.nextDue && <span className="col-span-2">{locale === "zh" ? "最近应收" : "Prochaine echeance"} {row.summary.nextDue}</span>}
                      </div>
                      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => openDetail(row.contract.id)}>
                        {locale === "zh" ? "查看合同" : "Voir le contrat"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SalePanelShell>
        );
      })()}

      {/* ── New Contract Panel ── */}
      {panel==="new"&&(<><div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={()=>setPanel(null)}/><div className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-full overflow-auto border-l border-border bg-card shadow-panel lg:max-w-[480px]"><div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur"><h3 className="text-[15px] font-semibold">{t.form.newContract}</h3><button onClick={()=>setPanel(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"><X className="h-4 w-4"/></button></div>
        <div className="space-y-4 px-5 py-5"><div><label className={labelClass}>{t.form.contractNo}</label><input type="text" value={fContractNo} onChange={e=>setFContractNo(e.target.value)} className={inputClass}/></div><div><label className={labelClass}>{t.form.unit} *</label><select value={fUnitId} onChange={e=>setFUnitId(e.target.value)} className={inputClass}><option value="">{t.form.noUnit}</option>{sellableUnits.map(u=><option key={u.id} value={u.id}>{u.unit_no} ({u.floor_label})</option>)}</select></div><div><label className={labelClass}>{t.form.customer} *</label><select value={fCustomerId} onChange={e=>setFCustomerId(e.target.value)} className={inputClass}><option value="">{t.form.noCustomer}</option>{customers.filter(cc=>!cc.is_blacklisted).map(cc=><option key={cc.id} value={cc.id}>{cc.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t.form.signedDate}</label><DateInput value={fSignedDate} onChangeValue={setFSignedDate} className={inputClass}/></div><div><label className={labelClass}>{t.form.totalAmount} *</label><input type="number" value={fTotalAmount} onChange={e=>setFTotalAmount(Number(e.target.value))} className={inputClass}/></div></div>
          <div><label className={labelClass}>{locale==="zh"?"付款计划":"Plan"}</label><select value={fPlanType} onChange={e=>setFPlanType(e.target.value)} className={inputClass}><option value="lump_sum">{t.paymentPlan.lump_sum}</option><option value="fixed_installment">{t.paymentPlan.fixed_installment}</option><option value="flexible_installment">{t.paymentPlan.flexible_installment}</option></select></div>
          {fPlanType==="fixed_installment"&&<div><label className={labelClass}>{locale==="zh"?"分期数":"Nb echeances"}</label><input type="number" min={2} max={24} value={fNumInstallments} onChange={e=>setFNumInstallments(Number(e.target.value))} className={inputClass}/></div>}
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{locale==="zh"?"中介公司":"Agence"}</label><input type="text" value={fAgency} onChange={e=>setFAgency(e.target.value)} className={inputClass}/></div><div><label className={labelClass}>{locale==="zh"?"中介":"Agent"}</label><input type="text" value={fAgent} onChange={e=>setFAgent(e.target.value)} className={inputClass}/></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{locale==="zh"?"佣金":"Commission"}</label><input type="number" value={fCommission} onChange={e=>setFCommission(Number(e.target.value))} className={inputClass}/></div><label className="flex items-center gap-2 text-sm pt-6"><input type="checkbox" checked={fCommissionPaid} onChange={e=>setFCommissionPaid(e.target.checked)}/>{locale==="zh"?"佣金已付":"Com. payee"}</label></div>
          {error&&<p className="text-sm text-red-600">{error}</p>}<Button className="w-full" onClick={handleCreate} disabled={saving}>{saving?"...":t.form.newContract}</Button></div></div></>)}

      {/* ── Detail Panel ── */}
      {panel==="detail"&&selected&&(<><div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={()=>setPanel(null)}/><div className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-full overflow-auto border-l border-border bg-card shadow-panel lg:max-w-[480px]"><div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur"><div><h3 className="text-[15px] font-semibold">{selected.contract_no}</h3><Badge variant={statusVariant[selected.status]}>{t.contractStatus[selected.status as keyof typeof t.contractStatus]}</Badge></div><button onClick={()=>setPanel(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"><X className="h-4 w-4"/></button></div>
        <div className="space-y-4 px-5 py-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-xs text-muted-foreground">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no??"-"} ({selectedUnit?.floor_label??""})</dd></div><div><dt className="text-xs text-muted-foreground">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name??"-"}</dd></div><div><dt className="text-xs text-muted-foreground">{t.form.signedDate}</dt><dd>{selected.signed_date}</dd></div><div><dt className="text-xs text-muted-foreground">{t.form.totalAmount}</dt><dd className="font-semibold">{formatXof(Number(selected.total_amount_xof))}</dd></div><div><dt className="text-xs text-muted-foreground">{locale==="zh"?"过户状态":"Transfert"}</dt><dd className={cn("font-medium",selected.transfer_status==="completed"?"text-emerald-600":"")}>{transText(selected.transfer_status)}</dd></div></dl>

          <div className="border-t pt-4">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold"><AlertTriangle className="h-3.5 w-3.5 text-amber-500"/>{locale==="zh"?"合同概览":"Aperçu du contrat"}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2">
                <p className="text-muted-foreground">{locale==="zh"?"合同总额":"Total contrat"}</p>
                <p className="font-semibold tabular-nums text-blue-700">{formatXof(selectedContractTotal)}</p>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2">
                <p className="text-muted-foreground">{locale==="zh"?"累计已收":"Total reçu"}</p>
                <p className="font-semibold tabular-nums text-emerald-700">{formatXof(saleContractReceived)}</p>
              </div>
              <div className={cn("rounded-md border px-3 py-2",selectedOutstanding>0?"border-amber-200 bg-amber-50/50":"border-emerald-200 bg-emerald-50/50")}>
                <p className="text-muted-foreground">{locale==="zh"?"待回款":"Reste à recevoir"}</p>
                <p className={cn("font-semibold tabular-nums",selectedOutstanding>0?"text-amber-700":"text-emerald-700")}>{formatXof(selectedOutstanding)}</p>
              </div>
              <div className={cn("rounded-md border px-3 py-2",totalOverdueRec>0?"border-red-200 bg-red-50/50":"border-emerald-200 bg-emerald-50/50")}>
                <p className="text-muted-foreground">{locale==="zh"?"逾期回款":"Retard"}</p>
                <p className={cn("font-semibold tabular-nums",totalOverdueRec>0?"text-red-700":"text-emerald-700")}>{formatXof(totalOverdueRec)}</p>
              </div>
            </div>
          </div>

          {selected.status==="active"&&<div className="grid grid-cols-2 gap-2"><Button size="sm" onClick={()=>{setPayScheduleId(contractSchedules.find(s=>s.status!=="paid")?.id??"");setPayAmount(0);}}><DollarSign className="h-4 w-4"/>{locale==="zh"?"收款":"Paiement"}</Button><Button size="sm" variant="outline" onClick={()=>{setShowFlexForm(true);setFlexDueDate("");setFlexAmount(0);setError("");}}><CalendarPlus className="h-4 w-4"/>{locale==="zh"?"新增分期":"+Echeance"}</Button><Button size="sm" variant="outline" onClick={()=>{setTrDate(new Date().toISOString().slice(0,10));setTrStatus(selected.transfer_status);}}><TrendingUp className="h-4 w-4"/>{locale==="zh"?"过户":"Transfert"}</Button><Button size="sm" variant="ghost" onClick={handleTerminateSale}><AlertTriangle className="h-4 w-4"/>{locale==="zh"?"终止":"Resilier"}</Button></div>}

          <div className="border-t pt-4">
            <div className="mb-2 space-y-1">
              <h4 className="text-sm font-semibold">{locale==="zh"?"财务记录":"Écritures financières"}</h4>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium tabular-nums">
                <span className="text-emerald-700">{locale==="zh"?"收入":"Revenus"} {formatXof(saleFinancialIncome)}</span>
                <span className="text-red-600">{locale==="zh"?"支出":"Dépenses"} {formatXof(saleFinancialExpense)}</span>
                <span className="text-slate-700">{locale==="zh"?"净额":"Net"} {formatXof(saleFinancialNet)}</span>
              </div>
            </div>
            {contractPayments.length===0&&saleFinancialExpense<=0?(
              <p className="text-xs text-muted-foreground">{locale==="zh"?"暂无逐笔财务记录":"Aucune écriture détaillée"}</p>
            ):(
              <div className="space-y-1.5">
                {contractPayments.map(payment=>{const isExpense=payment.source_type==="sale_agency_expense";return(
                  <div key={payment.id} className={cn("rounded-lg border px-3 py-2.5 text-[13px]",isExpense?"border-red-100 bg-red-50/50":"border-emerald-100 bg-emerald-50/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("font-semibold",isExpense?"text-red-700":"text-emerald-800")}>{salePaymentKindLabel(payment)}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{payment.payment_date}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={payment.receipt_no??payment.notes??""}>{payment.receipt_no||payment.notes||(locale==="zh"?"无业务编号":"Sans référence")}</p>
                      </div>
                      <span className={cn("shrink-0 font-semibold tabular-nums",isExpense?"text-red-600":"text-emerald-700")}>{isExpense?"- ":""}{formatXof(Number(payment.amount))}</span>
                    </div>
                  </div>
                )})}
                {legacyFinancialExpense>0&&(
                  <div className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2.5 text-[13px]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-semibold text-red-700">{locale==="zh"?"出售中介费支出":"Commission de vente"}</span>
                        <p className="mt-1 text-[11px] text-muted-foreground">{selected.agency_company||selected.agent_name||(locale==="zh"?"合同登记":"Contrat")}</p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums text-red-600">- {formatXof(legacyFinancialExpense)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Paid contracts already have definitive entries in financial records. */}
          {selectedOutstanding>0&&(<div className="border-t pt-4"><h4 className="mb-2 text-sm font-semibold">{locale==="zh"?"付款计划":"Plan de paiement"}</h4>
            {contractSchedules.length===0?<p className="text-xs text-muted-foreground">{locale==="zh"?"暂无付款计划":"Aucun plan"}</p>:<div className="space-y-1.5">{contractSchedules.map(s=>{const stat=getSchedStatus(s,contractReceivables);const recPaid=contractReceivables.find(r=>r.due_date===s.due_date&&Math.abs(Number(r.amount_xof)-Number(s.amount_xof))<1);const itemTitle=recPaid?.title?.replace(new RegExp(`^${selectedUnit?.unit_no??""}\\s*`),"").trim()||(selected?.payment_plan_type==="lump_sum"?(locale==="zh"?"一次性付款":"Paiement comptant"):(locale==="zh"?`第${s.installment_no}期`:`Échéance ${s.installment_no}`));return(<div key={s.id} className={cn("rounded-lg border bg-card px-3 py-2.5 text-[13px]",stat==="overdue"?"border-red-200":stat==="paid"?"border-emerald-200":"border-amber-200")}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{itemTitle}</span><Badge variant={stat==="paid"?"success":stat==="overdue"?"destructive":"warning"}>{schedLabel(stat)}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">{locale==="zh"?"约定付款日":"Date convenue"} {s.due_date}{recPaid&&Number(recPaid.paid_amount_xof)>0?` · ${locale==="zh"?"已收":"Reçu"} ${formatXof(Number(recPaid.paid_amount_xof))}`:""}</p></div><span className="shrink-0 font-semibold tabular-nums">{formatXof(Number(s.amount_xof))}</span></div></div>);})}</div>}
          </div>)}

          {/* Pay form */}
          {payScheduleId&&<div className="space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"选择分期":"Echeance"}</label><select value={payScheduleId} onChange={e=>{setPayScheduleId(e.target.value);if(!e.target.value){setPayAmount(0);return;}const s=contractSchedules.find(i=>i.id===e.target.value);if(s){const matchingRec=contractReceivables.find(r=>r.due_date===s.due_date&&Math.abs(Number(r.amount_xof)-Number(s.amount_xof))<1);const unpaid=matchingRec?Number(matchingRec.amount_xof)-Number(matchingRec.paid_amount_xof):Number(s.amount_xof);setPayAmount(unpaid);}}} className={inputClass}><option value="">-</option>{contractSchedules.filter(s=>s.status!=="paid").map(s=><option key={s.id} value={s.id}>#{s.installment_no} {s.due_date} {formatXof(Number(s.amount_xof))}</option>)}</select></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收款日期":"Date"}</label><DateInput value={payDate} onChangeValue={setPayDate} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"金额":"Montant"}</label><input type="number" value={payAmount} onChange={e=>setPayAmount(Number(e.target.value))} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收据号":"Recu"}</label><input type="text" value={payReceiptNo} onChange={e=>setPayReceiptNo(e.target.value)} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handlePay} disabled={saving}>{saving?"...":locale==="zh"?"确认收款":"Encaisser"}</Button><Button size="sm" variant="ghost" onClick={()=>{setPayScheduleId("");setError("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>}

          {/* Flex installment form */}
          {showFlexForm&&<div className="space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"到期日":"Echeance"}</label><DateInput value={flexDueDate} onChangeValue={setFlexDueDate} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"金额":"Montant"}</label><input type="number" value={flexAmount} onChange={e=>setFlexAmount(Number(e.target.value))} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handleAddFlex} disabled={saving}>{saving?"...":locale==="zh"?"新增":"Ajouter"}</Button><Button size="sm" variant="ghost" onClick={()=>{setShowFlexForm(false);setFlexDueDate("");setFlexAmount(0);setError("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>}

          {/* Transfer form */}
          {selected.status==="active"&&trDate&&(<div className="space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"过户状态":"Transfert"}</label><select value={trStatus} onChange={e=>setTrStatus(e.target.value)} className={inputClass}><option value="not_started">{transText("not_started")}</option><option value="in_progress">{transText("in_progress")}</option><option value="completed">{transText("completed")}</option></select></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"过户日期":"Date"}</label><DateInput value={trDate} onChangeValue={setTrDate} className={inputClass}/></div><div className="col-span-2"><label className="text-xs text-muted-foreground">{locale==="zh"?"产权证号":"Titre"}</label><input type="text" value={trCertNo} onChange={e=>setTrCertNo(e.target.value)} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handleTransfer} disabled={saving}>{saving?"...":locale==="zh"?"保存":"OK"}</Button><Button size="sm" variant="ghost" onClick={()=>{setTrDate("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>)}
        </div></div></>)}
    </div>
  );
}

function SalePanelShell({ onClose, title, badge, children }: { onClose:()=>void; title:string; badge?:React.ReactNode; children:React.ReactNode }) {
  return (<>
    <div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={onClose}/>
    <div className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-full overflow-auto border-l border-border bg-card shadow-panel lg:max-w-[480px]">
      <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-2"><h3 className="text-[15px] font-semibold">{title}</h3>{badge}</div>
        <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4"/></button>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  </>);
}
