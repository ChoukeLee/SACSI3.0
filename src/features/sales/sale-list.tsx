"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  DollarSign,
  FileText,
  CalendarPlus,
  TrendingUp,
  AlertTriangle,
  Eye,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { contractStatusVariant as statusVariant } from "@/lib/status-styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { EmptyState } from "@/components/empty-state";
import {
  FilterBar,
  MetricGrid,
  OperationalPage,
  RightDrawer,
  SegmentedControl,
  StatTile,
} from "@/components/ui/operational";
import type {
  SaleContractRow,
  SalePaymentScheduleRow,
  UnitRow,
  CustomerRow,
  PaymentRow,
  ReceivableRow,
} from "@/types/database";
import { runFinanceRequest } from "@/features/finance/finance-request";
import {
  createSaleContract,
  recordSalePaymentAtomic,
  addFlexibleInstallment,
  updateTransferStatus,
  terminateSaleContract,
} from "./actions";
import { buildSaleContractNumber } from "@/lib/contract-number";
import { printSaleContract } from "@/features/print";
import { computeFinanceMetrics } from "@/features/finance/metrics";
import { ContractListControls, ContractTable } from "@/features/contracts/contract-table";
import {
  buildContractReceivableSummaries,
  formatContractXof,
  EMPTY_CONTRACT_RECEIVABLE_SUMMARY,
  matchesContractSearch,
  type ContractTableRow,
} from "@/features/contracts/contract-list-model";
import {
  classifyContractCashPayment,
  summarizeContractCash,
} from "@/features/contracts/contract-cash-model";
import { resolveContractProjectLink } from "@/features/contracts/project-link";
import { useContractWorkspace } from "@/features/contracts/use-workspace";
import type { WorkspaceData } from "@/features/contracts/workspace-model";
import { workspaceQueryKey } from "@/features/contracts/workspace-model";
import { useContractPrinter } from "@/features/contracts/use-contract-printer";

interface SaleListProps {
  workspace?: WorkspaceData;
  initialProject?: string;
  contracts: SaleContractRow[];
  schedules: SalePaymentScheduleRow[];
  units: UnitRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  buildings: { id: string; code: string; display_name: string; project_id?: string | null }[];
  locale: Locale;
  canCreate?: boolean;
  canRecordFinance?: boolean;
  canManage?: boolean;
  canTerminate?: boolean;
}
type PanelType = "new" | "detail" | "insight" | null;
type SaleStatKey = "active" | "total" | "received" | "receivable" | "due" | "overdue" | "transfer";
type SaleStatusFilter = "current" | "all" | "terminated" | "expired";
const SALE_RECEIPT_SOURCE_TYPES = new Set(["sale", "sale_contract", "property_fee", "parking_fee"]);

function getSaleDataFlags(contract: SaleContractRow, customer?: CustomerRow | null) {
  return {
    needsData:
      contract.payment_plan_type === "legacy_pending" ||
      Number(contract.total_amount_xof) <= 0 ||
      customer?.name.includes("资料待补") ||
      customer?.notes?.includes("legacy_placeholder=true"),
    needsNumberCleanup: contract.contract_no.startsWith("LEGACY-SALE-"),
  };
}

function SaleActionBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
      aria-label={label}
      title={label}
    >
      <Icon className="h-[14px] w-[14px]" strokeWidth={1.5} />
    </button>
  );
}

