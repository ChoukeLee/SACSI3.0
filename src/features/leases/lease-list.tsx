"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, AlertTriangle, FileText, DollarSign, LogOut, Printer, RefreshCw, Eye, CalendarClock, Phone, ChevronRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { RoomLegend } from "@/components/room-legend";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, SegmentedControl, controlClass } from "@/components/ui/operational";
import type { RoomVisualStatus } from "@/lib/status-styles";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import { contractStatusVariant as statusVariant, receivableStatusStyles as STATUS_STYLES, receivableRowBg as ROW_BG } from "@/lib/status-styles";
import { printLeaseContract } from "@/features/print";
import { createLeaseContract, activateContract, terminateContract, recordReceivablePayment, generateLeaseReceivables, processMoveOut } from "./actions";

interface UnitBusinessFlag {
  business_type: "daily_rental" | "long_lease" | "sale";
  is_enabled: boolean;
  default_price_xof: number | null;
}

type LeaseUnitRow = UnitRow & {
  unit_business_flags?: UnitBusinessFlag[];
};

interface LeaseListProps { contracts: LeaseContractRow[]; units: LeaseUnitRow[]; customers: CustomerRow[]; payments: PaymentRow[]; receivables: ReceivableRow[]; buildings: { id: string; code: string; display_name: string }[]; locale: Locale }
type PanelType = "new" | "detail" | "moveout" | "attention" | null;
type AttentionTab = "overdue" | "upcoming";
const paymentCycles = ["monthly", "quarterly", "semiannual", "annual"];

