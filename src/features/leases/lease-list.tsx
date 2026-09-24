"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { leaseRequestIdentity, clearLeaseRequestIdentity } from "./lease-request-identity";
import { Plus, AlertTriangle, FileText, DollarSign, LogOut, Printer, Eye, CalendarClock, Phone, ChevronRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { RoomLegend } from "@/components/room-legend";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, MetricGrid, OperationalPage, RightDrawer, SegmentedControl, StatTile, controlClass } from "@/components/ui/operational";
import type { RoomVisualStatus } from "@/lib/status-styles";
import type { LeaseContractRow, UnitRow, CustomerRow, PaymentRow, ReceivableRow } from "@/types/database";
import type { ContractStatus, CurrencyCode } from "@/types/domain";
import { contractStatusVariant as statusVariant } from "@/lib/status-styles";
import { printLeaseContract } from "@/features/print";
import { createLeaseContract, activateContract, terminateContract, processMoveOut, recordLeaseFinancialEntry } from "./actions";
import {
  buildLeaseContractNumber,
  buildLeaseFinancialReferencePrefix,
  getLeaseFinancialConfig,
  getLeaseFinancialConfigBySourceType,
  isLeaseFinancialExpenseSourceType,
  LEASE_FINANCIAL_BUSINESS_CONFIG,
  LEASE_FINANCIAL_BUSINESS_TYPES,
  type LeaseFinancialBusinessType,
} from "./lease-financial-entry-types";
import { isOverdueReceivable, resolveLeaseOverdue, summarizeLeaseReceivables } from "./lease-receivable-summary";
import { ALL_BUILDINGS, groupLeaseBuildings, resolveBuildingScope, type LeaseBuilding } from "./project-scope";

interface UnitBusinessFlag {
  business_type: "daily_rental" | "long_lease" | "sale";
  is_enabled: boolean;
  default_price_xof: number | null;
}

type LeaseUnitRow = UnitRow & {
  unit_business_flags?: UnitBusinessFlag[];
};

interface LeaseListProps { contracts: LeaseContractRow[]; units: LeaseUnitRow[]; customers: CustomerRow[]; payments: PaymentRow[]; receivables: ReceivableRow[]; buildings: LeaseBuilding[]; locale: Locale; canCreate?: boolean; canRecordFinance?: boolean; canActivate?: boolean; canMoveOut?: boolean }
type PanelType = "new" | "detail" | "financeEntry" | "moveout" | "attention" | "insight" | null;
type AttentionTab = "overdue" | "upcoming";
const paymentCycles = ["monthly", "quarterly", "semiannual", "annual"];
type LeaseStatFilter = "active" | "rent" | "dueSoon" | "currentDue" | "overdue";

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

function paymentAmountXof(payment: PaymentRow) {
  return payment.currency === "XOF"
    ? Number(payment.amount)
    : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
}

function getRecordedOriginalPayment(payment: PaymentRow) {
  const metadata = payment.notes?.match(/original_currency=([A-Z]{3});original_amount=([\d.]+);original_period_months=(\d+)/);
  if (!metadata) return null;
  const amount = Number(metadata[2]);
  const periodMonths = Number(metadata[3]);
  if (amount <= 0 || periodMonths <= 0) return null;
  return { currency: metadata[1], amount, periodMonths };
}

function getOriginalMonthlyRent(contract: LeaseContractRow, payments: PaymentRow[]) {
  const contractPayments = payments
    .filter((payment) => payment.source_id === contract.id && payment.source_type === "lease_rent")
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const originalCurrencyPayments = contractPayments.filter((payment) => payment.currency !== "XOF" && Number(payment.exchange_rate_to_xof) > 0);
  const originalCurrency = originalCurrencyPayments[0]?.currency;
  if (originalCurrency && originalCurrencyPayments.every((payment) => payment.currency === originalCurrency)) {
    return {
      currency: originalCurrency,
      amount: Number(contract.monthly_rent_xof) / Number(originalCurrencyPayments[0].exchange_rate_to_xof),
    };
  }

  for (const payment of contractPayments) {
    const recordedOriginal = getRecordedOriginalPayment(payment);
    if (recordedOriginal) return { currency: recordedOriginal.currency, amount: recordedOriginal.amount / recordedOriginal.periodMonths };
  }
  return null;
}