export function SaleList({
  workspace: initialWorkspace,
  initialProject,
  contracts: initialContracts,
  schedules: initialSchedules,
  units: initialUnits,
  customers: initialCustomers,
  payments: initialPayments,
  receivables: initialReceivables,
  buildings,
  locale,
  canCreate = true,
  canRecordFinance = true,
  canManage = true,
  canTerminate = true,
}: SaleListProps) {
  const router = useRouter();
  const workspace = useContractWorkspace(initialWorkspace);
  const contracts = (workspace.data?.contracts ?? initialContracts) as SaleContractRow[];
  const units = workspace.data?.units ?? initialUnits;
  const customers = workspace.data?.customers ?? initialCustomers;
  const payments = workspace.data?.payments ?? initialPayments;
  const receivables = workspace.data?.receivables ?? initialReceivables;
  const schedules = workspace.data?.schedules ?? initialSchedules;
  const t = dictionaries[locale].sales;
  const formatXof = (amount: number) => formatContractXof(amount, locale);
  const [statFilter, setStatFilter] = useState<SaleStatKey | null>(null);
  const [statusFilter, setStatusFilter] = useState<SaleStatusFilter>("current");
  const [contractView, setContractView] = useState<"table" | "rooms">("table");
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<PanelType>(null);
  useEffect(() => {
    if (workspace.enabled && contractView === "table" && panel !== "insight")
      workspace.closeScope();
  }, [workspace.enabled, workspace.closeScope, contractView, panel]);
  const [detailSection, setDetailSection] = useState<"overview" | "finance">("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [writeConfirmed, setWriteConfirmed] = useState(false);
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
  const [payScheduleId, setPayScheduleId] = useState("");
  const [payAmount, setPayAmount] = useState(0);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payReceiptNo, setPayReceiptNo] = useState("");
  const createRequestIdRef = useRef<string | null>(null);
  const [flexDueDate, setFlexDueDate] = useState("");
  const [flexAmount, setFlexAmount] = useState(0);
  const [trStatus, setTrStatus] = useState("not_started");
  const [trDate, setTrDate] = useState("");
  const [trCertNo, setTrCertNo] = useState("");
  const [termReason, setTermReason] = useState("");
  const [showFlexForm, setShowFlexForm] = useState(false);
  const financeSectionRef = useRef<HTMLDivElement | null>(null);
  const requestedProjectId = resolveContractProjectLink(buildings, initialProject);
  const scopeBuildingIds = useMemo(
    () =>
      new Set(
        buildings
          .filter((building) => !requestedProjectId || building.project_id === requestedProjectId)
          .map((building) => building.id),
      ),
    [buildings, requestedProjectId],
  );

  // Building switcher
  const [activeBuildingId, setActiveBuildingId] = useState<string>(() =>
    requestedProjectId
      ? ""
      : (buildings.find((building) => building.code === "SACSI11")?.id ?? buildings[0]?.id ?? ""),
  );
  const printer = useContractPrinter(
    workspace.query
      ? workspaceQueryKey(workspace.query)
      : `${requestedProjectId}/${activeBuildingId}`,
    locale,
    initialWorkspace,
  );
  useEffect(() => {
    if (!requestedProjectId) return;
    setActiveBuildingId("");
    setPanel(null);
    setSelectedId(null);
    setFUnitId("");
  }, [requestedProjectId]);
  useEffect(() => {
    if (workspace.enabled)
      workspace.change({
        projectId: requestedProjectId ?? "",
        buildingId: activeBuildingId,
        status: statusFilter,
        search,
        locale,
        page: 1,
      });
  }, [
    workspace.enabled,
    workspace.change,
    requestedProjectId,
    activeBuildingId,
    statusFilter,
    search,
    locale,
  ]);

  const unitBuildingMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.building_id);
    return m;
  }, [units]);

  const filteredByBuilding = useMemo(() => {
    return contracts.filter(
      (contract) =>
        scopeBuildingIds.has(unitBuildingMap.get(contract.unit_id) ?? "") &&
        (!activeBuildingId || unitBuildingMap.get(contract.unit_id) === activeBuildingId) &&
        (statusFilter === "all" ||
          (statusFilter === "current" &&
            contract.status !== "terminated" &&
            contract.status !== "expired") ||
          contract.status === statusFilter),
    );
  }, [contracts, activeBuildingId, statusFilter, unitBuildingMap, scopeBuildingIds]);

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const contractSummaryMap = useMemo(
    () =>
      new Map([
        ...Object.entries(workspace.data?.summaries ?? {}),
        ...buildContractReceivableSummaries(
          receivables,
          "sale_contract",
          new Date().toISOString().slice(0, 10),
        ),
      ]),
    [receivables, workspace.data?.summaries],
  );
  const tableRows = useMemo<ContractTableRow[]>(
    () =>
      filteredByBuilding
        .filter(
          (contract) =>
            !workspace.enabled ||
            workspace.pageData?.contracts.some((row) => row.id === contract.id),
        )
        .map((contract) => {
          const unit = unitMap.get(contract.unit_id);
          const customer = customerMap.get(contract.customer_id);
          const summary = contractSummaryMap.get(contract.id) ?? EMPTY_CONTRACT_RECEIVABLE_SUMMARY;
          const transferLabel =
            locale === "zh"
              ? { not_started: "未开始过户", in_progress: "过户办理中", completed: "过户完成" }
              : {
                  not_started: "Transfert non commencé",
                  in_progress: "Transfert en cours",
                  completed: "Transfert terminé",
                };
          return {
            id: contract.id,
            contractNo: contract.contract_no,
            building: buildings.find((row) => row.id === unit?.building_id)?.display_name ?? "—",
            unit: unit?.unit_no ?? "—",
            customer: customer?.name ?? (locale === "zh" ? "客户待补" : "Client à compléter"),
            searchText: customer?.phone ?? "",
            periodStart: contract.signed_date,
            periodLabel: contract.signed_date,
            periodDetail: contract.transfer_date
              ? `${locale === "zh" ? "过户" : "Transfert"} ${contract.transfer_date}`
              : undefined,
            amountXof:
              Number(contract.total_amount_xof) > 0 ? Number(contract.total_amount_xof) : null,
            amountDetail:
              contract.total_amount_confirmed === false
                ? locale === "zh"
                  ? "合同总额待核实"
                  : "Total à confirmer"
                : "XOF",
            balanceXof: summary.count ? summary.outstanding : null,
            balanceDetail: summary.count
              ? summary.overdue > 0
                ? `${locale === "zh" ? "逾期" : "Retard"} ${formatXof(summary.overdue)}`
                : summary.nextDue
                  ? `${locale === "zh" ? "下次到期" : "Échéance"} ${summary.nextDue}`
                  : locale === "zh"
                    ? "已建应收已结清"
                    : "Créances soldées"
              : locale === "zh"
                ? "暂无已核应收"
                : "Aucune créance vérifiée",
            balanceOverdue: summary.overdue > 0,
            status: contract.status,
            statusLabel: t.contractStatus[contract.status as keyof typeof t.contractStatus],
            secondaryLabel:
              transferLabel[contract.transfer_status as keyof typeof transferLabel] ??
              (locale === "zh" ? "过户状态待核实" : "Transfert à vérifier"),
            needsReview: Boolean(getSaleDataFlags(contract, customer).needsData),
          };
        }),
    [
      filteredByBuilding,
      unitMap,
      customerMap,
      contractSummaryMap,
      buildings,
      locale,
      t.contractStatus,
      workspace.enabled,
      workspace.pageData?.contracts,
    ],
  );
  const searchedTableRows = useMemo(
    () =>
      workspace.enabled ? tableRows : tableRows.filter((row) => matchesContractSearch(row, search)),
    [tableRows, search, workspace.enabled],
  );
  const visibleContracts = useMemo(() => {
    if (workspace.enabled && contractView === "rooms")
      return filteredByBuilding.filter((row) =>
        workspace.scopeData?.contracts.some((c) => c.id === row.id),
      );
    const ids = new Set(searchedTableRows.map((row) => row.id));
    return filteredByBuilding.filter((contract) => ids.has(contract.id));
  }, [filteredByBuilding, searchedTableRows, workspace.enabled, workspace.scopeData, contractView]);
  const selectedNewUnit = useMemo(() => unitMap.get(fUnitId), [fUnitId, unitMap]);
  const generatedSaleContractNo = useMemo(() => {
    if (!selectedNewUnit || !fSignedDate) return "";
    const building = buildings.find((item) => item.id === selectedNewUnit.building_id);
    return buildSaleContractNumber(building?.code ?? "SACSI", selectedNewUnit.unit_no, fSignedDate);
  }, [buildings, fSignedDate, selectedNewUnit]);

  const groupedContracts = useMemo(() => {
    const g = new Map<string, SaleContractRow[]>();
    for (const c of visibleContracts) {
      const unit = unitMap.get(c.unit_id);
      const floor = normalizeFloorLabel(unit?.floor_label ?? null, unit?.unit_no ?? "");
      const key = `${unit?.building_id ?? ""}|${floor}`;
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(c);
    }
    return Array.from(g.entries())
      .map(
        ([floor, floorContracts]) =>
          [
            !activeBuildingId
              ? `${buildings.find((building) => building.id === floor.split("|")[0])?.display_name ?? ""} · ${floor.split("|")[1]}`
              : floor.split("|")[1],
            [...floorContracts].sort((a, b) => {
              const aUnit = unitMap.get(a.unit_id)?.unit_no ?? "";
              const bUnit = unitMap.get(b.unit_id)?.unit_no ?? "";
              return aUnit.localeCompare(bUnit, undefined, { numeric: true });
            }),
          ] as [string, SaleContractRow[]],
      )
      .sort((a, b) => floorSortValue(a[0]) - floorSortValue(b[0]));
  }, [visibleContracts, unitMap, activeBuildingId, buildings]);

  const selected =
    selectedId &&
    (!workspace.enabled ||
      (!workspace.unavailable && workspace.detailData?.contracts[0]?.id === selectedId))
      ? contracts.find((c) => c.id === selectedId)
      : null;
  const selectedUnit = selected ? units.find((u) => u.id === selected.unit_id) : null;
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer_id) : null;
  const selectedBuilding = selectedUnit
    ? buildings.find((building) => building.id === selectedUnit.building_id)
    : null;

  const dashboardStats = useMemo(() => {
    if (workspace.enabled && workspace.pageData) return workspace.pageData.stats;
    const buildingContractIds = new Set(filteredByBuilding.map((c) => c.id));
    const active = filteredByBuilding.filter((c) => c.status === "active");
    const today = new Date().toISOString().slice(0, 10);
    const related = receivables.filter(
      (row) =>
        row.source_type === "sale_contract" &&
        row.source_id &&
        buildingContractIds.has(row.source_id),
    );
    const metrics = computeFinanceMetrics(related, { asOfDate: today });
    const due = computeFinanceMetrics(related, { scope: "asOf", asOfDate: today });
    const total = active.reduce((s, c) => s + Number(c.total_amount_xof), 0);
    const unknownContracts = filteredByBuilding.filter(
      (contract) => !contractSummaryMap.has(contract.id),
    ).length;
    return {
      active: active.length,
      total,
      received: metrics.collected,
      outstanding: metrics.outstanding,
      dueOutstanding: due.outstanding,
      overdue: metrics.overdue,
      unknownContracts,
      unknownAll: filteredByBuilding.length > 0 && metrics.count === 0,
      transferDone: active.filter((c) => c.transfer_status === "completed").length,
    };
  }, [filteredByBuilding, receivables, contractSummaryMap, workspace.enabled, workspace.pageData]);

  const saleInsightContracts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return filteredByBuilding
      .map((contract) => {
        const unit = unitMap.get(contract.unit_id);
        const customer = customerMap.get(contract.customer_id);
        const related = receivables.filter(
          (r) => r.source_type === "sale_contract" && r.source_id === contract.id,
        );
        const summary = contractSummaryMap.get(contract.id) ?? EMPTY_CONTRACT_RECEIVABLE_SUMMARY;
        const dueOutstanding = workspace.enabled
          ? (workspace.data?.summaries[contract.id]?.dueOutstanding ?? 0)
          : computeFinanceMetrics(related, {
              scope: "asOf",
              asOfDate: today,
            }).outstanding;
        return {
          contract,
          unit,
          customer,
          summary: { ...summary, dueOutstanding },
        };
      })
      .filter((row) => row.unit)
      .sort((a, b) =>
        (a.unit?.unit_no ?? "").localeCompare(b.unit?.unit_no ?? "", undefined, { numeric: true }),
      );
  }, [
    customerMap,
    filteredByBuilding,
    receivables,
    unitMap,
    contractSummaryMap,
    workspace.enabled,
    workspace.data?.summaries,
  ]);

  const contractSchedules = useMemo(
    () =>
      selectedId
        ? schedules
            .filter((s) => s.sale_contract_id === selectedId)
            .sort((a, b) => a.installment_no - b.installment_no)
        : [],
    [schedules, selectedId],
  );
  const contractReceivables = useMemo(
    () =>
      selectedId
        ? receivables.filter(
            (r) =>
              r.source_type === "sale_contract" &&
              r.source_id === selectedId &&
              r.status !== "cancelled" &&
              (r.management_status ?? "managed") === "managed",
          )
        : [],
    [receivables, selectedId],
  );
  const contractPayments = useMemo(
    () => (selectedId ? payments.filter((p) => p.source_id === selectedId) : []),
    [payments, selectedId],
  );
  const selectedSummary = selectedId ? contractSummaryMap.get(selectedId) : undefined;
  const totalOverdueRec = selectedSummary?.overdue ?? 0;
  const saleCash = useMemo(() => summarizeContractCash(contractPayments), [contractPayments]);
  const isSaleExpensePayment = (payment: PaymentRow) =>
    classifyContractCashPayment(payment).kind === "expense";
  const saleFinancialIncome = saleCash.income;
  const saleFinancialExpense = saleCash.expense;
  const saleFinancialNet = saleCash.net;
  const selectedContractTotal = Number(selected?.total_amount_xof ?? 0);
  const saleContractReceived = selectedSummary?.paid ?? null;
  const selectedOutstanding = selectedSummary?.outstanding ?? null;
  const selectedCnyPayments = contractPayments.filter(
    (p) =>
      p.currency === "CNY" &&
      SALE_RECEIPT_SOURCE_TYPES.has(p.source_type) &&
      classifyContractCashPayment(p).kind === "income",
  );
  const selectedCnyReceived = selectedCnyPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  const getContractSummary = (cid: string) =>
    contractSummaryMap.get(cid) ?? EMPTY_CONTRACT_RECEIVABLE_SUMMARY;

  const getSchedStatus = (s: SalePaymentScheduleRow, rr: ReceivableRow[]) => {
    const rec = rr.find(
      (r) => r.due_date === s.due_date && Math.abs(Number(r.amount_xof) - Number(s.amount_xof)) < 1,
    );
    if (!rec || rec.status === "cancelled") return s.status;
    return rec.status === "paid"
      ? "paid"
      : Number(rec.paid_amount_xof) > 0 && Number(rec.paid_amount_xof) < Number(rec.amount_xof)
        ? "partial"
        : rec.status === "overdue"
          ? "overdue"
          : s.status === "paid"
            ? "paid"
            : "pending";
  };

  const openNew = async () => {
    if (workspace.enabled) {
      try {
        await workspace.ensure("context");
      } catch {
        return;
      }
    }
    setPanel("new");
    setSelectedId(null);
    setError("");
  };
  const openDetail = async (id: string, section: "overview" | "finance" = "overview") => {
    if (workspace.enabled) {
      try {
        await workspace.ensure("detail", id);
      } catch {
        return;
      }
    }
    setSelectedId(id);
    setDetailSection(section);
    setPanel("detail");
    setError("");
  };
  const openInsight = async (key: SaleStatKey) => {
    if (workspace.enabled) {
      try {
        await workspace.ensure("scope", undefined, true);
      } catch {
        return;
      }
    }
    setStatFilter(key);
    setPanel("insight");
    setSelectedId(null);
    setError("");
  };

  const printContract = (contract: SaleContractRow) =>
    printer.print(
      async () => {
        if (workspace.enabled) {
          const data = await workspace.ensure("detail", contract.id);
          const fresh = data.contracts[0] as SaleContractRow;
          return {
            contract: fresh,
            unit: data.units.find((row) => row.id === fresh.unit_id) ?? null,
            customer: data.customers.find((row) => row.id === fresh.customer_id) ?? null,
            summary: data.summaries[fresh.id],
          };
        }
        return {
          contract,
          unit: unitMap.get(contract.unit_id) ?? null,
          customer: customerMap.get(contract.customer_id) ?? null,
          summary: contractSummaryMap.get(contract.id),
        };
      },
      (source, target) =>
        printSaleContract(
          {
            contract: source.contract,
            unit: source.unit,
            customer: source.customer,
            paidAmountXof: source.summary?.paid ?? null,
            outstandingAmountXof: source.summary?.outstanding ?? null,
          },
          locale,
          target,
        ),
    );

  useEffect(() => {
    if (panel !== "detail" || detailSection !== "finance") return;
    const frame = window.requestAnimationFrame(() =>
      financeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [detailSection, panel, selectedId]);

  const handleCreate = async () => {
    if (workspace.unavailable) return;
    if (!fUnitId || !fCustomerId || !fSignedDate || fTotalAmount <= 0) {
      setError(locale === "zh" ? "请填写必填字段" : "Champs obligatoires");
      return;
    }
    const requestId = createRequestIdRef.current ?? crypto.randomUUID();
    createRequestIdRef.current = requestId;
    setSaving(true);
    setError("");
    const r = await createSaleContract({
      unitId: fUnitId,
      customerId: fCustomerId,
      contractNo: generatedSaleContractNo,
      signedDate: fSignedDate,
      totalAmountXof: fTotalAmount,
      paymentPlanType: fPlanType,
      numInstallments: fPlanType === "fixed_installment" ? fNumInstallments : undefined,
      agencyCompany: fAgency || undefined,
      agentName: fAgent || undefined,
      agencyCommissionXof: fCommission,
      agencyCommissionPaid: fCommissionPaid,
      requestId,
    });
    setSaving(false);
    if (r.success) {
      setWriteConfirmed(true);
      createRequestIdRef.current = null;
      setPanel(null);
      if (workspace.enabled) await workspace.refresh();
      else router.refresh();
    } else {
      setError(r.error ?? "Failed");
    }
  };
  const handlePay = async () => {
    if (!selectedId || !payScheduleId || payAmount <= 0) {
      setError(locale === "zh" ? "请选择分期并输入金额" : "Champs obligatoires");
      return;
    }
    const payload = {
      contractId: selectedId,
      scheduleId: payScheduleId,
      amount: payAmount,
      paymentDate: payDate,
      receiptNo: payReceiptNo || undefined,
    };
    await runOperation(
      "sale_payment",
      payload,
      (requestId) => recordSalePaymentAtomic({ ...payload, requestId }),
      () => {
        setPayScheduleId("");
        setPayAmount(0);
        setPayReceiptNo("");
      },
    );
  };
  const financeBusy = useRef(false);
  const runOperation = async (
    operation: string,
    payload: unknown,
    submit: (
      requestId: string,
    ) => Promise<{ success: boolean; error?: string; rejected?: boolean }>,
    done: () => void,
  ) => {
    if (financeBusy.current || !selectedId || workspace.unavailable) return;
    financeBusy.current = true;
    setSaving(true);
    setError("");
    try {
      const r = await runFinanceRequest(operation, selectedId, payload, submit);
      if (r.success) {
        setWriteConfirmed(true);
        done();
        if (workspace.enabled) await workspace.refresh();
        else router.refresh();
      } else setError(r.error ?? "操作失败");
    } catch (e) {
      setError(e instanceof Error ? e.message : "结果未知，请核对原操作。");
    } finally {
      financeBusy.current = false;
      setSaving(false);
    }
  };
  const handleAddFlex = async () => {
    if (!selected || !flexDueDate || flexAmount <= 0) return;
    const payload = {
      contractId: selected.id,
      installmentNo: Math.max(0, ...contractSchedules.map((s) => s.installment_no)) + 1,
      dueDate: flexDueDate,
      amountXof: flexAmount,
      expectedUpdatedAt: selected.updated_at,
    };
    await runOperation(
      "sale_installment",
      payload,
      (requestId) => addFlexibleInstallment({ ...payload, requestId }),
      () => {
        setShowFlexForm(false);
        setFlexDueDate("");
        setFlexAmount(0);
      },
    );
  };
  const handleTransfer = async () => {
    if (!selected || !trDate) return;
    const payload = {
      contractId: selected.id,
      status: trStatus,
      transferDate: trDate,
      titleCertificateNo: trCertNo || undefined,
      expectedUpdatedAt: selected.updated_at,
    };
    await runOperation(
      "sale_transfer",
      payload,
      (id) =>
        updateTransferStatus(
          payload.contractId,
          payload.status,
          payload.transferDate,
          payload.titleCertificateNo,
          id,
          payload.expectedUpdatedAt,
        ),
      () => setPanel(null),
    );
  };
  const handleTerminateSale = async () => {
    if (!selected) return;
    const payload = {
      contractId: selected.id,
      reason: termReason || (locale === "zh" ? "手动终止" : "Manuel"),
      expectedUpdatedAt: selected.updated_at,
    };
    await runOperation(
      "sale_terminate",
      payload,
      (id) =>
        terminateSaleContract(payload.contractId, payload.reason, id, payload.expectedUpdatedAt),
      () => setPanel(null),
    );
  };

  const changeView = async (value: "table" | "rooms") => {
    if (workspace.enabled && value === "rooms") {
      try {
        await workspace.ensure("scope");
      } catch {
        return;
      }
    }
    setContractView(value);
  };
  const inputClass =
    "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-border-strong outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";
  const schedLabel = (s: string) => {
    const l: Record<string, string> =
      locale === "zh"
        ? { pending: "待付", partial: "部分已付", paid: "已付", overdue: "逾期", cancelled: "取消" }
        : {
            pending: "En attente",
            partial: "Partiellement payé",
            paid: "Payé",
            overdue: "En retard",
            cancelled: "Annulé",
          };
    return l[s] ?? (locale === "zh" ? "待核实" : "À vérifier");
  };
  const transText = (s: string) =>
    locale === "zh"
      ? ({ not_started: "未开始", in_progress: "办理中", completed: "已完成" }[s] ?? "待核实")
      : ({ not_started: "Non commencé", in_progress: "En cours", completed: "Terminé" }[s] ??
        "À vérifier");
  const salePaymentKindLabel = (payment: PaymentRow) => {
    const labels: Record<string, [string, string]> = {
      sale: ["房款收款", "Paiement du bien"],
      sale_contract: ["房款收款", "Paiement du bien"],
      sale_other_income: ["其他经营收款", "Autre encaissement"],
      sale_other_expense: ["其他经营支出", "Autre décaissement"],
      sale_registration_fee: ["注册金收款", "Frais d'inscription"],
      sale_agency_income: ["中介费收款", "Commission reçue"],
      sale_agency_expense: ["中介费支出", "Commission versée"],
      sale_refund: ["售款退款", "Remboursement du bien"],
      parking_fee: ["车位款收款", "Paiement parking"],
      property_fee: ["物业费收款", "Frais de copropriété"],
    };
    return (
      labels[payment.source_type]?.[locale === "zh" ? 0 : 1] ??
      (locale === "zh" ? "待核对财务记录" : "Écriture à vérifier")
    );
  };

  const sellableUnits = useMemo(
    () =>
      units.filter(
        (u) =>
          scopeBuildingIds.has(u.building_id) &&
          (!activeBuildingId || u.building_id === activeBuildingId) &&
          (u.kind === "apartment" || u.kind === "parking") &&
          (u.status === "available" || u.status === "sold"),
      ),
    [units, scopeBuildingIds, activeBuildingId],
  );

  const statBlocks: Array<{
    key: SaleStatKey;
    label: string;
    value: string;
    dot: string;
    hint: string;
  }> = [
    {
      key: "active",
      label: locale === "zh" ? "生效出售" : "Ventes actives",
      value: String(dashboardStats.active),
      dot: "bg-accentGreen-500",
      hint: locale === "zh" ? "打开生效出售侧栏" : "Ouvrir les ventes actives",
    },
    {
      key: "total",
      label: locale === "zh" ? "合同总额" : "Total contrats",
      value: formatXof(dashboardStats.total),
      dot: "bg-accentBlue-500",
      hint: locale === "zh" ? "打开合同总额明细" : "Ouvrir le detail des contrats",
    },
    {
      key: "received",
      label: locale === "zh" ? "应收已核销" : "Créances réglées",
      value: dashboardStats.unknownAll ? "—" : formatXof(dashboardStats.received),
      dot: "bg-accentGreen-500",
      hint:
        locale === "zh" ? "应收核销，不等于现金收入" : "Règlements affectés, pas flux de caisse",
    },
    {
      key: "receivable",
      label: locale === "zh" ? "已建应收未收" : "Créances restantes",
      value: dashboardStats.unknownAll ? "—" : formatXof(dashboardStats.outstanding),
      dot: "bg-accentAmber-500",
      hint: dashboardStats.unknownContracts
        ? `${dashboardStats.unknownContracts} ${locale === "zh" ? "份合同未建已核应收" : "contrats sans créance vérifiée"}`
        : locale === "zh"
          ? "含已建未来分期"
          : "Dont échéances futures enregistrées",
    },
    {
      key: "due",
      label: locale === "zh" ? "到期未收" : "Dû impayé",
      value: dashboardStats.unknownAll ? "—" : formatXof(dashboardStats.dueOutstanding),
      dot: "bg-accentPurple-500",
      hint: locale === "zh" ? "截至今日，不含历史待核" : "À ce jour, historique exclu",
    },
    {
      key: "overdue",
      label: locale === "zh" ? "逾期" : "En retard",
      value: dashboardStats.unknownAll ? "—" : formatXof(dashboardStats.overdue),
      dot: dashboardStats.overdue > 0 ? "bg-accentRed-500" : "bg-muted-foreground/40",
      hint: locale === "zh" ? "打开逾期侧栏" : "Ouvrir les retards",
    },
    {
      key: "transfer",
      label: locale === "zh" ? "已过户" : "Transfert",
      value: String(dashboardStats.transferDone),
      dot: "bg-accentPurple-500",
      hint: locale === "zh" ? "打开过户明细" : "Ouvrir les transferts",
    },
  ];

  return (
    <OperationalPage
      eyebrow={locale === "zh" ? "出售业务" : "Ventes"}
      title={locale === "zh" ? "出售合同" : "Contrats de vente"}
      description={`${workspace.enabled ? (workspace.unavailable ? "—" : workspace.pageData?.scopeCount) : filteredByBuilding.length} ${locale === "zh" ? "份合同 · 汇总统一按 FCFA 结算" : "contrats · total en FCFA"}`}
      action={
        canCreate ? (
          <Button size="sm" disabled={workspace.unavailable} onClick={openNew}>
            <Plus className="h-4 w-4" />
            {t.form.newContract}
          </Button>
        ) : undefined
      }
    >
      {/* ── Summary stats ── */}
      <MetricGrid columns={6}>
        {statBlocks.map((b) => (
          <StatTile
            key={b.key}
            label={b.label}
            value={workspace.unavailable ? "—" : b.value}
            caption={
              workspace.unavailable
                ? locale === "zh"
                  ? "读取中或暂不可核验"
                  : "Lecture en cours ou indisponible"
                : panel === "insight" && statFilter === b.key
                  ? locale === "zh"
                    ? "明细已打开"
                    : "Détail ouvert"
                  : b.hint
            }
            tone={
              b.key === "overdue"
                ? "red"
                : b.key === "receivable"
                  ? "amber"
                  : b.key === "due" || b.key === "transfer"
                    ? "purple"
                    : b.key === "active" || b.key === "received"
                      ? "green"
                      : "blue"
            }
            onClick={() => openInsight(b.key)}
            active={panel === "insight" && statFilter === b.key}
          />
        ))}
      </MetricGrid>

      <FilterBar
        meta={`${workspace.enabled ? (workspace.unavailable ? "—" : `${workspace.pageData?.total} / ${workspace.pageData?.scopeCount}`) : `${visibleContracts.length} / ${filteredByBuilding.length}`} ${locale === "zh" ? "份合同" : "contrats"}`}
      >
        {buildings.length > 1 && (
          <SegmentedControl
            value={activeBuildingId}
            onChange={setActiveBuildingId}
            ariaLabel={locale === "zh" ? "楼栋切换" : "Selection du batiment"}
            items={[
              { value: "", label: locale === "zh" ? "全部楼栋" : "Tous les bâtiments" },
              ...buildings
                .filter((building) => scopeBuildingIds.has(building.id))
                .map((b) => ({ value: b.id, label: b.display_name || b.code })),
            ]}
          />
        )}
        <SegmentedControl
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as SaleStatusFilter)}
          ariaLabel={locale === "zh" ? "出售合同状态" : "Statut des contrats de vente"}
          items={[
            { value: "current", label: locale === "zh" ? "当前合同" : "En cours" },
            { value: "all", label: locale === "zh" ? "全部" : "Tous" },
            { value: "terminated", label: locale === "zh" ? "已终止" : "Résiliés" },
            { value: "expired", label: locale === "zh" ? "已过期" : "Expirés" },
          ]}
        />
      </FilterBar>

      <ContractListControls
        locale={locale}
        query={search}
        onQueryChange={setSearch}
        view={contractView}
        onViewChange={changeView}
      />
      {printer.error && (
        <p role="alert" className="text-sm text-destructive">
          {printer.error}
        </p>
      )}
      {workspace.enabled && (
        <p className="text-xs text-muted-foreground">
          {locale === "zh"
            ? "汇总范围：当前项目、楼栋及状态全部匹配合同，不随搜索或分页截断。"
            : "Synthèse : tous les contrats du projet, bâtiment et statut ; indépendante de la recherche et des pages."}
        </p>
      )}
      {workspace.unavailable && (
        <div role="status" className="rounded-xl border bg-card p-5 text-sm">
          {workspace.error && writeConfirmed && (
            <p>
              {locale === "zh"
                ? "上一笔操作已确认成功，请勿重复提交。这里只需重试读取最新数据。"
                : "La dernière opération est confirmée. Ne la soumettez pas de nouveau ; actualisez uniquement les données."}
            </p>
          )}
          {workspace.error
            ? locale === "zh"
              ? "合同数据暂不可核验，未展示旧余额或办理动作。"
              : "Données contractuelles indisponibles ; anciens soldes et actions masqués."
            : locale === "zh"
              ? "正在读取合同数据…"
              : "Lecture des contrats…"}
          {workspace.error && (
            <Button variant="outline" size="sm" onClick={workspace.retry}>
              {locale === "zh" ? "重试" : "Réessayer"}
            </Button>
          )}
        </div>
      )}
      {!workspace.unavailable && contractView === "table" && (
        <ContractTable
          pagination={workspace.pagination}
          rows={searchedTableRows}
          locale={locale}
          amountLabel={locale === "zh" ? "合同总额" : "Total du contrat"}
          periodLabel={locale === "zh" ? "签约 / 过户日期" : "Signature / transfert"}
          onOpen={openDetail}
          onFinance={(id) => openDetail(id, "finance")}
          onPrint={(id) => {
            const contract = contracts.find((row) => row.id === id);
            if (contract) printContract(contract);
          }}
        />
      )}

      {/* ── Contract matrix (BusinessRoomCard) ── */}
      {!workspace.unavailable &&
        contractView === "rooms" &&
        (groupedContracts.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          groupedContracts.map(([floor, fc]) => (
            <RoomBoard
              key={floor}
              header={
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    <h3 className="text-sm font-semibold">{floor}</h3>
                  </div>
                  <span className="text-[12px] font-medium text-[#5D7186]">
                    {fc.length} {locale === "fr" ? "contrats" : "份合同"}
                  </span>
                </>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {fc.map((contract) => {
                  const unit = unitMap.get(contract.unit_id);
                  const customer = customerMap.get(contract.customer_id);
                  const s = getContractSummary(contract.id);
                  const dataFlags = getSaleDataFlags(contract, customer);
                  return (
                    <RoomCard
                      key={contract.id}
                      roomNo={unit?.unit_no ?? "-"}
                      status="sold"
                      statusLabel={
                        t.contractStatus[contract.status as keyof typeof t.contractStatus]
                      }
                      locale={locale}
                      onClick={() => openDetail(contract.id)}
                    >
                      {/* Name + status badge */}
                      <div className="flex min-h-[52px] items-start justify-between gap-1.5">
                        <p
                          className="text-[13px] font-medium leading-tight truncate"
                          title={customer?.name ?? ""}
                        >
                          {customer?.name ?? "-"}
                        </p>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {dataFlags.needsData && (
                            <Badge variant="warning" className="text-[10px]">
                              {locale === "zh" ? "资料待补" : "A compléter"}
                            </Badge>
                          )}
                          {!dataFlags.needsData && dataFlags.needsNumberCleanup && (
                            <Badge variant="info" className="text-[10px]">
                              {locale === "zh" ? "编号待整理" : "N° à vérifier"}
                            </Badge>
                          )}
                          <Badge variant={statusVariant[contract.status]} className="text-[10px]">
                            {t.contractStatus[contract.status as keyof typeof t.contractStatus]}
                          </Badge>
                        </div>
                      </div>
                      {/* Compact info row */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#5D7186]">
                        <span title={contract.contract_no} className="truncate max-w-[90px]">
                          {contract.contract_no}
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {Number(contract.total_amount_xof) > 0
                            ? formatXof(Number(contract.total_amount_xof))
                            : locale === "zh"
                              ? "金额待补"
                              : "Montant à compléter"}
                        </span>
                        {s.outstanding > 0 && (
                          <span className="text-amber-600 font-medium">
                            {formatXof(s.outstanding)} {locale === "zh" ? "待收" : "dû"}
                          </span>
                        )}
                      </div>
                      {/* Transfer status + action buttons */}
                      <div className="mt-auto flex items-center justify-between gap-4 border-t border-[rgba(23,50,77,0.06)] pt-3">
                        <span
                          className={cn(
                            "text-[11px]",
                            contract.transfer_status === "completed"
                              ? "text-emerald-600"
                              : "text-[#5D7186]",
                          )}
                        >
                          {transText(contract.transfer_status)}
                        </span>
                        <div className="flex justify-center gap-5">
                          <SaleActionBtn
                            icon={Eye}
                            label={locale === "zh" ? "查看详情" : "Voir les détails"}
                            onClick={() => openDetail(contract.id)}
                          />
                          <SaleActionBtn
                            icon={DollarSign}
                            label={locale === "zh" ? "查看财务" : "Voir les finances"}
                            onClick={() => openDetail(contract.id, "finance")}
                          />
                          <SaleActionBtn
                            icon={FileText}
                            label={locale === "zh" ? "合同/打印" : "Contrat / imprimer"}
                            onClick={() => printContract(contract)}
                          />
                        </div>
                      </div>
                    </RoomCard>
                  );
                })}
              </div>
            </RoomBoard>
          ))
        ))}

      {/* ── KPI insight panel ── */}
      {!workspace.unavailable &&
        panel === "insight" &&
        statFilter &&
        (() => {
          const titleMap: Record<SaleStatKey, string> = {
            active: locale === "zh" ? "生效出售明细" : "Ventes actives",
            total: locale === "zh" ? "合同总额明细" : "Total des contrats",
            received: locale === "zh" ? "应收核销明细" : "Créances réglées",
            receivable: locale === "zh" ? "已建应收未收明细" : "Créances restantes",
            due: locale === "zh" ? "到期未收明细" : "Montants échus impayés",
            overdue: locale === "zh" ? "逾期明细" : "Retards de paiement",
            transfer: locale === "zh" ? "已过户明细" : "Transferts completes",
          };
          const activeRows = saleInsightContracts.filter((row) => row.contract.status === "active");
          const insightRows =
            statFilter === "active"
              ? activeRows
              : statFilter === "total"
                ? [...activeRows].sort(
                    (a, b) =>
                      Number(b.contract.total_amount_xof) - Number(a.contract.total_amount_xof),
                  )
                : statFilter === "received"
                  ? saleInsightContracts
                      .filter((row) => row.summary.paid > 0)
                      .sort((a, b) => b.summary.paid - a.summary.paid)
                  : statFilter === "receivable"
                    ? saleInsightContracts
                        .filter((row) => row.summary.outstanding > 0)
                        .sort((a, b) =>
                          (a.summary.nextDue ?? "9999-12-31").localeCompare(
                            b.summary.nextDue ?? "9999-12-31",
                          ),
                        )
                    : statFilter === "due"
                      ? saleInsightContracts
                          .filter((row) => row.summary.dueOutstanding > 0)
                          .sort((a, b) => b.summary.dueOutstanding - a.summary.dueOutstanding)
                      : statFilter === "overdue"
                        ? saleInsightContracts
                            .filter((row) => row.summary.overdue > 0)
                            .sort((a, b) => b.summary.overdue - a.summary.overdue)
                        : activeRows.filter((row) => row.contract.transfer_status === "completed");
          const metricValue =
            statFilter === "active" || statFilter === "transfer"
              ? String(insightRows.length)
              : formatXof(
                  insightRows.reduce((sum, row) => {
                    if (statFilter === "total") return sum + Number(row.contract.total_amount_xof);
                    if (statFilter === "received") return sum + row.summary.paid;
                    if (statFilter === "due") return sum + row.summary.dueOutstanding;
                    if (statFilter === "overdue") return sum + row.summary.overdue;
                    return sum + row.summary.outstanding;
                  }, 0),
                );
          const valueForRow = (row: (typeof insightRows)[number]) => {
            if (statFilter === "received") return row.summary.paid;
            if (statFilter === "overdue") return row.summary.overdue;
            if (statFilter === "due") return row.summary.dueOutstanding;
            if (statFilter === "receivable") return row.summary.outstanding;
            return Number(row.contract.total_amount_xof);
          };
          const badgeVariant =
            statFilter === "overdue"
              ? "destructive"
              : statFilter === "receivable"
                ? "warning"
                : statFilter === "transfer"
                  ? "secondary"
                  : "success";

          return (
            <SalePanelShell
              onClose={() => setPanel(null)}
              title={titleMap[statFilter]}
              badge={<Badge variant={badgeVariant}>{insightRows.length}</Badge>}
            >
              <div className="space-y-4">
                <div
                  className={cn(
                    "rounded-xl border p-3",
                    statFilter === "overdue"
                      ? "border-red-200 bg-red-50/50"
                      : statFilter === "receivable"
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-border bg-muted/35",
                  )}
                >
                  <p className="text-xs text-muted-foreground">
                    {locale === "zh" ? "当前楼栋合计" : "Total du batiment"}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-xl font-semibold tabular-nums",
                      statFilter === "overdue"
                        ? "text-red-700"
                        : statFilter === "receivable"
                          ? "text-amber-700"
                          : "text-foreground",
                    )}
                  >
                    {metricValue}
                  </p>
                </div>
                {insightRows.length === 0 ? (
                  <EmptyState
                    title={locale === "zh" ? "当前没有对应合同" : "Aucun contrat correspondant"}
                  />
                ) : (
                  <div className="space-y-2.5">
                    {insightRows.map((row) => (
                      <div
                        key={row.contract.id}
                        className="rounded-xl border border-border bg-card p-3.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">
                                {row.unit?.unit_no ?? "-"} ·{" "}
                                {row.customer?.name ??
                                  (locale === "zh" ? "客户待补" : "Client a completer")}
                              </span>
                              <Badge
                                variant={
                                  row.contract.transfer_status === "completed"
                                    ? "success"
                                    : "secondary"
                                }
                                className="h-5 px-2 text-[10px]"
                              >
                                {transText(row.contract.transfer_status)}
                              </Badge>
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {row.contract.contract_no}
                            </p>
                          </div>
                          <p
                            className={cn(
                              "shrink-0 text-sm font-semibold tabular-nums",
                              statFilter === "overdue"
                                ? "text-red-700"
                                : statFilter === "receivable"
                                  ? "text-amber-700"
                                  : statFilter === "received"
                                    ? "text-emerald-700"
                                    : "text-foreground",
                            )}
                          >
                            {formatXof(valueForRow(row))}
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                          <span>
                            {locale === "zh" ? "签约" : "Signe"} {row.contract.signed_date}
                          </span>
                          <span className="text-right">
                            {locale === "zh" ? "总额" : "Total"}{" "}
                            {formatXof(Number(row.contract.total_amount_xof))}
                          </span>
                          <span>
                            {locale === "zh" ? "已收" : "Encaissé"} {formatXof(row.summary.paid)}
                          </span>
                          <span className="text-right">
                            {locale === "zh" ? "未收" : "Reste"}{" "}
                            {formatXof(row.summary.outstanding)}
                          </span>
                          {row.summary.nextDue && (
                            <span className="col-span-2">
                              {locale === "zh" ? "最近应收" : "Prochaine echeance"}{" "}
                              {row.summary.nextDue}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 w-full"
                          onClick={() => openDetail(row.contract.id)}
                        >
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
      {!workspace.unavailable && canCreate && panel === "new" && (
        <SalePanelShell onClose={() => setPanel(null)} title={t.form.newContract}>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>
                {locale === "zh" ? "合同编号（自动生成）" : "N° de contrat (automatique)"}
              </label>
              <input
                type="text"
                value={generatedSaleContractNo}
                readOnly
                placeholder={locale === "zh" ? "选择房源后生成" : "Choisissez le logement"}
                className={cn(inputClass, "bg-muted/50 text-muted-foreground")}
              />
            </div>
            <div>
              <label className={labelClass}>{t.form.unit} *</label>
              <select
                value={fUnitId}
                onChange={(e) => setFUnitId(e.target.value)}
                className={inputClass}
              >
                <option value="">{t.form.noUnit}</option>
                {sellableUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unit_no} ({u.floor_label})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t.form.customer} *</label>
              <select
                value={fCustomerId}
                onChange={(e) => setFCustomerId(e.target.value)}
                className={inputClass}
              >
                <option value="">{t.form.noCustomer}</option>
                {customers
                  .filter((cc) => !cc.is_blacklisted)
                  .map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t.form.signedDate}</label>
                <DateInput
                  value={fSignedDate}
                  onChangeValue={setFSignedDate}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t.form.totalAmount} *</label>
                <input
                  type="number"
                  value={fTotalAmount}
                  onChange={(e) => setFTotalAmount(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>{locale === "zh" ? "付款计划" : "Plan"}</label>
              <select
                value={fPlanType}
                onChange={(e) => setFPlanType(e.target.value)}
                className={inputClass}
              >
                <option value="lump_sum">{t.paymentPlan.lump_sum}</option>
                <option value="fixed_installment">{t.paymentPlan.fixed_installment}</option>
                <option value="flexible_installment">{t.paymentPlan.flexible_installment}</option>
              </select>
            </div>
            {fPlanType === "fixed_installment" && (
              <div>
                <label className={labelClass}>{locale === "zh" ? "分期数" : "Nb echeances"}</label>
                <input
                  type="number"
                  min={2}
                  max={24}
                  value={fNumInstallments}
                  onChange={(e) => setFNumInstallments(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{locale === "zh" ? "中介公司" : "Agence"}</label>
                <input
                  type="text"
                  value={fAgency}
                  onChange={(e) => setFAgency(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{locale === "zh" ? "中介" : "Agent"}</label>
                <input
                  type="text"
                  value={fAgent}
                  onChange={(e) => setFAgent(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{locale === "zh" ? "佣金" : "Commission"}</label>
                <input
                  type="number"
                  value={fCommission}
                  onChange={(e) => setFCommission(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <label className="flex items-center gap-2 text-sm pt-6">
                <input
                  type="checkbox"
                  checked={fCommissionPaid}
                  onChange={(e) => setFCommissionPaid(e.target.checked)}
                />
                {locale === "zh" ? "佣金已付" : "Com. payee"}
              </label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full" onClick={handleCreate} disabled={saving}>
              {saving ? "..." : t.form.newContract}
            </Button>
          </div>
        </SalePanelShell>
      )}

      {/* ── Detail Panel ── */}
      {panel === "detail" && selected && (
        <SalePanelShell
          onClose={() => setPanel(null)}
          title={selected.contract_no}
          badge={
            <Badge variant={statusVariant[selected.status]}>
              {t.contractStatus[selected.status as keyof typeof t.contractStatus]}
            </Badge>
          }
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "zh" ? "楼栋 / 房号" : "Bâtiment / Lot"}
                </dt>
                <dd className="font-medium">
                  {selectedBuilding?.display_name || selectedBuilding?.code || "-"} ·{" "}
                  {selectedUnit?.unit_no ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.customer}</dt>
                <dd className="font-medium">{selectedCustomer?.name ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.signedDate}</dt>
                <dd>{selected.signed_date}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.totalAmount}</dt>
                <dd className="font-semibold">{formatXof(Number(selected.total_amount_xof))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "zh" ? "过户状态" : "Transfert"}
                </dt>
                <dd
                  className={cn(
                    "font-medium",
                    selected.transfer_status === "completed" ? "text-emerald-600" : "",
                  )}
                >
                  {transText(selected.transfer_status)}
                </dd>
              </div>
            </dl>

            <div className="border-t pt-4">
              <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {locale === "zh" ? "合同概览" : "Aperçu du contrat"}
              </h4>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2">
                  <p className="text-muted-foreground">
                    {locale === "zh" ? "合同总额" : "Total contrat"}
                  </p>
                  <p className="font-semibold tabular-nums text-blue-700">
                    {formatXof(selectedContractTotal)}
                  </p>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2">
                  <p className="text-muted-foreground">
                    {locale === "zh" ? "应收已核销" : "Créances réglées"}
                  </p>
                  <p className="font-semibold tabular-nums text-emerald-700">
                    {saleContractReceived === null ? "—" : formatXof(saleContractReceived)}
                  </p>
                </div>
                <div
                  className={cn(
                    "rounded-md border px-3 py-2",
                    (selectedOutstanding ?? 0) > 0
                      ? "border-amber-200 bg-amber-50/50"
                      : "border-border bg-muted/25",
                  )}
                >
                  <p className="text-muted-foreground">
                    {locale === "zh" ? "已建应收未收" : "Créances restantes"}
                  </p>
                  <p
                    className={cn(
                      "font-semibold tabular-nums",
                      (selectedOutstanding ?? 0) > 0 ? "text-amber-700" : "text-foreground",
                    )}
                  >
                    {selectedOutstanding === null
                      ? locale === "zh"
                        ? "未建已核应收"
                        : "Aucune créance vérifiée"
                      : formatXof(selectedOutstanding)}
                  </p>
                </div>
                <div
                  className={cn(
                    "rounded-md border px-3 py-2",
                    totalOverdueRec > 0
                      ? "border-red-200 bg-red-50/50"
                      : "border-emerald-200 bg-emerald-50/50",
                  )}
                >
                  <p className="text-muted-foreground">{locale === "zh" ? "逾期" : "En retard"}</p>
                  <p
                    className={cn(
                      "font-semibold tabular-nums",
                      totalOverdueRec > 0 ? "text-red-700" : "text-emerald-700",
                    )}
                  >
                    {selectedSummary ? formatXof(totalOverdueRec) : "—"}
                  </p>
                </div>
              </div>
            </div>

            {selected.status === "active" && (
              <div className="grid grid-cols-2 gap-2">
                {canRecordFinance && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setPayScheduleId(
                        contractSchedules.find((s) => s.status !== "paid")?.id ?? "",
                      );
                      setPayAmount(0);
                    }}
                  >
                    <DollarSign className="h-4 w-4" />
                    {locale === "zh" ? "收款" : "Paiement"}
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowFlexForm(true);
                      setFlexDueDate("");
                      setFlexAmount(0);
                      setError("");
                    }}
                  >
                    <CalendarPlus className="h-4 w-4" />
                    {locale === "zh" ? "新增分期" : "+Echeance"}
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTrDate(new Date().toISOString().slice(0, 10));
                      setTrStatus(selected.transfer_status);
                    }}
                  >
                    <TrendingUp className="h-4 w-4" />
                    {locale === "zh" ? "过户" : "Transfert"}
                  </Button>
                )}
                {canTerminate && (
                  <Button size="sm" variant="ghost" onClick={handleTerminateSale}>
                    <AlertTriangle className="h-4 w-4" />
                    {locale === "zh" ? "终止" : "Resilier"}
                  </Button>
                )}
              </div>
            )}

            <div
              ref={financeSectionRef}
              className={cn(
                "scroll-mt-20 border-t pt-4",
                detailSection === "finance" && "-mx-2 rounded-xl px-2 ring-2 ring-primary/20",
              )}
            >
              <div className="mb-2 space-y-1">
                <h4 className="text-sm font-semibold">
                  {locale === "zh" ? "财务记录" : "Écritures financières"}
                </h4>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium tabular-nums">
                  <span className="text-emerald-700">
                    {locale === "zh" ? "已录经营收款" : "Encaissements enregistrés"}{" "}
                    {formatXof(saleFinancialIncome)}
                  </span>
                  <span className="text-red-600">
                    {locale === "zh" ? "已录经营支出" : "Décaissements enregistrés"}{" "}
                    {formatXof(saleFinancialExpense)}
                  </span>
                  <span className="text-slate-700">
                    {locale === "zh" ? "经营现金净额" : "Flux de caisse net"}{" "}
                    {formatXof(saleFinancialNet)}
                  </span>
                </div>
                {selectedCnyReceived > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {locale === "zh" ? "其中已录人民币收款 " : "Dont encaissements CNY "}
                    {formatMoney(selectedCnyReceived, "CNY", locale)}
                  </p>
                )}
                {(saleCash.excludedCount > 0 || saleCash.nonCashCount > 0) && (
                  <p className="text-xs text-amber-700">
                    {saleCash.excludedCount}{" "}
                    {locale === "zh"
                      ? "笔待核对记录未计入现金汇总"
                      : "écritures à vérifier exclues du flux"}{" "}
                    · {saleCash.nonCashCount}{" "}
                    {locale === "zh" ? "笔非现金抵扣" : "compensations hors caisse"}
                  </p>
                )}
                {selected.agency_commission_paid && (
                  <p className="text-xs text-muted-foreground">
                    {locale === "zh"
                      ? "合同标注的佣金已付状态单独保留；未找到逐笔付款记录时，不代算现金支出。"
                      : "Le statut de commission du contrat est conservé, mais ne remplace pas une écriture de caisse."}
                  </p>
                )}
              </div>
              {contractPayments.length === 0 && saleFinancialExpense <= 0 ? (
                <p className="text-xs text-muted-foreground">
                  {locale === "zh" ? "暂无逐笔财务记录" : "Aucune écriture détaillée"}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {contractPayments.map((payment) => {
                    const cashLine = classifyContractCashPayment(payment);
                    const isExpense = isSaleExpensePayment(payment);
                    const display = {
                      primary:
                        payment.currency === "XOF"
                          ? formatXof(Number(payment.amount))
                          : formatMoney(Number(payment.amount), payment.currency, locale),
                      secondary:
                        payment.currency !== "XOF" && cashLine.amountXof !== null
                          ? formatXof(cashLine.amountXof)
                          : null,
                    };
                    return (
                      <div
                        key={payment.id}
                        className={cn(
                          "rounded-lg border px-3 py-2.5 text-[13px]",
                          isExpense
                            ? "border-red-100 bg-red-50/50"
                            : "border-emerald-100 bg-emerald-50/40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "font-semibold",
                                  isExpense ? "text-red-700" : "text-emerald-800",
                                )}
                              >
                                {salePaymentKindLabel(payment)}
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {payment.payment_date}
                              </span>
                            </div>
                            <p
                              className="mt-1 truncate text-[11px] text-muted-foreground"
                              title={payment.receipt_no ?? payment.notes ?? ""}
                            >
                              {payment.receipt_no ||
                                payment.notes ||
                                (locale === "zh" ? "无业务编号" : "Sans référence")}
                            </p>
                            {cashLine.kind === "excluded" && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {locale === "zh"
                                  ? "未计入现金汇总，保留原始记录"
                                  : "Hors synthèse de caisse, écriture conservée"}
                              </p>
                            )}
                          </div>
                          <div
                            className={cn(
                              "shrink-0 text-right tabular-nums",
                              isExpense ? "text-red-600" : "text-emerald-700",
                            )}
                          >
                            <p className="font-semibold">
                              {isExpense ? "- " : ""}
                              {display.primary}
                            </p>
                            {cashLine.amountXof !== null && display.secondary && (
                              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                                {locale === "zh" ? "折合 " : "Soit "}
                                {display.secondary}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Paid contracts already have definitive entries in financial records. */}
            {(selectedOutstanding === null || selectedOutstanding > 0) && (
              <div className="border-t pt-4">
                <h4 className="mb-2 text-sm font-semibold">
                  {locale === "zh" ? "付款计划" : "Plan de paiement"}
                </h4>
                {contractSchedules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {locale === "zh" ? "暂无付款计划" : "Aucun plan"}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {contractSchedules.map((s) => {
                      const stat = getSchedStatus(s, contractReceivables);
                      const recPaid = contractReceivables.find(
                        (r) =>
                          r.due_date === s.due_date &&
                          Math.abs(Number(r.amount_xof) - Number(s.amount_xof)) < 1,
                      );
                      const itemTitle =
                        recPaid?.title
                          ?.replace(new RegExp(`^${selectedUnit?.unit_no ?? ""}\\s*`), "")
                          .trim() ||
                        (selected?.payment_plan_type === "lump_sum"
                          ? locale === "zh"
                            ? "一次性付款"
                            : "Paiement comptant"
                          : locale === "zh"
                            ? `第${s.installment_no}期`
                            : `Échéance ${s.installment_no}`);
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            "rounded-lg border bg-card px-3 py-2.5 text-[13px]",
                            stat === "overdue"
                              ? "border-red-200"
                              : stat === "paid"
                                ? "border-emerald-200"
                                : "border-amber-200",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{itemTitle}</span>
                                <Badge
                                  variant={
                                    stat === "paid"
                                      ? "success"
                                      : stat === "overdue"
                                        ? "destructive"
                                        : "warning"
                                  }
                                >
                                  {schedLabel(stat)}
                                </Badge>
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {locale === "zh" ? "约定付款日" : "Date convenue"} {s.due_date}
                                {recPaid && Number(recPaid.paid_amount_xof) > 0
                                  ? ` · ${locale === "zh" ? "已收" : "Reçu"} ${formatXof(Number(recPaid.paid_amount_xof))}`
                                  : ""}
                              </p>
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums">
                              {formatXof(Number(s.amount_xof))}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Pay form */}
            {canRecordFinance && payScheduleId && (
              <div className="space-y-2 rounded-md border bg-card p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "选择分期" : "Echeance"}
                    </label>
                    <select
                      value={payScheduleId}
                      onChange={(e) => {
                        setPayScheduleId(e.target.value);
                        if (!e.target.value) {
                          setPayAmount(0);
                          return;
                        }
                        const s = contractSchedules.find((i) => i.id === e.target.value);
                        if (s) {
                          const matchingRec = contractReceivables.find(
                            (r) =>
                              r.due_date === s.due_date &&
                              Math.abs(Number(r.amount_xof) - Number(s.amount_xof)) < 1,
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
                      {contractSchedules
                        .filter((s) => s.status !== "paid")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            #{s.installment_no} {s.due_date} {formatXof(Number(s.amount_xof))}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "收款日期" : "Date"}
                    </label>
                    <DateInput value={payDate} onChangeValue={setPayDate} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "金额" : "Montant"}
                    </label>
                    <input
                      type="number"
                      value={payAmount}
                      onChange={(e) => setPayAmount(Number(e.target.value))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "收据号" : "Recu"}
                    </label>
                    <input
                      type="text"
                      value={payReceiptNo}
                      onChange={(e) => setPayReceiptNo(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handlePay} disabled={saving}>
                    {saving ? "..." : locale === "zh" ? "确认收款" : "Encaisser"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPayScheduleId("");
                      setError("");
                    }}
                  >
                    {locale === "zh" ? "取消" : "Annuler"}
                  </Button>
                </div>
              </div>
            )}

            {/* Flex installment form */}
            {canManage && showFlexForm && (
              <div className="space-y-2 rounded-md border bg-card p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "到期日" : "Echeance"}
                    </label>
                    <DateInput
                      value={flexDueDate}
                      onChangeValue={setFlexDueDate}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "金额" : "Montant"}
                    </label>
                    <input
                      type="number"
                      value={flexAmount}
                      onChange={(e) => setFlexAmount(Number(e.target.value))}
                      className={inputClass}
                    />
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddFlex} disabled={saving}>
                    {saving ? "..." : locale === "zh" ? "新增" : "Ajouter"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowFlexForm(false);
                      setFlexDueDate("");
                      setFlexAmount(0);
                      setError("");
                    }}
                  >
                    {locale === "zh" ? "取消" : "Annuler"}
                  </Button>
                </div>
              </div>
            )}

            {/* Transfer form */}
            {canManage && selected.status === "active" && trDate && (
              <div className="space-y-2 rounded-md border bg-card p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "过户状态" : "Transfert"}
                    </label>
                    <select
                      value={trStatus}
                      onChange={(e) => setTrStatus(e.target.value)}
                      className={inputClass}
                    >
                      <option value="not_started">{transText("not_started")}</option>
                      <option value="in_progress">{transText("in_progress")}</option>
                      <option value="completed">{transText("completed")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "过户日期" : "Date"}
                    </label>
                    <DateInput value={trDate} onChangeValue={setTrDate} className={inputClass} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground">
                      {locale === "zh" ? "产权证号" : "Titre"}
                    </label>
                    <input
                      type="text"
                      value={trCertNo}
                      onChange={(e) => setTrCertNo(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleTransfer} disabled={saving}>
                    {saving ? "..." : locale === "zh" ? "保存" : "OK"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTrDate("");
                    }}
                  >
                    {locale === "zh" ? "取消" : "Annuler"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SalePanelShell>
      )}
    </OperationalPage>
  );
}

function SalePanelShell({
  onClose,
  title,
  badge,
  children,
}: {
  onClose: () => void;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RightDrawer open title={title} badge={badge} onClose={onClose}>
      {children}
    </RightDrawer>
  );
}