function addDaysToIso(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function diffIsoDays(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

function isManagedLeaseUnit(unit: LeaseUnitRow) {
  return unit.status === "sold" && unit.unit_business_flags?.some((flag) => flag.business_type === "long_lease" && flag.is_enabled);
}

function getLeaseDataFlags(contract: LeaseContractRow, customer?: CustomerRow | null) {
  return {
    needsData: Number(contract.monthly_rent_xof) <= 0
      || Number(contract.deposit_amount_xof) <= 0
      || contract.expected_end_date >= "2099-01-01"
      || customer?.name.includes("资料待补")
      || customer?.name.includes("待补充")
      || customer?.notes?.includes("legacy_placeholder=true"),
  };
}

function isContractEndConfirmed(contract: LeaseContractRow) {
  return contract.expected_end_confirmed !== false;
}

function isPaidThroughOverdue(contract: LeaseContractRow) {
  return !!contract.paid_through_date && contract.paid_through_date < new Date().toISOString().slice(0, 10);
}

export function LeaseList({ contracts, units, customers, payments, receivables, buildings, locale }: LeaseListProps) {
  const router = useRouter();
  const t = dictionaries[locale].leases;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [panel, setPanel] = useState<PanelType>(null);
  const [attentionTab, setAttentionTab] = useState<AttentionTab>("overdue");
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

  // Building switcher
  const [activeBuildingId, setActiveBuildingId] = useState<string>(() => (
    buildings.find((building) => building.code === "SACSI11")?.id ?? buildings[0]?.id ?? ""
  ));

  // Build unit -> building_id map
  const unitBuildingMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.building_id);
    return m;
  }, [units]);

  const filteredByBuilding = useMemo(() => {
    if (!activeBuildingId) return contracts;
    return contracts.filter((c) => unitBuildingMap.get(c.unit_id) === activeBuildingId);
  }, [contracts, activeBuildingId, unitBuildingMap]);

  const filtered = useMemo(() => statusFilter === "all" ? filteredByBuilding : filteredByBuilding.filter((c) => c.status === statusFilter), [filteredByBuilding, statusFilter]);
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const groupedContracts = useMemo(() => {
    const grouped = new Map<string, LeaseContractRow[]>();
    for (const contract of filtered) { const unit = unitMap.get(contract.unit_id); const floor = normalizeFloorLabel(unit?.floor_label ?? null, unit?.unit_no ?? ""); if (!grouped.has(floor)) grouped.set(floor, []); grouped.get(floor)!.push(contract); }
    return Array.from(grouped.entries())
      .map(([floor, floorContracts]) => [
        floor,
        [...floorContracts].sort((a, b) => {
          const aUnit = unitMap.get(a.unit_id)?.unit_no ?? "";
          const bUnit = unitMap.get(b.unit_id)?.unit_no ?? "";
          return aUnit.localeCompare(bUnit, undefined, { numeric: true });
        }),
      ] as [string, LeaseContractRow[]])
      .sort((a, b) => floorSortValue(a[0]) - floorSortValue(b[0]));
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

  const leaseAttention = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const upcomingLimit = addDaysToIso(today, 30);
    const buildingMap = new Map(buildings.map((building) => [building.id, building]));
    const rows = filteredByBuilding.flatMap((contract) => {
      if (contract.status !== "active") return [];
      const unit = unitMap.get(contract.unit_id);
      const customer = customerMap.get(contract.customer_id);
      if (!unit) return [];
      const related = receivables.filter((row) => row.source_type === "lease_contract" && row.source_id === contract.id && row.status !== "cancelled");
      let outstanding = 0;
      let overdueOutstanding = 0;
      let earliestOutstandingDue: string | null = null;
      for (const row of related) {
        const balance = Math.max(0, Number(row.amount_xof) - Number(row.paid_amount_xof));
        if (balance <= 0) continue;
        outstanding += balance;
        if (!earliestOutstandingDue || row.due_date < earliestOutstandingDue) earliestOutstandingDue = row.due_date;
        if (row.status === "overdue" || row.due_date < today) overdueOutstanding += balance;
      }
      const coverageDue = contract.paid_through_date ? addDaysToIso(contract.paid_through_date, 1) : null;
      const dueDate = earliestOutstandingDue ?? coverageDue;
      if (!dueDate) return [];
      const isOverdue = overdueOutstanding > 0 || dueDate < today;
      const isUpcoming = !isOverdue && dueDate <= upcomingLimit;
      if (!isOverdue && !isUpcoming) return [];
      const building = buildingMap.get(unit.building_id);
      return [{
        contract,
        unit,
        customer,
        buildingName: building?.display_name || building?.code || "-",
        dueDate,
        paidThrough: contract.paid_through_date,
        amount: outstanding > 0 ? outstanding : Number(contract.monthly_rent_xof),
        amountIsEstimated: outstanding <= 0,
        days: diffIsoDays(today, dueDate),
        kind: isOverdue ? "overdue" as const : "upcoming" as const,
      }];
    });
    return {
      overdue: rows.filter((row) => row.kind === "overdue").sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      upcoming: rows.filter((row) => row.kind === "upcoming").sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    };
  }, [buildings, customerMap, filteredByBuilding, receivables, unitMap]);

  const dashboardStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10); const active = filteredByBuilding.filter((c) => c.status === "active");
    const buildingContractIds = new Set(filteredByBuilding.map((contract) => contract.id));
    let due = 0, overdue = 0;
    for (const r of receivables) { if (r.source_type !== "lease_contract" || r.status === "cancelled" || !r.source_id || !buildingContractIds.has(r.source_id)) continue; const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof); if (outstanding <= 0) continue; due += outstanding; if (r.status === "overdue" || r.due_date < today) overdue += outstanding; }
    return { active: active.length, rent: active.reduce((sum, c) => sum + Number(c.monthly_rent_xof), 0), expiring: leaseAttention.upcoming.length, overdueContracts: leaseAttention.overdue.length, due, overdue };
  }, [filteredByBuilding, leaseAttention, receivables]);

  const contractReceivables = useMemo(() => selectedId ? receivables.filter(r => r.source_type === "lease_contract" && r.source_id === selectedId && r.status !== "cancelled") : [], [receivables, selectedId]);
  const contractPayments = useMemo(() => selectedId ? payments.filter((p) => p.source_id === selectedId) : [], [payments, selectedId]);
  const totalPaid = contractPayments.reduce((s, p) => s + Number(p.amount), 0);
  const receivableStats = useMemo(() => { let totalRec=0,totalPd=0,overdue=0; const today=new Date().toISOString().slice(0,10); for(const r of contractReceivables){totalRec+=Number(r.amount_xof);totalPd+=Number(r.paid_amount_xof);const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<today))overdue+=os;} return {totalReceivable:totalRec,totalPaid:totalPd,outstanding:totalRec-totalPd,overdue}; }, [contractReceivables]);
  const contractRisk = useMemo(() => { if(!selected||selected.status!=="active"||!isContractEndConfirmed(selected))return {expiringSoon:false,daysLeft:0}; const today=new Date(); const diff=Math.floor((new Date(selected.expected_end_date).getTime()-today.getTime())/86400000); return {expiringSoon:diff<=30&&diff>=0,daysLeft:Math.max(0,diff)}; }, [selected]);
  const availableUnits = useMemo(() => units.filter((u) => u.kind === "apartment" && (u.status === "available" || isManagedLeaseUnit(u))), [units]);

  const resetNewForm = () => { setFContractNo(""); setFUnitId(""); setFCustomerId(""); setFStartDate(""); setFEndDate(""); setFCycle("monthly"); setFPayDay(5); setFRent(0); setFDeposit(0); setFDepositReceived(false); setFFreeDays(0); setFSigner(""); setFStatus("draft"); setError(""); };
  const openNew = () => { resetNewForm(); setPanel("new"); setSelectedId(null); };
  const openDetail = (id: string) => { setSelectedId(id); setPanel("detail"); setError(""); };
  const openMoveOut = (id: string) => { setSelectedId(id); setPanel("moveout"); setError(""); const os = receivableStats.outstanding; setMoUnpaid(os > 0 ? os : 0); setMoEndDate(new Date().toISOString().slice(0,10)); };

  const handleCreate = async () => { /* ... all existing validation logic kept ... */
    if (!fUnitId || !fCustomerId || !fStartDate || !fEndDate) { setError(locale==="zh"?"请填写必填字段":"Champs obligatoires"); return; }
    setSaving(true); setError(""); setGenMsg(locale==="zh"?"正在后台新建合同":"Creation en arriere-plan"); setPanel(null);
    const result = await createLeaseContract({ unitId:fUnitId, customerId:fCustomerId, contractNo:fContractNo||"", startDate:fStartDate, expectedEndDate:fEndDate, paymentCycle:fCycle as never, paymentDay:fPayDay, monthlyRentXof:fRent, depositAmountXof:fDeposit, depositReceived:fDepositReceived, rentFreeDays:fFreeDays, signerName:fSigner||undefined, status:fStatus });
    setSaving(false); if(result.success) { resetNewForm(); setGenMsg(locale==="zh"?"合同已创建":"Contrat cree"); } else { setPanel("new"); setGenMsg(""); setError(result.error??"Failed"); }
  };
  const handleActivate = async (id: string) => { setSaving(true); setError(""); setGenMsg(locale==="zh"?"正在后台激活合同":"Activation en arriere-plan"); const result = await activateContract(id); setSaving(false); if(!result.success) { setGenMsg(""); setError(result.error??"Failed"); } else setGenMsg(locale==="zh"?"合同已激活，应收已自动生成":"Contrat active, echeances generees"); };
  const handleTerminate = async (id: string) => { setSaving(true); setError(""); setGenMsg(locale==="zh"?"正在后台终止合同":"Resiliation en arriere-plan"); const result = await terminateContract(id); setSaving(false); if(!result.success) { setGenMsg(""); setError(result.error??"Failed"); } else setGenMsg(locale==="zh"?"合同已终止":"Contrat resilie"); };
  const handleGenerateReceivables = async (id: string) => {
    setSaving(true);
    setGenMsg("");
    setError("");
    const result = await generateLeaseReceivables(id);
    setSaving(false);
    if (result.success) {
      router.refresh();
      if (result.count > 0) {
        setGenMsg(t.receivable.generated.replace("{count}", String(result.count)));
      } else if ((result.existingCount ?? 0) > 0) {
        setGenMsg(locale === "zh" ? `应收已存在 ${result.existingCount} 条，已刷新列表` : `${result.existingCount} créance(s) déjà existante(s), liste actualisée`);
      } else {
        setGenMsg(locale === "zh" ? "未生成新的应收，请检查合同日期和支付周期" : "Aucune nouvelle créance générée, vérifiez les dates et le cycle");
      }
    } else setError(result.error ?? "Failed");
  };
  const handleCollectReceivable = async () => { if(!payReceivableId)return; const currentReceivableId=payReceivableId; setSaving(true);setError("");setGenMsg(locale==="zh"?"正在后台记录收款":"Paiement en arriere-plan");setPayReceivableId(null);const result=await recordReceivablePayment({receivableId:currentReceivableId,paymentDate:payDate,receiptNo:payReceiptNo||undefined});setSaving(false);if(result.success){setPayReceiptNo("");setGenMsg(locale==="zh"?"收款已记录":"Paiement enregistre");}else {setPayReceivableId(currentReceivableId);setGenMsg("");setError(result.error??"Failed");}};
  const handleMoveOut = async () => { if(!selectedId)return;const currentId=selectedId;setSaving(true);setError("");setGenMsg(locale==="zh"?"正在后台办理退租":"Sortie en arriere-plan");setPanel(null);const result=await processMoveOut({contractId:currentId,actualEndDate:moEndDate,unpaidRentXof:moUnpaid,utilityCleared:moUtility,depositDeductionXof:moDeduction,depositRefundXof:moRefund});setSaving(false);if(result.success)setGenMsg(locale==="zh"?"退租已办理":"Sortie traitee");else {setPanel("moveout");setGenMsg("");setError(result.error??"Failed");}};

  const inputClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-border-strong outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";

  const statusLabel = (status: string) => { const labels: Record<string,string> = locale==="zh" ? {pending:"待收",partial:"部分",paid:"已收",overdue:"逾期",cancelled:"已取消"} : {pending:"Attente",partial:"Partiel",paid:"Paye",overdue:"Retard",cancelled:"Annule"}; return labels[status]??status; };
  const receivableKindLabel = (category: string | null | undefined) => {
    const labels: Record<string, string> = locale === "zh"
      ? { lease_rent: "租金", lease_deposit: "押金", other_income: "其他" }
      : { lease_rent: "Loyer", lease_deposit: "Depot", other_income: "Autre" };
    return labels[category ?? ""] ?? (locale === "zh" ? "应收" : "Du");
  };

  const openAttention = (tab: AttentionTab) => { setAttentionTab(tab); setPanel("attention"); setSelectedId(null); };
  const statBlocks = [
    { key: "active", label: locale==="zh"?"生效合同":"Actifs", value: String(dashboardStats.active), hint: null, dot: "bg-accentGreen-500", action: null },
    { key: "rent", label: locale==="zh"?"月租规模":"Loyer/mois", value: formatXof(dashboardStats.rent), hint: null, dot: "bg-accentBlue-500", action: null },
    { key: "expiring", label: locale==="zh"?"30天内应缴":"À payer sous 30j", value: String(dashboardStats.expiring), hint: locale==="zh"?"点击查看收费名单":"Voir la liste", dot: dashboardStats.expiring > 0 ? "bg-accentAmber-500" : "bg-muted-foreground/40", action: () => openAttention("upcoming") },
    { key: "due", label: locale==="zh"?"待收账款":"A recevoir", value: formatXof(dashboardStats.due), hint: null, dot: "bg-accentPurple-500", action: null },
    { key: "overdue", label: locale==="zh"?"逾期金额":"Retard", value: formatXof(dashboardStats.overdue), hint: `${dashboardStats.overdueContracts}${locale==="zh"?"份 · 点击查看":" · voir"}`, dot: dashboardStats.overdue > 0 ? "bg-accentRed-500" : "bg-muted-foreground/40", action: () => openAttention("overdue") },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page chrome ── */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          {locale === "zh" ? "长租业务" : "Baux"}
        </p>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {locale === "zh" ? "长租合同" : "Contrats de location"}
          </h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {filteredByBuilding.length} {locale==="fr"?"contrats":"份合同"}
          </span>
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {statBlocks.map(b => {
          const content = <>
            <div className="flex min-w-0 items-center justify-between gap-3 pb-2">
              <p className="min-w-0 truncate text-sm font-medium leading-tight tracking-tight text-foreground">{b.label}</p>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", b.dot)} />
            </div>
            <div className="flex items-end justify-between gap-2">
              <p className="text-lg font-semibold leading-none tabular-nums text-foreground">{b.value}</p>
              {b.hint && <span className="flex items-center text-[10px] font-medium text-muted-foreground">{b.hint}<ChevronRight className="ml-0.5 h-3 w-3" /></span>}
            </div>
          </>;
          const cardClass = "flex min-h-[76px] flex-col rounded-xl border border-border bg-card p-3 text-left text-card-foreground shadow-card transition-all duration-200";
          return b.action ? (
            <button key={b.key} type="button" onClick={b.action} className={cn(cardClass, "cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40")}>{content}</button>
          ) : <div key={b.key} className={cardClass}>{content}</div>;
        })}
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

      {/* ── Filter bar + new contract ── */}
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
      {groupedContracts.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        groupedContracts.map(([floor, floorContracts]) => (
          <RoomBoard
            key={floor}
            header={<>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <h3 className="text-sm font-semibold">{floor}</h3>
              </div>
              <span className="text-[12px] font-medium text-[#5D7186]">{floorContracts.length} {locale==="fr"?"contrats":"份合同"}</span>
            </>}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              {floorContracts.map((contract) => {
                const unit = unitMap.get(contract.unit_id);
                const customer = customerMap.get(contract.customer_id);
                const summary = getContractReceivableSummary(contract.id);
                const endConfirmed = isContractEndConfirmed(contract);
                const daysLeft = endConfirmed ? Math.floor((new Date(contract.expected_end_date).getTime() - Date.now()) / 86400000) : null;
                const isRisk = summary.overdue > 0 || (contract.status === "active" && daysLeft !== null && daysLeft >= 0 && daysLeft <= 30);
                const isLongTerm = endConfirmed && contract.expected_end_date >= "2099-01-01";
                const rent = Number(contract.monthly_rent_xof);
                const isManaged = unit ? isManagedLeaseUnit(unit) : false;
                const dataFlags = getLeaseDataFlags(contract, customer);
                const paidThrough = contract.paid_through_date;
                const paidPeriodStartsBeforeCutoff = paidThrough ? contract.start_date <= paidThrough : false;
                return (
                  <RoomCard key={contract.id} roomNo={unit?.unit_no ?? "-"} status={isManaged ? "managed" : "leased"}
                    onClick={() => openDetail(contract.id)}
                    className={isRisk ? "border-amber-200 shadow-[0_10px_24px_rgba(180,120,24,0.14)]" : ""}>
                    {/* Customer and tags */}
                    <div className="flex min-h-[58px] flex-col justify-start gap-2">
                      <p className="text-[13px] font-semibold leading-snug line-clamp-2 break-words" title={customer?.name ?? (locale==="zh"?"无客户":"Sans client")}>
                        {customer?.name ?? "—"}
                      </p>
                      <div className="flex h-5 items-center gap-1.5">
                        {isManaged && <Badge variant="success" className="h-5 bg-white/70 px-2 text-[10px] text-[#217365]">{locale === "zh" ? "代管" : "Gestion"}</Badge>}
                        {dataFlags.needsData && <Badge variant="warning" className="h-5 px-2 text-[10px]">{locale === "zh" ? "资料待补" : "A compléter"}</Badge>}
                        <Badge variant={statusVariant[contract.status]} className="h-5 px-2 text-[10px]">{t.contractStatus[contract.status as keyof typeof t.contractStatus]}</Badge>
                      </div>
                    </div>
                    {/* Rent + expiry */}
                    <div className="min-h-[48px] text-[11px] leading-relaxed text-[#5D7186]">
                      <p className="tabular-nums">{rent > 0 ? formatXof(rent) : (locale==="zh"?"租金未录入":"Loyer non saisi")}</p>
                      {paidThrough ? (
                        <p className={cn("tabular-nums font-medium", isPaidThroughOverdue(contract) ? "text-red-600" : "text-emerald-700")}>
                          {paidPeriodStartsBeforeCutoff
                            ? <>{locale === "zh" ? "缴费期" : "Période payée"} {contract.start_date} → {paidThrough}</>
                            : <>{locale === "zh" ? "已缴至" : "Payé au"} {paidThrough}</>}
                        </p>
                      ) : (
                        <p className="tabular-nums">
                          {contract.start_date} → {!endConfirmed ? (locale === "zh" ? "缴租截至日待补" : "Paiement à compléter") : isLongTerm ? (locale === "zh" ? "长期有效" : "Long terme") : contract.expected_end_date}
                          {endConfirmed && !isLongTerm && daysLeft!==null&&daysLeft>=0&&daysLeft<=30 && <span className="ml-1 text-amber-600 font-medium">({daysLeft}j)</span>}
                        </p>
                      )}
                    </div>
                    {/* Outstanding alert */}
                    {summary.outstanding > 0 && (
                      <p className="text-[11px] text-amber-600 font-medium leading-tight">{locale==="zh"?"待收":"Dû"}: {formatXof(summary.outstanding)}</p>
                    )}
                    {/* Action buttons */}
                    <div className="mt-auto flex justify-end gap-1.5 pt-1">
                      <ActionBtn icon={Eye} label={locale==="zh"?"查看":"Voir"} onClick={() => openDetail(contract.id)} />
                      <ActionBtn icon={DollarSign} label={locale==="zh"?"收款":"Paiement"} onClick={() => { openDetail(contract.id); }} />
                      <ActionBtn icon={FileText} label={locale==="zh"?"合同":"Contrat"} onClick={() => { openDetail(contract.id); }} />
                    </div>
                  </RoomCard>
                );
              })}
            </div>
          </RoomBoard>
        ))
      )}

      {/* ── Collection attention panel ── */}
      {panel === "attention" && (
        <PanelShell
          onClose={() => setPanel(null)}
          title={locale === "zh" ? "长租收费提醒" : "Rappels de loyer"}
          badge={<Badge variant={attentionTab === "overdue" ? "destructive" : "warning"}>{attentionTab === "overdue" ? leaseAttention.overdue.length : leaseAttention.upcoming.length}</Badge>}
        >
          <div className="space-y-4">
            <SegmentedControl
              value={attentionTab}
              onChange={(value) => setAttentionTab(value as AttentionTab)}
              ariaLabel={locale === "zh" ? "收费提醒类型" : "Type de rappel"}
              items={[
                { value: "overdue", label: `${locale === "zh" ? "已逾期" : "En retard"} ${leaseAttention.overdue.length}` },
                { value: "upcoming", label: `${locale === "zh" ? "30天内应缴" : "Sous 30 jours"} ${leaseAttention.upcoming.length}` },
              ]}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {locale === "zh" ? "依据未结应收日期及租金已缴至日期汇总，便于安排人员联系收费。" : "Liste basée sur les créances ouvertes et la date de loyer payé au."}
            </p>
            {(attentionTab === "overdue" ? leaseAttention.overdue : leaseAttention.upcoming).length === 0 ? (
              <EmptyState title={locale === "zh" ? "当前没有需要跟进的合同" : "Aucun contrat à suivre"} />
            ) : (
              <div className="space-y-2.5">
                {(attentionTab === "overdue" ? leaseAttention.overdue : leaseAttention.upcoming).map((row) => (
                  <div key={row.contract.id} className={cn("rounded-xl border p-3.5", row.kind === "overdue" ? "border-red-200 bg-red-50/40" : "border-amber-200 bg-amber-50/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{row.buildingName} · {row.unit.unit_no}</span>
                          <Badge variant={row.kind === "overdue" ? "destructive" : "warning"} className="h-5 px-2 text-[10px]">
                            {row.kind === "overdue"
                              ? `${locale === "zh" ? "逾期" : "Retard"} ${Math.abs(row.days)}${locale === "zh" ? "天" : "j"}`
                              : `${row.days}${locale === "zh" ? "天后应缴" : "j"}`}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-[13px] font-medium text-foreground">{row.customer?.name ?? (locale === "zh" ? "客户待补" : "Client à compléter")}</p>
                      </div>
                      <p className={cn("shrink-0 text-sm font-semibold tabular-nums", row.kind === "overdue" ? "text-red-700" : "text-amber-700")}>{formatXof(row.amount)}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />{locale === "zh" ? "应缴日" : "Échéance"} {row.dueDate}</span>
                      <span className="text-right">{row.amountIsEstimated ? (locale === "zh" ? "预计月租" : "Loyer estimé") : (locale === "zh" ? "未结应收" : "Créance ouverte")}</span>
                      <span>{locale === "zh" ? "已缴至" : "Payé au"} {row.paidThrough ?? (locale === "zh" ? "待补" : "À compléter")}</span>
                      <span className="flex items-center justify-end gap-1.5"><Phone className="h-3.5 w-3.5" />{row.customer?.phone || (locale === "zh" ? "电话待补" : "Téléphone à compléter")}</span>
                    </div>
                    <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => openDetail(row.contract.id)}>
                      {locale === "zh" ? "查看合同并收款" : "Voir et encaisser"}<ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PanelShell>
      )}

      {/* ── New Contract Panel ── */}
      {panel === "new" && (<PanelShell onClose={()=>setPanel(null)} title={t.form.newContract}>{/* form fields same as before, using shadcn tokens */}{/* kept compact */}
        <div className="space-y-4">
          <div><label className={labelClass}>{t.form.contractNo} *</label><input type="text" value={fContractNo} onChange={e=>setFContractNo(e.target.value)} className={inputClass}/></div>
          <div><label className={labelClass}>{t.form.unit} *</label><select value={fUnitId} onChange={e=>setFUnitId(e.target.value)} className={inputClass}><option value="">{t.form.noUnit}</option>{availableUnits.map(u=><option key={u.id} value={u.id}>{u.unit_no} ({u.floor_label}){isManagedLeaseUnit(u) ? (locale === "zh" ? " · 已售代管" : " · Gestion") : ""}</option>)}</select></div>
          <div><label className={labelClass}>{t.form.customer} *</label><select value={fCustomerId} onChange={e=>setFCustomerId(e.target.value)} className={inputClass}><option value="">{t.form.noCustomer}</option>{customers.filter(cc=>!cc.is_blacklisted).map(cc=><option key={cc.id} value={cc.id}>{cc.name} {cc.phone?`(${cc.phone})`:""}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t.form.startDate}</label><DateInput value={fStartDate} onChangeValue={setFStartDate} className={inputClass}/></div><div><label className={labelClass}>{t.form.expectedEndDate}</label><DateInput value={fEndDate} onChangeValue={setFEndDate} className={inputClass}/></div></div>
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
      {panel==="detail"&&selected&&(<PanelShell onClose={()=>setPanel(null)} title={selected.contract_no} badge={<Badge variant={statusVariant[selected.status]}>{t.contractStatus[selected.status as keyof typeof t.contractStatus]}</Badge>} actions={<button onClick={()=>printLeaseContract({contract:selected,unit:selectedUnit??null,customer:selectedCustomer??null,receivables:contractReceivables},locale)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground" title={dictionaries[locale].settings.print.print}><Printer className="h-4 w-4"/></button>}>
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-xs text-muted-foreground">{t.form.unit}</dt><dd className="font-medium">{selectedUnit?.unit_no??"-"} ({selectedUnit?.floor_label??""})</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name??"-"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.startDate}</dt><dd>{selected.start_date}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{locale === "zh" ? "正式合同到期日" : t.form.expectedEndDate}</dt><dd>{isContractEndConfirmed(selected)?selected.expected_end_date:(locale==="zh"?"未确认":"Non confirmée")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{locale==="zh"?"缴租截至日":"Loyer payé au"}</dt><dd className={cn(selected.paid_through_date&&isPaidThroughOverdue(selected)?"font-medium text-red-600":"font-medium text-emerald-700")}>{selected.paid_through_date??(locale==="zh"?"待补":"À compléter")}</dd></div>
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
            <h4 className="flex items-center gap-1.5 text-sm font-semibold"><AlertTriangle className="h-3.5 w-3.5 text-amber-500"/>{locale==="zh"?"风险概览":"Apercu des risques"}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className={cn("rounded-md border px-3 py-2",receivableStats.outstanding>0?"border-amber-200 bg-amber-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.outstandingTotal}</p><p className={cn("font-semibold tabular-nums",receivableStats.outstanding>0?"text-amber-700":"text-emerald-700")}>{formatXof(receivableStats.outstanding)}</p></div>
              <div className={cn("rounded-md border px-3 py-2",receivableStats.overdue>0?"border-red-200 bg-red-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.overdueTotal}</p><p className={cn("font-semibold tabular-nums",receivableStats.overdue>0?"text-red-700":"text-emerald-700")}>{formatXof(receivableStats.overdue)}</p></div>
              <div className={cn("rounded-md border px-3 py-2",!selected.deposit_received?"border-red-200 bg-red-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.depositStatus}</p><p className={cn("text-xs font-semibold",selected.deposit_received?"text-emerald-700":"text-red-600")}>{selected.deposit_received?t.form.depositPaid:t.form.depositUnpaid}</p></div>
              <div className={cn("rounded-md border px-3 py-2",contractRisk.expiringSoon?"border-amber-200 bg-amber-50":"border-emerald-200 bg-emerald-50")}><p className="text-muted-foreground">{t.risk.expiringSoon}</p><p className={cn("text-xs font-semibold",contractRisk.expiringSoon?"text-amber-700":"text-emerald-700")}>{contractRisk.expiringSoon?`${contractRisk.daysLeft} ${locale==="zh"?"天后到期":"j restants"}`:(locale==="zh"?"否":"Non")}</p></div>
            </div>
          </div>}

          {/* Receivable list */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-semibold">{t.receivable.title}</h4>{selected.status==="active"&&<button onClick={()=>handleGenerateReceivables(selected.id)} disabled={saving} className={cn(controlClass, "text-xs font-medium disabled:opacity-40")}><RefreshCw className="h-3 w-3"/>{t.receivable.generate}</button>}</div>
            {contractReceivables.length===0?<p className="text-xs text-muted-foreground">{t.receivable.none}</p>:<div className="space-y-1.5">{contractReceivables.map(r=>{const amount=Number(r.amount_xof);const paid=Number(r.paid_amount_xof);const os=Math.max(0,amount-paid);const od=os>0&&new Date(r.due_date).getTime()<Date.now()?Math.floor((Date.now()-new Date(r.due_date).getTime())/86400000):null;return(<div key={r.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px] transition-colors hover:bg-accent/40",ROW_BG[r.status])}><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-semibold">{receivableKindLabel(r.category)}</span><span className="text-xs text-muted-foreground tabular-nums">{r.due_date}</span>{od!==null&&od>0&&<span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">+{od}d</span>}</div><p className="mt-0.5 text-xs text-muted-foreground">{paid>0?(locale==="zh"?"已收 ":"Payé ")+formatXof(paid):(locale==="zh"?"未收款":"Non payé")}</p></div><div className="text-right"><p className="font-semibold tabular-nums">{formatXof(amount)}</p><span className={cn("inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-semibold",STATUS_STYLES[r.status])}>{statusLabel(r.status)}</span></div>{os>0&&selected.status==="active"&&(payReceivableId===r.id?<span className="text-xs text-muted-foreground">{locale==="zh"?"收款中...":"En cours..."}</span>:<button onClick={()=>{setPayReceivableId(r.id);setPayDate(new Date().toISOString().slice(0,10));setPayReceiptNo("");setError("");}} className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90">{locale==="zh"?"收款":"Enc"}</button>)}</div>);})}</div>}
            {payReceivableId&&<div className="mt-3 space-y-2 rounded-md border bg-card p-3"><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收款日期":"Date"}</label><DateInput value={payDate} onChangeValue={setPayDate} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"收据号":"Recu"}</label><input type="text" value={payReceiptNo} onChange={e=>setPayReceiptNo(e.target.value)} className={inputClass}/></div></div>{error&&<p className="text-xs text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" onClick={handleCollectReceivable} disabled={saving}>{saving?"...":locale==="zh"?"确认收款":"Encaisser"}</Button><Button size="sm" variant="ghost" onClick={()=>{setPayReceivableId(null);setError("");}}>{locale==="zh"?"取消":"Annuler"}</Button></div></div>}
          </div>
        </div>
      </PanelShell>)}

      {/* ── Move-out Panel ── */}
      {panel==="moveout"&&selected&&(<PanelShell onClose={()=>setPanel(null)} title={t.settlement.moveOut}>{/* form kept identical to original */}{/*...*/}<div className="space-y-4"><div><label className={labelClass}>{t.form.actualEndDate}</label><DateInput value={moEndDate} onChangeValue={setMoEndDate} className={inputClass}/></div><div><label className={labelClass}>{locale==="zh"?"未付租金":"Loyer impaye"}</label><input type="number" value={moUnpaid} onChange={e=>setMoUnpaid(Number(e.target.value))} className={inputClass}/></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moUtility} onChange={e=>setMoUtility(e.target.checked)}/>{locale==="zh"?"水电已结清":"Charges reglees"}</label><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"押金抵扣":"Retenue depot"}</label><input type="number" value={moDeduction} onChange={e=>setMoDeduction(Number(e.target.value))} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"押金退还":"Remb. depot"}</label><input type="number" value={moRefund} onChange={e=>setMoRefund(Number(e.target.value))} className={inputClass}/></div></div>{error&&<p className="text-sm text-red-600">{error}</p>}<Button className="w-full" onClick={handleMoveOut} disabled={saving}>{saving?"...":locale==="zh"?"确认退租":"Confirmer"}</Button></div></PanelShell>)}
    </div>
  );
}

// ── Card helpers ──
function Info({ label, value, dim, warn, danger }: { label: string; value: string; dim?: boolean; warn?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1 text-[12px]">
      <span className="text-[#5D7186] shrink-0">{label}</span>
      <span className={cn("font-medium tabular-nums truncate text-right", danger ? "text-[#C0394A]" : warn ? "text-amber-600" : dim ? "text-amber-600" : "text-[#17324D]")}>{value}</span>
    </div>
  )
}
function ActionBtn({ icon: Icon, label, onClick }: { icon: typeof Eye; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,50,77,0.10)] bg-white/80 text-[#27506F] shadow-[0_1px_2px_rgba(25,58,92,0.04)] transition-colors hover:bg-white"
      aria-label={label} title={label}>
      <Icon className="h-[14px] w-[14px]" strokeWidth={1.5} />
    </button>
  )
}

// ── Shared panel shell ──
function PanelShell({ onClose, title, badge, actions, children }: { onClose:()=>void; title:string; badge?:React.ReactNode; actions?:React.ReactNode; children:React.ReactNode }) {
  return (<>
    <div className="fixed bottom-0 left-0 right-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={onClose}/>
    <div className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-full overflow-auto border-l border-border bg-card shadow-panel lg:max-w-[480px]">
      <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-2"><h3 className="text-[15px] font-semibold">{title}</h3>{badge}</div>
        <div className="flex items-center gap-1">{actions}<button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4"/></button></div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  </>);
}