export function LeaseList({ contracts, units, customers, payments, receivables, buildings, locale, canCreate = true, canRecordFinance = true, canActivate = true, canMoveOut = true }: LeaseListProps) {
  const router = useRouter();
  const t = dictionaries[locale].leases;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [statFilter, setStatFilter] = useState<LeaseStatFilter | null>(null);
  const [panel, setPanel] = useState<PanelType>(null);
  const [detailSection, setDetailSection] = useState<"overview" | "finance">("overview");
  const [attentionTab, setAttentionTab] = useState<AttentionTab>("overdue");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [fContractNo, setFContractNo] = useState(""); const [fUnitId, setFUnitId] = useState(""); const [fCustomerId, setFCustomerId] = useState("");
  const [fStartDate, setFStartDate] = useState(""); const [fEndDate, setFEndDate] = useState(""); const [fCycle, setFCycle] = useState("monthly");
  const [fPayDay, setFPayDay] = useState(5); const [fRent, setFRent] = useState(0); const [fDeposit, setFDeposit] = useState(0);
  const [fDepositReceived, setFDepositReceived] = useState(false); const [fFreeDays, setFFreeDays] = useState(0);
  const [fSigner, setFSigner] = useState(""); const [fStatus, setFStatus] = useState<ContractStatus>("draft");
  const [moEndDate, setMoEndDate] = useState(new Date().toISOString().slice(0,10)); const [moUnpaid, setMoUnpaid] = useState(0);
  const [moUtility, setMoUtility] = useState(false); const [moDeduction, setMoDeduction] = useState(0); const [moRefund, setMoRefund] = useState(0);
  const [financeType, setFinanceType] = useState<LeaseFinancialBusinessType>("rent_income");
  const [financeDate, setFinanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [financeAmountWan, setFinanceAmountWan] = useState(0);
  const [financeCurrency, setFinanceCurrency] = useState<CurrencyCode>("XOF");
  const [financeExchangeRate, setFinanceExchangeRate] = useState(1);
  const [financeExternalReceiptNo, setFinanceExternalReceiptNo] = useState("");
  const [financePaidThrough, setFinancePaidThrough] = useState("");
  const [financeMethod, setFinanceMethod] = useState<"cash" | "check" | "bank_transfer" | "offset" | "other">("other");
  const [financeNotes, setFinanceNotes] = useState("");
  const financeRequestIdRef = useRef<string | null>(null);
  const lifecycleBusy = useRef(false);
  const [moCollectedConfirmed,setMoCollectedConfirmed]=useState(false);
  const [moMethod,setMoMethod]=useState<"cash"|"check"|"bank_transfer"|"offset"|"other"|"">("");
  const financeSectionRef = useRef<HTMLDivElement | null>(null);

  const projects = useMemo(() => groupLeaseBuildings(buildings), [buildings]);
  const [scope, setScope] = useState(() => {
    const initial = buildings.find((b) => b.code === "SACSI11");
    const projectId = initial?.project_id ?? projects[0]?.id ?? "";
    return { projectId, buildings: { [projectId]: initial?.id ?? ALL_BUILDINGS } as Record<string, string> };
  });
  const [scopeLoaded, setScopeLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("lease-project-scope") ?? "null");
      if (saved && typeof saved.projectId === "string" && saved.buildings && typeof saved.buildings === "object" && !Array.isArray(saved.buildings)) {
        setScope({ projectId: saved.projectId, buildings: Object.fromEntries(Object.entries(saved.buildings).filter(([, value]) => typeof value === "string")) as Record<string, string> });
      }
    } catch { /* Storage is optional. */ }
    setScopeLoaded(true);
  }, []);
  useEffect(() => {
    if (scopeLoaded) {
      try { localStorage.setItem("lease-project-scope", JSON.stringify(scope)); } catch { /* Storage is optional. */ }
    }
  }, [scope, scopeLoaded]);
  const project = projects.find((p) => p.id === scope.projectId) ?? projects[0];
  const projectBuildings = project?.buildings ?? [];
  const activeBuildingId = resolveBuildingScope(projectBuildings, scope.buildings[project?.id ?? ""]);
  const scopeBuildingIds = new Set(projectBuildings.filter((b) => activeBuildingId === ALL_BUILDINGS || b.id === activeBuildingId).map((b) => b.id));
  const projectLabel = (p: typeof project) => p?.code === "SACSI" ? (locale === "zh" ? "公寓项目" : "Résidences SACSI") : p?.code === "CIMAC" ? (locale === "zh" ? "科建建材城" : "CIMAC") : p?.name || (locale === "zh" ? "未归属项目" : "Projet non affecté");
  const scopeLabel = `${projectLabel(project)} · ${activeBuildingId === ALL_BUILDINGS ? (locale === "zh" ? "全部楼栋合计" : "Tous les bâtiments") : projectBuildings.find((b) => b.id === activeBuildingId)?.display_name ?? ""}`;
  const closeScopePanel = () => { setPanel(null); setSelectedId(null); setFUnitId(""); setError(""); };
  const changeProject = (projectId: string) => { setScope((current) => ({ ...current, projectId })); closeScopePanel(); };
  const changeBuilding = (id: string) => { if (project) setScope((current) => ({ ...current, buildings: { ...current.buildings, [project.id]: id } })); closeScopePanel(); };

  // Build unit -> building_id map
  const unitBuildingMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.building_id);
    return m;
  }, [units]);

  const filteredByBuilding = useMemo(() => {
    const ids = new Set(project?.buildings.filter((b) => activeBuildingId === ALL_BUILDINGS || b.id === activeBuildingId).map((b) => b.id));
    return contracts.filter((c) => ids.has(unitBuildingMap.get(c.unit_id) ?? ""));
  }, [contracts, project, activeBuildingId, unitBuildingMap]);

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const buildingMap = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filteredByStatus = useMemo(() => (
    statusFilter === "all"
      ? filteredByBuilding.filter((c) => c.status !== "terminated")
      : filteredByBuilding.filter((c) => c.status === statusFilter)
  ), [filteredByBuilding, statusFilter]);

  const filtered = filteredByStatus;

  const groupedContracts = useMemo(() => {
    const grouped = new Map<string, LeaseContractRow[]>();
    for (const contract of filtered) { const unit = unitMap.get(contract.unit_id); const floor = normalizeFloorLabel(unit?.floor_label ?? null, unit?.unit_no ?? ""); const key = `${unit?.building_id ?? ""}|${floor}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key)!.push(contract); }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => {
        const [ab, af] = a.split("|"); const [bb, bf] = b.split("|");
        return (buildingMap.get(ab)?.code ?? "").localeCompare(buildingMap.get(bb)?.code ?? "", undefined, { numeric: true }) || floorSortValue(af) - floorSortValue(bf);
      })
      .map(([floor, floorContracts]) => [
        activeBuildingId === ALL_BUILDINGS ? `${buildingMap.get(floor.split("|")[0])?.display_name ?? ""} · ${floor.split("|")[1]}` : floor.split("|")[1],
        [...floorContracts].sort((a, b) => {
          const aUnit = unitMap.get(a.unit_id)?.unit_no ?? "";
          const bUnit = unitMap.get(b.unit_id)?.unit_no ?? "";
          return aUnit.localeCompare(bUnit, undefined, { numeric: true });
        }),
      ] as [string, LeaseContractRow[]]);
  }, [filtered, unitMap, buildingMap, activeBuildingId]);

  const getContractReceivableSummary = (contractId: string) => {
    const related = receivables.filter((r) => r.source_type === "lease_contract" && r.source_id === contractId && r.status !== "cancelled" && r.management_status !== "historical_pending" && r.management_status !== "excluded");
    const today = new Date().toISOString().slice(0, 10); let total = 0, paid = 0, overdue = 0; let nextDue: string | null = null;
    for (const r of related) { const amount = Number(r.amount_xof); const paidAmount = Number(r.paid_amount_xof); const outstanding = Math.max(0, amount - paidAmount); total += amount; paid += paidAmount; if (outstanding > 0 && r.due_date < today) overdue += outstanding; if (outstanding > 0 && (!nextDue || r.due_date < nextDue)) nextDue = r.due_date; }
    return { total, paid, outstanding: Math.max(0, total - paid), overdue, nextDue, count: related.length };
  };

  const selected = selectedId ? contracts.find((c) => c.id === selectedId) : null;
  const selectedUnit = selected ? units.find((u) => u.id === selected.unit_id) : null;
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer_id) : null;
  const selectedOriginalMonthlyRent = selected ? getOriginalMonthlyRent(selected, payments) : null;

  const leaseAttention = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const upcomingLimit = addDaysToIso(today, 15);
    const buildingMap = new Map(buildings.map((building) => [building.id, building]));
    const rows = filteredByBuilding.flatMap((contract) => {
      if (contract.status !== "active") return [];
      const unit = unitMap.get(contract.unit_id);
      const customer = customerMap.get(contract.customer_id);
      if (!unit) return [];
      const related = receivables.filter((row) => row.source_type === "lease_contract" && row.source_id === contract.id && row.status !== "cancelled" && row.management_status !== "historical_pending" && row.management_status !== "excluded");
      const summary = summarizeLeaseReceivables(related, today);
      const coverageDue = contract.paid_through_date ? addDaysToIso(contract.paid_through_date, 1) : null;
      const overdueResolution = resolveLeaseOverdue({
        receivables: related,
        today,
        paidThroughDate: contract.paid_through_date ?? null,
        monthlyRentXof: Number(contract.monthly_rent_xof),
        contractStatus: contract.status,
        actualEndDate: contract.actual_end_date,
      });
      const dueDate = overdueResolution?.dueDate ?? summary.earliestOutstandingDue ?? coverageDue;
      if (!dueDate) return [];
      const isOverdue = overdueResolution !== null;
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
        amount: overdueResolution
          ? overdueResolution.amount
          : summary.outstanding > 0
            ? summary.outstanding
            : Number(contract.monthly_rent_xof),
        amountIsEstimated: overdueResolution?.source === "contract" || (!overdueResolution && summary.outstanding <= 0),
        days: diffIsoDays(today, dueDate),
        kind: isOverdue ? "overdue" as const : "upcoming" as const,
      }];
    });
    return {
      overdue: rows.filter((row) => row.kind === "overdue").sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      upcoming: rows.filter((row) => row.kind === "upcoming").sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    };
  }, [buildings, customerMap, filteredByBuilding, receivables, unitMap]);

  const actualOverdueRows = leaseAttention.overdue;

  const dashboardStats = useMemo(() => {
    const active = filteredByBuilding.filter((c) => c.status === "active");
    const currentDue = actualOverdueRows.reduce((sum, row) => sum + row.amount, 0);
    return {
      active: active.length,
      rent: active.reduce((sum, c) => sum + Number(c.monthly_rent_xof), 0),
      dueSoon: leaseAttention.upcoming.length,
      currentDue,
      overdue: currentDue,
      overdueContracts: actualOverdueRows.length,
    };
  }, [actualOverdueRows, filteredByBuilding, leaseAttention.upcoming.length]);

  const leaseInsightContracts = useMemo(() => {
    return filteredByBuilding
      .map((contract) => {
        const unit = unitMap.get(contract.unit_id);
        const customer = customerMap.get(contract.customer_id);
        const related = receivables.filter((r) => r.source_type === "lease_contract" && r.source_id === contract.id && r.status !== "cancelled" && r.management_status !== "historical_pending" && r.management_status !== "excluded");
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
          if (outstanding > 0 && r.due_date < todayStr) overdue += outstanding;
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
  }, [customerMap, filteredByBuilding, receivables, todayStr, unitMap]);

  const currentDueRows = actualOverdueRows;

  const contractReceivables = useMemo(() => selectedId ? receivables.filter(r => r.source_type === "lease_contract" && r.source_id === selectedId && r.status !== "cancelled") : [], [receivables, selectedId]);
  const contractPayments = useMemo(() => selectedId ? payments.filter((p) => p.source_id === selectedId) : [], [payments, selectedId]);
  const totalIncome = contractPayments.reduce((sum, payment) => isLeaseFinancialExpenseSourceType(payment.source_type) ? sum : sum + paymentAmountXof(payment), 0);
  const totalExpense = contractPayments.reduce((sum, payment) => isLeaseFinancialExpenseSourceType(payment.source_type) ? sum + paymentAmountXof(payment) : sum, 0);
  const netFinancial = totalIncome - totalExpense;
  const receivableStats = useMemo(() => { let totalRec=0,totalPd=0,overdue=0; const today=new Date().toISOString().slice(0,10); for(const r of contractReceivables){totalRec+=Number(r.amount_xof);totalPd+=Number(r.paid_amount_xof);const os=Number(r.amount_xof)-Number(r.paid_amount_xof);if(os>0&&(r.status==="overdue"||r.due_date<=today))overdue+=os;} return {totalReceivable:totalRec,totalPaid:totalPd,outstanding:totalRec-totalPd,overdue}; }, [contractReceivables]);
  const contractRisk = useMemo(() => { if(!selected||selected.status!=="active"||!isContractEndConfirmed(selected))return {expiringSoon:false,daysLeft:0}; const today=new Date(); const diff=Math.floor((new Date(selected.expected_end_date).getTime()-today.getTime())/86400000); return {expiringSoon:diff<=30&&diff>=0,daysLeft:Math.max(0,diff)}; }, [selected]);
  const availableUnits = units.filter((u) => scopeBuildingIds.has(u.building_id) && (u.status === "available" || isManagedLeaseUnit(u)));
  const selectedNewUnit = useMemo(() => units.find((unit) => unit.id === fUnitId), [fUnitId, units]);
  const generatedLeaseContractNo = useMemo(() => {
    if (!selectedNewUnit || !fStartDate) return "";
    const building = buildingMap.get(selectedNewUnit.building_id);
    return buildLeaseContractNumber(building?.code ?? "SACSI", selectedNewUnit.unit_no, fStartDate);
  }, [buildingMap, fStartDate, selectedNewUnit]);

  const resetNewForm = () => { setFContractNo(""); setFUnitId(""); setFCustomerId(""); setFStartDate(""); setFEndDate(""); setFCycle("monthly"); setFPayDay(5); setFRent(0); setFDeposit(0); setFDepositReceived(false); setFFreeDays(0); setFSigner(""); setFStatus("draft"); setError(""); };
  const openNew = () => { resetNewForm(); setPanel("new"); setSelectedId(null); };
  const openDetail = (id: string, section: "overview" | "finance" = "overview") => { setSelectedId(id); setDetailSection(section); setPanel("detail"); setError(""); };
  const openFinanceEntry = () => {
    setFinanceType("rent_income");
    setFinanceDate(new Date().toISOString().slice(0, 10));
    setFinanceAmountWan(0);
    setFinancePaidThrough("");
    setFinanceMethod("other");
    setFinanceNotes("");
    financeRequestIdRef.current = null;
    setError("");
    setPanel("financeEntry");
  };
  const openMoveOut = (id:string) => { setSelectedId(id); setPanel("moveout"); setError(""); setMoUnpaid(0); setMoDeduction(0); setMoRefund(0); setMoUtility(false); setMoCollectedConfirmed(false); setMoMethod(""); setMoEndDate(new Date().toISOString().slice(0,10)); };

  useEffect(() => {
    if (panel !== "detail" || detailSection !== "finance") return;
    const frame = window.requestAnimationFrame(() => financeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [detailSection, panel, selectedId]);

  const runLifecycle = async (operation:string,target:string,payload:unknown,submit:(requestId:string)=>Promise<{success:boolean;error?:string;rejected?:boolean}>,done:()=>void) => {
    if(lifecycleBusy.current)return;
    lifecycleBusy.current=true;setSaving(true);setError("");
    try {
      const requestId=await leaseRequestIdentity(operation,target,payload);
      const result=await submit(requestId);
      if(result.success||result.rejected)clearLeaseRequestIdentity(operation,target);
      if(result.success){done();router.refresh();}
      else setError((result.error??"操作失败")+(result.rejected?"":"；结果可能未知，请保留原内容重试。操作号："+requestId));
    } catch(error) {setError(error instanceof Error?error.message:"结果未知，请保留原内容重试。");}
    finally {lifecycleBusy.current=false;setSaving(false);}
  };
  const handleCreate = async () => {
    if (!fUnitId || !fCustomerId || !fStartDate || !fEndDate) { setError(locale==="zh"?"请填写必填字段":"Champs obligatoires"); return; }
    const payload={unitId:fUnitId,customerId:fCustomerId,contractNo:generatedLeaseContractNo,startDate:fStartDate,expectedEndDate:fEndDate,paymentCycle:fCycle,paymentDay:fPayDay,monthlyRentXof:fRent,depositAmountXof:fDeposit,depositReceived:fDepositReceived,rentFreeDays:fFreeDays,signerName:fSigner||undefined,status:fStatus};
    await runLifecycle("create",fUnitId,payload,requestId=>createLeaseContract({...payload,requestId}),()=>{resetNewForm();setPanel(null);});
  };
  const handleActivate = async (id:string) => {
    const contract=contracts.find(c=>c.id===id);if(!contract)return;
    const payload={contractId:id,expectedUpdatedAt:contract.updated_at};
    await runLifecycle("activate",id,payload,requestId=>activateContract(id,requestId,contract.updated_at),()=>{});
  };
  const handleTerminate = async (id:string) => {
    const contract=contracts.find(c=>c.id===id);if(!contract)return;
    const payload={contractId:id,expectedUpdatedAt:contract.updated_at};
    await runLifecycle("terminate",id,payload,requestId=>terminateContract(id,requestId,contract.updated_at),()=>{});
  };
  const handleMoveOut = async () => {
    if(!selected)return;
    const payload={contractId:selected.id,expectedUpdatedAt:selected.updated_at,actualEndDate:moEndDate,unpaidRentXof:moUnpaid,utilityCleared:moUtility,depositDeductionXof:moDeduction,depositRefundXof:moRefund,rentCollectedConfirmed:moCollectedConfirmed,paymentMethod:moMethod||undefined};
    await runLifecycle("move_out",selected.id,payload,requestId=>processMoveOut({...payload,requestId}),()=>setPanel(null));
  };
  const handleFinanceEntry = async () => {
    if (!selectedId) return;
    if (financeAmountWan <= 0) {
      setError(locale === "zh" ? "请输入大于0的金额" : "Saisissez un montant supérieur à 0");
      return;
    }
    if (getLeaseFinancialConfig(financeType).requiresPaidThrough && !financePaidThrough) {
      setError(locale === "zh" ? "租金收入必须填写已缴至日期" : "La date payée au est obligatoire");
      return;
    }
    setSaving(true);
    setError("");
    const requestId = financeRequestIdRef.current ?? crypto.randomUUID();
    financeRequestIdRef.current = requestId;
    const result = await recordLeaseFinancialEntry({
      contractId: selectedId,
      businessType: financeType,
      paymentDate: financeDate,
      amount: financeCurrency === "XOF" ? Math.round(financeAmountWan * 10000) : financeAmountWan,
      currency: financeCurrency,
      exchangeRateToXof: financeCurrency === "XOF" ? 1 : financeExchangeRate,
      paidThroughDate: financePaidThrough || undefined,
      paymentMethod: financeMethod,
      externalReceiptNo: financeExternalReceiptNo || undefined,
      notes: financeNotes || undefined,
      requestId,
    });
    setSaving(false);
    if (result.success) {
      financeRequestIdRef.current = null;
      setFinanceAmountWan(0);
      setFinanceCurrency("XOF");
      setFinanceExchangeRate(1);
      setFinanceExternalReceiptNo("");
      setPanel("detail");
      router.refresh();
    } else {
      setError(result.error ?? (locale === "zh" ? "操作失败。" : "Échec de l'opération."));
    }
  };

  const inputClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-border-strong outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";

  const paymentKindLabel = (sourceType: string) => {
    const configured = getLeaseFinancialConfigBySourceType(sourceType);
    if (configured) return locale === "zh" ? configured.labelZh : configured.labelFr;
    if (sourceType === "lease_deposit_deduction") return locale === "zh" ? "押金扣款" : "Retenue sur dépôt";
    if (sourceType === "lease_rent_refund") return locale === "zh" ? "租金退款" : "Remboursement de loyer";
    if (sourceType === "lease_contract") return locale === "zh" ? "租金收入" : "Revenu de loyer";
    return locale === "zh" ? "财务记录" : "Écriture financière";
  };

  const openInsight = (key: LeaseStatFilter) => {
    setStatFilter(key);
    if (key === "dueSoon") setAttentionTab("upcoming");
    if (key === "overdue") setAttentionTab("overdue");
    setPanel("insight");
    setSelectedId(null);
  };
  const statBlocks: Array<{ key: LeaseStatFilter; label: string; value: string; dot: string; hint: string }> = [
    { key: "active", label: locale==="zh"?"生效合同":"Actifs", value: String(dashboardStats.active), dot: "bg-accentGreen-500", hint: locale==="zh"?"点击查看生效合同":"Voir les contrats actifs" },
    { key: "rent", label: locale==="zh"?"月租规模":"Loyer/mois", value: formatXof(dashboardStats.rent), dot: "bg-accentBlue-500", hint: locale==="zh"?"点击查看产生月租的合同":"Voir les loyers actifs" },
    { key: "dueSoon", label: locale==="zh"?"15天内应缴":"15j à payer", value: String(dashboardStats.dueSoon), dot: dashboardStats.dueSoon > 0 ? "bg-accentAmber-500" : "bg-muted-foreground/40", hint: locale==="zh"?"按合同缴费周期统计":"Selon le cycle du contrat" },
    { key: "currentDue", label: locale==="zh"?"累计应收未收":"Dû cumulé", value: formatXof(dashboardStats.currentDue), dot: "bg-accentPurple-500", hint: locale==="zh"?"每开始一个租赁月累计一期":"Chaque période commencée est due" },
    { key: "overdue", label: locale==="zh"?"逾期":"En retard", value: formatXof(dashboardStats.overdue), dot: dashboardStats.overdue > 0 ? "bg-accentRed-500" : "bg-muted-foreground/40", hint: `${dashboardStats.overdueContracts}${locale==="zh"?"份 · 点击查看":" · voir"}` },
  ];

  return (
    <OperationalPage
      eyebrow={locale === "zh" ? "租赁业务" : "Location"}
      title={locale === "zh" ? "长租合同" : "Contrats de location"}
      description={`${scopeLabel} · ${filteredByBuilding.length} ${locale === "zh" ? "份合同 · 以实际收款和未结应收为准" : "contrats · encaissements réels"}`}
      action={canCreate ? <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" />{t.form.newContract}</Button> : undefined}
    >

      <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-4" aria-label={locale === "zh" ? "项目与楼栋" : "Projet et bâtiment"}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground">{locale === "zh" ? "项目" : "Projet"}</span>
          <SegmentedControl value={project?.id ?? ""} onChange={changeProject} ariaLabel={locale === "zh" ? "项目切换" : "Choix du projet"} items={projects.map((p) => ({ value: p.id, label: projectLabel(p) }))} />
        </div>
        <div className="flex min-w-0 items-center gap-3 border-t pt-3">
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">{locale === "zh" ? "楼栋" : "Bâtiment"}</span>
          <select aria-label={locale === "zh" ? "选择楼栋" : "Choisir un bâtiment"} className={`${controlClass} min-w-0 flex-1 sm:hidden`} value={activeBuildingId} onChange={(e) => changeBuilding(e.target.value)}>
            <option value={ALL_BUILDINGS}>{locale === "zh" ? "全部楼栋" : "Tous les bâtiments"}</option>
            {projectBuildings.map((b) => <option key={b.id} value={b.id}>{b.display_name || b.code}</option>)}
          </select>
          <SegmentedControl value={activeBuildingId} onChange={changeBuilding} className="hidden min-w-0 sm:inline-flex" ariaLabel={locale === "zh" ? "楼栋切换" : "Choix du bâtiment"} items={[{ value: ALL_BUILDINGS, label: locale === "zh" ? "全部楼栋" : "Tous les bâtiments" }, ...projectBuildings.map((b) => ({ value: b.id, label: b.display_name || b.code }))]} />
        </div>
      </section>

      {/* ── Summary stats ── */}
      <MetricGrid columns={5}>
        {statBlocks.map(b => (
          <StatTile
            key={b.key}
            label={b.label}
            value={b.value}
            caption={panel === "insight" && statFilter === b.key ? (locale === "zh" ? "明细已打开" : "Détail ouvert") : b.hint}
            tone={b.key === "overdue" ? "red" : b.key === "dueSoon" ? "amber" : b.key === "currentDue" ? "purple" : b.key === "active" ? "green" : "blue"}
            onClick={() => {
              openInsight(b.key);
            }}
            active={panel === "insight" && statFilter === b.key}
          />
        ))}
      </MetricGrid>

      {/* ── Filter bar + new contract ── */}
      <FilterBar
        meta={
          <div className="flex items-center gap-3">
            <span>{filtered.length}/{filteredByBuilding.length} {locale === "fr" ? "contrats" : "份合同"}</span>
          </div>
        }
      >
        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel={locale === "zh" ? "合同状态筛选" : "Filtre statut contrat"}
          items={["all", "draft", "active", "terminated", "expired"].map((value) => ({
            value,
            label: value === "all" ? (locale === "fr" ? "En cours" : "当前") : t.contractStatus[value as keyof typeof t.contractStatus],
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
                const relatedReceivables = receivables.filter((row) => row.source_type === "lease_contract" && row.source_id === contract.id && row.status !== "cancelled" && row.management_status !== "historical_pending" && row.management_status !== "excluded");
                const accruedRent = contract.status === "active" ? resolveLeaseOverdue({
                  receivables: relatedReceivables,
                  today: todayStr,
                  paidThroughDate: contract.paid_through_date ?? null,
                  monthlyRentXof: Number(contract.monthly_rent_xof),
                  contractStatus: contract.status,
                  actualEndDate: contract.actual_end_date ?? null,
                }) : null;
                const displayedOutstanding = accruedRent?.amount ?? summary.outstanding;
                const endConfirmed = isContractEndConfirmed(contract);
                const daysLeft = endConfirmed ? Math.floor((new Date(contract.expected_end_date).getTime() - Date.now()) / 86400000) : null;
                const isLongTerm = endConfirmed && contract.expected_end_date >= "2099-01-01";
                const rent = Number(contract.monthly_rent_xof);
                const isManaged = unit ? isManagedLeaseUnit(unit) : false;
                const dataFlags = getLeaseDataFlags(contract, customer);
                const paidThrough = contract.paid_through_date;
                const paidPeriodStartsBeforeCutoff = paidThrough ? contract.start_date <= paidThrough : false;
                const hasOverdueRent = accruedRent !== null || summary.overdue > 0;
                const nextRentIsFuture = !hasOverdueRent && !!summary.nextDue && summary.nextDue >= todayStr;
                return (
                  <RoomCard key={contract.id} roomNo={unit?.unit_no ?? "-"} status={isManaged ? "managed" : "leased"} locale={locale}
                    onClick={() => openDetail(contract.id)}>
                    {/* Customer and tags */}
                    <div className="flex min-h-[62px] flex-col justify-start gap-2">
                      <p className="text-[13px] font-semibold leading-snug line-clamp-2 break-words" title={customer?.name ?? (locale==="zh"?"无客户":"Sans client")}>
                        {customer?.name ?? "—"}
                      </p>
                      <div className="flex min-h-5 flex-wrap items-center gap-1.5">
                        {isManaged && <Badge variant="success" className="h-5 bg-white/70 px-2 text-[10px] text-[#217365]">{locale === "zh" ? "代管" : "Gestion"}</Badge>}
                        {dataFlags.needsData && <Badge variant="warning" className="h-5 px-2 text-[10px]">{locale === "zh" ? "资料待补" : "A compléter"}</Badge>}
                        <Badge variant={statusVariant[contract.status]} className="h-5 px-2 text-[10px]">{t.contractStatus[contract.status as keyof typeof t.contractStatus]}</Badge>
                      </div>
                    </div>
                    {/* Rent + expiry */}
                    <div className="min-h-[50px] text-[11px] leading-relaxed text-[#5D7186]">
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
                    {displayedOutstanding > 0 && (
                      <p className={cn("text-[11px] font-medium leading-tight", hasOverdueRent ? "text-red-600" : "text-[#5D7186]")}>
                        {hasOverdueRent
                          ? (locale === "zh" ? "逾期未收" : "Impayé")
                          : nextRentIsFuture
                            ? (locale === "zh" ? "下期应收" : "Prochaine échéance")
                            : (locale === "zh" ? "待收" : "Dû")}: {formatXof(displayedOutstanding)}
                        {nextRentIsFuture ? ` · ${summary.nextDue}` : ""}
                      </p>
                    )}
                    {/* Action buttons */}
                    <div className="mt-auto flex justify-center gap-5 border-t border-[rgba(23,50,77,0.06)] pt-3">
                      <ActionBtn icon={Eye} label={locale==="zh"?"查看详情":"Voir les détails"} onClick={() => openDetail(contract.id)} />
                      <ActionBtn icon={DollarSign} label={locale==="zh"?"查看财务":"Voir les finances"} onClick={() => openDetail(contract.id, "finance")} />
                      <ActionBtn icon={FileText} label={locale==="zh"?"合同/打印":"Contrat / imprimer"} onClick={() => printLeaseContract({ contract, unit: unit ?? null, customer: customer ?? null, receivables: receivables.filter((row) => row.source_type === "lease_contract" && row.source_id === contract.id && row.status !== "cancelled") }, locale)} />
                    </div>
                  </RoomCard>
                );
              })}
            </div>
          </RoomBoard>
        ))
      )}

      {/* ── KPI insight panel ── */}
      {panel === "insight" && statFilter && (() => {
        const titleMap: Record<LeaseStatFilter, string> = {
          active: locale === "zh" ? "生效合同明细" : "Contrats actifs",
          rent: locale === "zh" ? "月租规模明细" : "Détail des loyers",
          dueSoon: locale === "zh" ? "15天内应缴" : "Échéances sous 15 jours",
          currentDue: locale === "zh" ? "累计应收未收" : "Montants cumulés dus",
          overdue: locale === "zh" ? "逾期明细" : "Détail des retards",
        };
        const activeRows = leaseInsightContracts.filter((row) => row.contract.status === "active");
        const rentRows = [...activeRows].sort((a, b) => Number(b.contract.monthly_rent_xof) - Number(a.contract.monthly_rent_xof));
        const noticeRows = statFilter === "dueSoon" ? leaseAttention.upcoming : actualOverdueRows;

        if (statFilter === "dueSoon" || statFilter === "overdue") {
          return (
            <PanelShell
              onClose={() => setPanel(null)}
              title={titleMap[statFilter]}
              badge={<Badge variant={statFilter === "overdue" ? "destructive" : "warning"}>{noticeRows.length}</Badge>}
            >
              <div className="space-y-4">
                <div className={cn("rounded-xl border p-3", statFilter === "overdue" ? "border-red-200 bg-red-50/50" : "border-amber-200 bg-amber-50/50")}>
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "合计金额" : "Total"}</p>
                  <p className={cn("mt-1 text-xl font-semibold tabular-nums", statFilter === "overdue" ? "text-red-700" : "text-amber-700")}>
                    {formatXof(noticeRows.reduce((sum, row) => sum + row.amount, 0))}
                  </p>
                </div>
                {noticeRows.length === 0 ? (
                  <EmptyState title={locale === "zh" ? "当前没有需要跟进的合同" : "Aucun contrat à suivre"} />
                ) : (
                  <div className="space-y-2.5">
                    {noticeRows.map((row) => (
                      <div key={row.contract.id} className={cn("rounded-xl border p-3.5", row.kind === "overdue" ? "border-red-200 bg-red-50/40" : "border-amber-200 bg-amber-50/40")}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">{row.buildingName} · {row.unit.unit_no}</span>
                              <Badge variant={row.kind === "overdue" ? "destructive" : "warning"} className="h-5 px-2 text-[10px]">
                                {row.kind === "overdue"
                                  ? (row.amountIsEstimated ? (locale === "zh" ? "合同累计" : "Calcul contrat") : `${locale === "zh" ? "逾期" : "Retard"} ${Math.abs(row.days)}${locale === "zh" ? "天" : "j"}`)
                                  : `${row.days}${locale === "zh" ? "天后应缴" : "j"}`}
                              </Badge>
                            </div>
                            <p className="mt-1 truncate text-[13px] font-medium text-foreground">{row.customer?.name ?? (locale === "zh" ? "客户待补" : "Client à compléter")}</p>
                          </div>
                          <p className={cn("shrink-0 text-sm font-semibold tabular-nums", row.kind === "overdue" ? "text-red-700" : "text-amber-700")}>{formatXof(row.amount)}</p>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />{locale === "zh" ? "应缴日" : "Échéance"} {row.dueDate}</span>
                          <span className="text-right">{row.amountIsEstimated ? (locale === "zh" ? "按已缴至日期逐月累计" : "Cumul selon la date payée") : (locale === "zh" ? "未结应收" : "Créance ouverte")}</span>
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
          );
        }

        if (statFilter === "currentDue") {
          return (
            <PanelShell onClose={() => setPanel(null)} title={titleMap[statFilter]} badge={<Badge variant="secondary">{currentDueRows.length}</Badge>}>
              <div className="space-y-4">
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3">
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "截至今日累计应收未收合计" : "Total cumulé dû à ce jour"}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-purple-700">{formatXof(currentDueRows.reduce((sum, row) => sum + row.amount, 0))}</p>
                </div>
                {currentDueRows.length === 0 ? (
                  <EmptyState title={locale === "zh" ? "当前没有累计未收款" : "Aucun montant cumulé dû"} />
                ) : (
                  <div className="space-y-2.5">
                    {currentDueRows.map((row) => (
                      <div key={row.contract.id} className="rounded-xl border border-border bg-card p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{row.buildingName} · {row.unit.unit_no} · {row.customer?.name ?? (locale === "zh" ? "客户待补" : "Client à compléter")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{locale === "zh" ? "首个未覆盖日" : "Première échéance"} {row.dueDate}</p>
                          </div>
                          <p className="shrink-0 text-sm font-semibold tabular-nums text-purple-700">{formatXof(row.amount)}</p>
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
          );
        }

        const contractRows = statFilter === "rent" ? rentRows : activeRows;
        return (
          <PanelShell onClose={() => setPanel(null)} title={titleMap[statFilter]} badge={<Badge variant="success">{contractRows.length}</Badge>}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border bg-muted/35 p-3">
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "合同数" : "Contrats"}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{contractRows.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/35 p-3">
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "折合月租合计" : "Loyer total converti"}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{formatXof(contractRows.reduce((sum, row) => sum + Number(row.contract.monthly_rent_xof), 0))}</p>
                </div>
              </div>
              {contractRows.length === 0 ? (
                <EmptyState title={locale === "zh" ? "当前没有合同" : "Aucun contrat"} />
              ) : (
                <div className="space-y-2.5">
                  {contractRows.map((row) => (
                    <div key={row.contract.id} className="rounded-xl border border-border bg-card p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{row.unit?.unit_no ?? "-"} · {row.customer?.name ?? (locale === "zh" ? "客户待补" : "Client à compléter")}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{locale === "zh" ? "已缴至" : "Payé au"} {row.contract.paid_through_date ?? (locale === "zh" ? "待补" : "À compléter")}</p>
                        </div>
                        <div className="shrink-0 text-right tabular-nums">
                          <p className="text-sm font-semibold">{formatXof(Number(row.contract.monthly_rent_xof))}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>{locale === "zh" ? "起租" : "Début"} {row.contract.start_date}</span>
                        <span className="text-right">{locale === "zh" ? "应收" : "Dû"} {formatXof(row.summary.outstanding)}</span>
                      </div>
                      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => openDetail(row.contract.id)}>
                        {locale === "zh" ? "查看合同" : "Voir le contrat"}<ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PanelShell>
        );
      })()}

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
                { value: "upcoming", label: `${locale === "zh" ? "15天内应缴" : "Sous 15 jours"} ${leaseAttention.upcoming.length}` },
              ]}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {locale === "zh" ? "依据租金已缴至日期逐月累计；每开始一个租赁月即计入一期，并与现有应收、付款合并核对。" : "Cumul mensuel depuis la date payée, rapproché des créances et paiements existants."}
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
                      <span className="text-right">{row.amountIsEstimated ? (locale === "zh" ? "按已缴至日期逐月累计" : "Cumul selon la date payée") : (locale === "zh" ? "未结应收" : "Créance ouverte")}</span>
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
          <div>
            <label className={labelClass}>{locale === "zh" ? "合同编号（自动生成）" : "N° de contrat (automatique)"}</label>
            <input type="text" value={generatedLeaseContractNo} readOnly placeholder={locale === "zh" ? "选择房源和起租日期后生成" : "Choisissez le logement et la date"} className={cn(inputClass, "bg-muted/50 text-muted-foreground")} />
          </div>
          <div><label className={labelClass}>{t.form.unit} *</label><select value={fUnitId} onChange={e=>setFUnitId(e.target.value)} className={inputClass}><option value="">{t.form.noUnit}</option>{availableUnits.map(u=><option key={u.id} value={u.id}>{buildingMap.get(u.building_id)?.display_name} · {u.unit_no} ({u.floor_label}){isManagedLeaseUnit(u) ? (locale === "zh" ? " · 已售代管" : " · Gestion") : ""}</option>)}</select></div>
          <div><label className={labelClass}>{t.form.customer} *</label><select value={fCustomerId} onChange={e=>setFCustomerId(e.target.value)} className={inputClass}><option value="">{t.form.noCustomer}</option>{customers.filter(cc=>!cc.is_blacklisted).map(cc=><option key={cc.id} value={cc.id}>{cc.name} {cc.phone?`(${cc.phone})`:""}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t.form.startDate}</label><DateInput value={fStartDate} onChangeValue={setFStartDate} className={inputClass}/></div><div><label className={labelClass}>{t.form.expectedEndDate}</label><DateInput value={fEndDate} onChangeValue={setFEndDate} className={inputClass}/></div></div>
          <div className="grid grid-cols-3 gap-3"><div><label className={labelClass}>{t.form.paymentCycle}</label><select value={fCycle} onChange={e=>setFCycle(e.target.value)} className={inputClass}>{paymentCycles.map(pc=><option key={pc} value={pc}>{t.paymentCycle[pc as keyof typeof t.paymentCycle]}</option>)}</select></div><div><label className={labelClass}>{t.form.paymentDay}</label><input type="number" min={1} max={31} value={fPayDay} onChange={e=>setFPayDay(Number(e.target.value))} className={inputClass}/></div><div><label className={labelClass}>{t.form.monthlyRent}</label><input type="number" value={fRent} onChange={e=>setFRent(Number(e.target.value))} className={inputClass}/></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>{t.form.deposit}</label><input type="number" value={fDeposit} onChange={e=>setFDeposit(Number(e.target.value))} className={inputClass}/></div><div><label className={labelClass}>{t.form.rentFreeDays}</label><input type="number" value={fFreeDays} onChange={e=>setFFreeDays(Number(e.target.value))} className={inputClass}/></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fDepositReceived} disabled={!canRecordFinance} onChange={e=>setFDepositReceived(e.target.checked)} className="h-4 w-4 rounded border"/>{t.form.depositReceived}{!canRecordFinance&&(locale==="zh"?"（请由财务账号登记实收）":" (à enregistrer par la finance)")}</label>
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
            <div><dt className="text-xs text-muted-foreground">{locale === "zh" ? "楼栋 / 房号" : "Bâtiment / Lot"}</dt><dd className="font-medium">{selectedUnit ? buildingMap.get(selectedUnit.building_id)?.display_name || buildingMap.get(selectedUnit.building_id)?.code || "-" : "-"} · {selectedUnit?.unit_no??"-"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.customer}</dt><dd className="font-medium">{selectedCustomer?.name??"-"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t.form.startDate}</dt><dd>{selected.start_date}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{locale === "zh" ? "正式合同到期日" : t.form.expectedEndDate}</dt><dd>{isContractEndConfirmed(selected)?selected.expected_end_date:(locale==="zh"?"未确认":"Non confirmée")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{locale==="zh"?"缴租截至日":"Loyer payé au"}</dt><dd className={cn(selected.paid_through_date&&isPaidThroughOverdue(selected)?"font-medium text-red-600":"font-medium text-emerald-700")}>{selected.paid_through_date??(locale==="zh"?"待补":"À compléter")}</dd></div>
            {selected.actual_end_date&&<div><dt className="text-xs text-muted-foreground">{t.form.actualEndDate}</dt><dd>{selected.actual_end_date}</dd></div>}
            <div><dt className="text-xs text-muted-foreground">{t.form.paymentCycle}</dt><dd>{t.paymentCycle[selected.payment_cycle as keyof typeof t.paymentCycle]} / {selected.payment_day}{locale === "zh" ? "号" : ""}</dd></div>
            <div>
              <dt className="text-xs text-muted-foreground">{t.form.monthlyRent}</dt>
              <dd className="font-semibold">{formatXof(Number(selected.monthly_rent_xof))}</dd>
              {selectedOriginalMonthlyRent && (
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  {locale === "zh" ? "原币约 " : "Devise d'origine env. "}{formatMoney(selectedOriginalMonthlyRent.amount, selectedOriginalMonthlyRent.currency, locale)}/{locale === "zh" ? "月" : "mois"}
                </dd>
              )}
            </div>
            <div><dt className="text-xs text-muted-foreground">{t.form.deposit}</dt><dd>{formatXof(Number(selected.deposit_amount_xof))} {selected.deposit_received?t.form.depositPaid:t.form.depositUnpaid}</dd></div>
            {selected.rent_free_days>0&&<div><dt className="text-xs text-muted-foreground">{t.form.rentFreeDays}</dt><dd>{selected.rent_free_days}{locale === "zh" ? "天" : " jours"}</dd></div>}
            {selected.signer_name&&<div><dt className="text-xs text-muted-foreground">{t.form.signerName}</dt><dd>{selected.signer_name}</dd></div>}
          </dl>
          {canActivate&&selected.status==="draft"&&<Button className="w-full" variant="default" onClick={()=>handleActivate(selected.id)} disabled={saving}>{saving?"...":t.form.activateContract}</Button>}
          {canMoveOut&&selected.status==="active"&&<Button className="w-full" variant="outline" onClick={()=>openMoveOut(selected.id)}><LogOut className="mr-1 inline h-4 w-4"/>{t.settlement.moveOut}</Button>}
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

          {/* Payment history */}
          <div ref={financeSectionRef} className={cn("scroll-mt-20 border-t pt-4", detailSection === "finance" && "-mx-2 rounded-xl px-2 ring-2 ring-primary/20")}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">{locale === "zh" ? "财务记录" : "Écritures financières"}</h4>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium tabular-nums">
                <span className="text-emerald-700">{locale === "zh" ? "收入" : "Revenus"} {formatXof(totalIncome)}</span>
                <span className="text-red-600">{locale === "zh" ? "支出" : "Dépenses"} {formatXof(totalExpense)}</span>
                <span className="text-slate-700">{locale === "zh" ? "净额" : "Net"} {formatXof(netFinancial)}</span>
              </div>
              </div>
              {canRecordFinance && <Button size="sm" variant="outline" onClick={openFinanceEntry}>
                <Plus className="h-3.5 w-3.5" />{locale === "zh" ? "新增记录" : "Ajouter"}
              </Button>}
            </div>
            {contractPayments.length === 0 ? (
              <p className="text-xs text-muted-foreground">{locale === "zh" ? "暂无财务记录" : "Aucune écriture financière"}</p>
            ) : (
              <div className="space-y-1.5">
                {contractPayments.map((payment) => {
                  const isExpense = isLeaseFinancialExpenseSourceType(payment.source_type);
                  const recordedOriginal = getRecordedOriginalPayment(payment);
                  return (
                  <div key={payment.id} className={cn("rounded-lg border px-3 py-2.5 text-[13px]", isExpense ? "border-red-100 bg-red-50/50" : "border-emerald-100 bg-emerald-50/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("font-semibold", isExpense ? "text-red-700" : "text-emerald-800")}>{paymentKindLabel(payment.source_type)}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{payment.payment_date}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={payment.receipt_no ?? ""}>
                          {payment.receipt_no || (locale === "zh" ? "无收据号" : "Sans reçu")}
                        </p>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className={cn("font-semibold", isExpense ? "text-red-600" : "text-emerald-700")}>
                          {isExpense ? "- " : ""}{recordedOriginal ? formatMoney(recordedOriginal.amount, recordedOriginal.currency, locale) : payment.currency === "XOF" ? formatXof(Number(payment.amount)) : formatMoney(Number(payment.amount), payment.currency, locale)}
                        </p>
                        {(payment.currency !== "XOF" || recordedOriginal) && <p className="mt-0.5 text-[11px] text-muted-foreground">{locale === "zh" ? "折合" : "Équiv."} {formatXof(paymentAmountXof(payment))}</p>}
                      </div>
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>

        </div>
      </PanelShell>)}

      {canRecordFinance && panel === "financeEntry" && selected && (
        <PanelShell
          onClose={() => setPanel("detail")}
          title={locale === "zh" ? "新增长租财务记录" : "Nouvelle écriture financière"}
          badge={<Badge variant="secondary">{selectedUnit?.unit_no ?? "-"}</Badge>}
        >
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/35 p-3 text-sm">
              <p className="font-semibold">{selected.contract_no}</p>
              <p className="mt-1 text-xs text-muted-foreground">{selectedUnit?.unit_no ?? "-"} · {selectedCustomer?.name ?? "-"}</p>
            </div>
            <div>
              <label className={labelClass}>{locale === "zh" ? "业务类型" : "Type d'opération"} *</label>
              <select value={financeType} onChange={(event) => setFinanceType(event.target.value as LeaseFinancialBusinessType)} className={inputClass}>
                {LEASE_FINANCIAL_BUSINESS_TYPES.map((type) => {
                  const config = LEASE_FINANCIAL_BUSINESS_CONFIG[type];
                  return <option key={type} value={type}>{locale === "zh" ? config.labelZh : config.labelFr}</option>;
                })}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{locale === "zh" ? "业务日期" : "Date"} *</label>
                <DateInput value={financeDate} onChangeValue={setFinanceDate} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>{financeCurrency === "XOF" ? (locale === "zh" ? "金额（万 FCFA）" : "Montant (10k FCFA)") : `${locale === "zh" ? "原币金额" : "Montant d'origine"} (${financeCurrency})`} *</label>
                <input type="number" min={0} step="0.01" value={financeAmountWan || ""} onChange={(event) => setFinanceAmountWan(Number(event.target.value))} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{locale === "zh" ? "原始币种" : "Devise d'origine"} *</label>
                <select value={financeCurrency} onChange={(event) => { const currency = event.target.value as CurrencyCode; setFinanceCurrency(currency); setFinanceExchangeRate(currency === "XOF" ? 1 : 0); }} className={inputClass}>
                  <option value="XOF">XOF / FCFA</option>
                  <option value="CNY">CNY / RMB</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>{locale === "zh" ? `历史汇率（1 ${financeCurrency} = XOF）` : `Taux historique (1 ${financeCurrency} = XOF)`} *</label>
                <input type="number" min={financeCurrency === "XOF" ? 1 : 0.000001} step="0.000001" value={financeCurrency === "XOF" ? 1 : financeExchangeRate || ""} disabled={financeCurrency === "XOF"} onChange={(event) => setFinanceExchangeRate(Number(event.target.value))} className={cn(inputClass, financeCurrency === "XOF" && "bg-muted/50")} />
              </div>
            </div>
            {financeCurrency !== "XOF" && financeAmountWan > 0 && financeExchangeRate > 0 && (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {locale === "zh" ? "折合入账" : "Équivalent comptable"}：{formatXof(financeAmountWan * financeExchangeRate)}
              </p>
            )}
            {getLeaseFinancialConfig(financeType).requiresPaidThrough && (
              <div>
                <label className={labelClass}>{locale === "zh" ? "租金已缴至" : "Loyer payé au"} *</label>
                <DateInput value={financePaidThrough} onChangeValue={setFinancePaidThrough} className={inputClass} />
              </div>
            )}
            <div>
              <label className={labelClass}>{locale === "zh" ? "收付方式" : "Mode de paiement"}</label>
              <select value={financeMethod} onChange={(event) => setFinanceMethod(event.target.value as typeof financeMethod)} className={inputClass}>
                <option value="other">{locale === "zh" ? "其他/待补" : "Autre / à compléter"}</option>
                <option value="check">{locale === "zh" ? "支票" : "Chèque"}</option>
                <option value="cash">{locale === "zh" ? "现金" : "Espèces"}</option>
                <option value="bank_transfer">{locale === "zh" ? "银行转账" : "Virement"}</option>
                <option value="offset">{locale === "zh" ? "抵扣/转款" : "Compensation"}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{locale === "zh" ? "自动业务编号" : "Référence automatique"}</label>
              <input
                type="text"
                readOnly
                value={`${buildLeaseFinancialReferencePrefix(
                  selectedUnit ? buildingMap.get(selectedUnit.building_id)?.code ?? "SACSI" : "SACSI",
                  selectedUnit?.unit_no ?? "UNIT",
                  selected.contract_no,
                  financeType,
                  financeDate,
                )}${locale === "zh" ? "-自动顺序" : "-auto"}`}
                className={cn(inputClass, "bg-muted/50 text-xs text-muted-foreground")}
              />
            </div>
            <div>
              <label className={labelClass}>{locale === "zh" ? "原始收据/银行凭证号（可选）" : "N° reçu / banque d'origine (facultatif)"}</label>
              <input type="text" value={financeExternalReceiptNo} onChange={(event) => setFinanceExternalReceiptNo(event.target.value)} placeholder={locale === "zh" ? "仅作为凭证保存，不参与系统编号" : "Conservé comme justificatif uniquement"} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{locale === "zh" ? "备注" : "Note"}</label>
              <textarea rows={3} value={financeNotes} onChange={(event) => setFinanceNotes(event.target.value)} placeholder={locale === "zh" ? "可填写对应月份、原始凭证或特殊说明" : "Période, justificatif ou remarque"} className={inputClass} />
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs leading-relaxed text-blue-800">
              {locale === "zh"
                ? "租金收入会同步“已缴至日期”并优先冲抵未结应收；押金收入会同步合同押金状态；支出类不会计入收入。"
                : "Le loyer met à jour la date payée et règle d'abord les créances ouvertes. Le dépôt met à jour le statut du contrat."}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full" onClick={handleFinanceEntry} disabled={saving}>
              {saving ? "..." : locale === "zh" ? "确认保存财务记录" : "Enregistrer"}
            </Button>
          </div>
        </PanelShell>
      )}

      {/* ── Move-out Panel ── */}
      {panel==="moveout"&&selected&&(<PanelShell onClose={()=>setPanel(null)} title={t.settlement.moveOut}>{/* form kept identical to original */}{/*...*/}<div className="space-y-4"><div><label className={labelClass}>{t.form.actualEndDate}</label><DateInput value={moEndDate} onChangeValue={setMoEndDate} className={inputClass}/></div><div><label className={labelClass}>{locale==="zh"?"本次已实际补收租金（XOF）":"Loyer effectivement reçu (XOF)"}</label><input type="number" value={moUnpaid} onChange={e=>setMoUnpaid(Number(e.target.value))} className={inputClass}/></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moUtility} onChange={e=>setMoUtility(e.target.checked)}/>{locale==="zh"?"水电已结清":"Charges reglees"}</label><div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-muted-foreground">{locale==="zh"?"押金扣除（非租金抵扣，XOF）":"Retenue hors loyer (XOF)"}</label><input type="number" value={moDeduction} onChange={e=>setMoDeduction(Number(e.target.value))} className={inputClass}/></div><div><label className="text-xs text-muted-foreground">{locale==="zh"?"本次实际退还押金（XOF）":"Dépôt effectivement remboursé (XOF)"}</label><input type="number" value={moRefund} onChange={e=>setMoRefund(Number(e.target.value))} className={inputClass}/></div></div><p className="text-xs text-muted-foreground">{locale==="zh"?"补收款只冲抵已有到期欠租；欠款不会自动记为已收。退还与扣除须等于核实后的剩余实收押金。":"Seuls les encaissements réels règlent les impayés existants. Le dépôt doit être vérifié."}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moCollectedConfirmed} onChange={e=>setMoCollectedConfirmed(e.target.checked)}/>{locale==="zh"?"我确认上述补收和退还均已实际发生":"Je confirme les encaissements et remboursements réels"}</label><div><label className={labelClass}>{locale==="zh"?"实际收退款方式（不同方式请分开登记后再结算）":"Mode de paiement réel"}</label><select className={inputClass} value={moMethod} onChange={e=>setMoMethod(e.target.value as typeof moMethod)}><option value="">{locale==="zh"?"请选择":"Choisir"}</option><option value="cash">{locale==="zh"?"现金":"Espèces"}</option><option value="check">{locale==="zh"?"支票":"Chèque"}</option><option value="bank_transfer">{locale==="zh"?"银行转账":"Virement"}</option><option value="offset">{locale==="zh"?"抵扣/转款":"Compensation"}</option><option value="other">{locale==="zh"?"其他":"Autre"}</option></select></div>{error&&<p className="text-sm text-red-600">{error}</p>}<Button className="w-full" onClick={handleMoveOut} disabled={saving}>{saving?"...":locale==="zh"?"确认退租":"Confirmer"}</Button></div></PanelShell>)}
    </OperationalPage>
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
  return <RightDrawer open title={title} badge={badge} actions={actions} onClose={onClose}>{children}</RightDrawer>;
}
