"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { contractStatusVariant as statusVariant } from "@/lib/status-styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { EmptyState } from "@/components/empty-state";
import { OperationalPage, RightDrawer } from "@/components/ui/operational";
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
import {
  buildContractReceivableSummaries,
  formatContractXof,
  EMPTY_CONTRACT_RECEIVABLE_SUMMARY,
  matchesContractSearch,
  type ContractTableRow,
} from "@/features/contracts/contract-list-model";
import { resolveContractProjectLink } from "@/features/contracts/project-link";
import { useContractWorkspace } from "@/features/contracts/use-workspace";
import type { WorkspaceData } from "@/features/contracts/workspace-model";
import { workspaceQueryKey } from "@/features/contracts/workspace-model";
import { useContractPrinter } from "@/features/contracts/use-contract-printer";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { SaleWorkbenchTable } from "./sale-workbench-table";
import { SaleWorkbenchRooms } from "./sale-workbench-rooms";
import { SaleWorkbenchInspector, type SaleWorkbenchAction } from "./sale-workbench-inspector";
import { useSaleWorkbenchPreview } from "./use-sale-workbench-preview";
import {
  SALE_UUID,
  salePrice,
  saleWorkbenchHref,
  saleWorkbenchStats,
} from "./sale-workbench-model";
import styles from "./sale-workbench.module.css";
import {
  SaleWorkbenchScope,
  SaleWorkbenchToolbar,
  SaleWorkbenchSummary,
  SaleNoSaleWorkspace,
  type SaleStatKey,
  type SaleStatusFilter,
} from "./sale-workbench-chrome";

interface SaleListProps {
  workspace?: WorkspaceData;
  initialProject?: string;
  initialContract?: string;
  returnTo?: string;
  noSaleProject?: boolean;
  contracts: SaleContractRow[];
  schedules: SalePaymentScheduleRow[];
  units: UnitRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  buildings: {
    id: string;
    code: string;
    display_name: string;
    project_id?: string | null;
    project?: { id: string; code: string; display_name: string; allows_sale?: boolean } | null;
  }[];
  locale: Locale;
  canCreate?: boolean;
  canRecordFinance?: boolean;
  canManage?: boolean;
  canTerminate?: boolean;
}
type PanelType = "new" | "insight" | SaleWorkbenchAction | null;

function getSaleDataFlags(contract: SaleContractRow, customer?: CustomerRow | null) {
  return {
    needsData:
      contract.payment_plan_type === "legacy_pending" ||
      salePrice(contract) === null ||
      customer?.name.includes("资料待补") ||
      customer?.notes?.includes("legacy_placeholder=true"),
    needsNumberCleanup: contract.contract_no.startsWith("LEGACY-SALE-"),
  };
}

export function SaleList({
  workspace: initialWorkspace,
  initialProject,
  initialContract,
  returnTo,
  noSaleProject = false,
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
  const [statusFilter, setStatusFilter] = useState<SaleStatusFilter>(
    (initialWorkspace?.query.status as SaleStatusFilter) ?? "current",
  );
  const [contractView, setContractView] = useState<"table" | "rooms">("table");
  const [search, setSearch] = useState(initialWorkspace?.query.search ?? "");
  const [previewSelection, setPreviewSelection] = useState<{ id: string; scope: string } | null>(
    () =>
      initialContract && SALE_UUID.test(initialContract) && initialWorkspace
        ? { id: initialContract, scope: workspaceQueryKey(initialWorkspace.query) }
        : null,
  );
  const [panel, setPanel] = useState<PanelType>(null);
  useEffect(() => {
    if (workspace.enabled && contractView === "table" && panel !== "insight")
      workspace.closeScope();
  }, [workspace.enabled, workspace.closeScope, contractView, panel]);
  const [previewTab, setPreviewTab] = useState<"overview" | "finance">("overview");
  const actionRequestRef = useRef(0);
  const actionSelectionRef = useRef("");
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
    initialWorkspace
      ? initialWorkspace.query.buildingId
      : requestedProjectId
        ? ""
        : (buildings.find((building) => building.code === "SACSI11")?.id ?? buildings[0]?.id ?? ""),
  );
  const currentQuery = workspace.query;
  const currentScope = currentQuery
    ? workspaceQueryKey(currentQuery)
    : `${activeBuildingId}/${statusFilter}/${search}`;
  const previewId =
    previewSelection?.scope === currentScope && !workspace.unavailable ? previewSelection.id : null;
  const previewVersion = useMemo(
    () => ({ page: workspace.pageData, selection: previewSelection }),
    [workspace.pageData, previewSelection],
  );
  const preview = useSaleWorkbenchPreview(
    workspace.enabled && !workspace.unavailable ? currentQuery : undefined,
    previewId,
    previewVersion,
  );
  const currentHref = currentQuery
    ? saleWorkbenchHref(currentQuery, previewId)
    : `${locale === "fr" ? "/fr" : ""}/sales`;
  const safeReturn = safeWorkbenchReturnTo(returnTo);
  const previewColumnRef = useRef<HTMLDivElement | null>(null);
  const revealPreview = () => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      typeof window.requestAnimationFrame !== "function" ||
      !window.matchMedia("(max-width: 1199px)").matches
    )
      return;
    window.requestAnimationFrame(() => {
      const target = previewColumnRef.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  };
  actionSelectionRef.current =
    previewSelection?.scope === currentScope ? `${currentScope}/${previewSelection.id}` : "";
  const selectPreview = (id: string, section: "overview" | "finance" = "overview") => {
    actionRequestRef.current += 1;
    setPreviewSelection({ id, scope: currentScope });
    setPreviewTab(section);
    setPanel(null);
    setSelectedId(null);
    revealPreview();
  };
  const closePreview = () => {
    actionRequestRef.current += 1;
    setPreviewSelection(null);
    setPanel(null);
    setSelectedId(null);
  };
  useEffect(() => {
    if (!currentQuery || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const back = safeWorkbenchReturnTo(params.get("returnTo"));
    const href = new URL(saleWorkbenchHref(currentQuery, previewId), window.location.origin);
    if (back) href.searchParams.set("returnTo", back);
    const next = href.pathname + href.search;
    if (window.location.pathname + window.location.search !== next)
      window.history.replaceState(window.history.state, "", next);
  }, [currentScope, previewId, currentQuery]);
  const printer = useContractPrinter(
    workspace.query
      ? workspaceQueryKey(workspace.query)
      : `${requestedProjectId}/${activeBuildingId}`,
    locale,
    initialWorkspace,
  );
  useEffect(() => {
    if (!requestedProjectId || initialWorkspace) return;
    setPanel(null);
    setSelectedId(null);
    setFUnitId("");
  }, [requestedProjectId, initialWorkspace]);
  useEffect(() => {
    if (workspace.enabled)
      workspace.change({
        projectId: requestedProjectId ?? "",
        buildingId: activeBuildingId,
        status: statusFilter,
        search,
        locale,
        page:
          workspace.query?.projectId === (requestedProjectId ?? "") &&
          workspace.query?.buildingId === activeBuildingId &&
          workspace.query?.status === statusFilter &&
          workspace.query?.search === search
            ? workspace.query.page
            : 1,
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
            amountXof: salePrice(contract),
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
  const openAction = async (id: string, action: SaleWorkbenchAction) => {
    if (
      financeBusy.current ||
      saving ||
      workspace.unavailable ||
      (action === "payment" && !canRecordFinance) ||
      (["installment", "transfer"].includes(action) && !canManage) ||
      (action === "terminate" && !canTerminate)
    )
      return;
    const request = ++actionRequestRef.current;
    const identity = `${currentScope}/${id}`;
    setPanel(null);
    setSelectedId(null);
    setPayScheduleId("");
    setPayAmount(0);
    setPayReceiptNo("");
    setShowFlexForm(false);
    setTrDate("");
    setTermReason("");
    setError("");
    let fresh: SaleContractRow | undefined;
    let freshSchedules = schedules.filter((row) => row.sale_contract_id === id);
    if (workspace.enabled) {
      try {
        const detail = await workspace.ensure("detail", id);
        fresh = detail.contracts.find((row) => row.id === id) as SaleContractRow | undefined;
        freshSchedules = detail.schedules.filter((row) => row.sale_contract_id === id);
      } catch {
        return;
      }
    } else fresh = contracts.find((row) => row.id === id);
    // A scope change or another selection must never revive an old operation target.
    if (
      request !== actionRequestRef.current ||
      actionSelectionRef.current !== identity ||
      !fresh ||
      fresh.status !== "active"
    )
      return;
    setSelectedId(id);
    if (action === "payment") {
      setPayScheduleId(freshSchedules.find((row) => row.status !== "paid")?.id ?? "");
    } else if (action === "installment") {
      setShowFlexForm(true);
      setFlexDueDate("");
      setFlexAmount(0);
    } else if (action === "transfer") {
      setTrStatus(fresh.transfer_status);
      setTrDate(new Date().toISOString().slice(0, 10));
      setTrCertNo(fresh.title_certificate_no ?? "");
    }
    setPanel(action);
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
    if (!canRecordFinance || !selected || selected.status !== "active") return;
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
        setPanel(null);
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
    if (!canManage || !selected || selected.status !== "active" || !flexDueDate || flexAmount <= 0)
      return;
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
        setPanel(null);
      },
    );
  };
  const handleTransfer = async () => {
    if (!canManage || !selected || selected.status !== "active" || !trDate) return;
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
    if (!canTerminate || !selected || selected.status !== "active") return;
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
  const transText = (s: string) =>
    locale === "zh"
      ? ({ not_started: "未开始", in_progress: "办理中", completed: "已完成" }[s] ?? "待核实")
      : ({ not_started: "Non commencé", in_progress: "En cours", completed: "Terminé" }[s] ??
        "À vérifier");
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

  const statBlocks = saleWorkbenchStats(dashboardStats, locale);

  const scopeToolbar = (
    <SaleWorkbenchScope
      locale={locale}
      buildings={buildings}
      projectId={requestedProjectId}
      buildingId={activeBuildingId}
      noSaleProject={noSaleProject}
      returnTo={safeReturn}
      onProject={(id) => {
        setPanel(null);
        closePreview();
        router.push(`${locale === "fr" ? "/fr" : ""}/sales?project=${encodeURIComponent(id)}`);
      }}
      onBuilding={(id) => {
        setPanel(null);
        closePreview();
        setActiveBuildingId(id);
      }}
    />
  );
  const tableToolbar = (
    <SaleWorkbenchToolbar
      locale={locale}
      count={
        workspace.enabled
          ? `${workspace.pageData?.total ?? "—"} / ${workspace.pageData?.scopeCount ?? "—"}`
          : `${visibleContracts.length} / ${filteredByBuilding.length}`
      }
      search={search}
      view={contractView}
      status={statusFilter}
      onSearch={(value) => {
        setPanel(null);
        closePreview();
        setSearch(value);
      }}
      onView={(value) => {
        closePreview();
        void changeView(value);
      }}
      onStatus={(value) => {
        setPanel(null);
        closePreview();
        setStatusFilter(value);
      }}
    />
  );
  if (noSaleProject)
    return (
      <SaleNoSaleWorkspace locale={locale} projectId={requestedProjectId} scope={scopeToolbar} />
    );

  return (
    <OperationalPage
      className={styles.workbench}
      eyebrow="SALES WORKSPACE"
      title={locale === "zh" ? "出售履约台" : "Suivi des ventes"}
      description={
        locale === "zh"
          ? "合同、分期与过户，沿同一笔业务查看。"
          : "Contrats, échéances et transfert dans un même dossier."
      }
      action={
        canCreate ? (
          <Button
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={workspace.unavailable}
            onClick={openNew}
          >
            <Plus className="h-4 w-4" />
            {t.form.newContract}
          </Button>
        ) : undefined
      }
    >
      {scopeToolbar}
      <SaleWorkbenchSummary
        locale={locale}
        blocks={statBlocks}
        unavailable={workspace.unavailable}
        active={panel === "insight" ? statFilter : null}
        onOpen={(key) => void openInsight(key)}
      />
      {previewId ? (
        <button
          type="button"
          className="self-start rounded-md border border-border bg-card px-3 py-2 text-xs text-blue-700 min-[1200px]:hidden dark:text-blue-300"
          onClick={revealPreview}
        >
          {locale === "zh" ? "查看选中合同 ↓" : "Voir le contrat sélectionné ↓"}
        </button>
      ) : null}
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
      <div className={styles.grid}>
        <div className="min-w-0">
          {!workspace.unavailable && contractView === "table" && (
            <SaleWorkbenchTable
              pagination={
                workspace.pagination
                  ? {
                      ...workspace.pagination,
                      onPageChange: (page) => {
                        closePreview();
                        setPanel(null);
                        workspace.pagination?.onPageChange(page);
                      },
                      onSortChange: (key, direction) => {
                        closePreview();
                        setPanel(null);
                        workspace.pagination?.onSortChange(key, direction);
                      },
                    }
                  : undefined
              }
              rows={searchedTableRows}
              locale={locale}
              selectedId={previewId}
              onSelect={selectPreview}
              onNavigate={closePreview}
              toolbar={tableToolbar}
            />
          )}
          {contractView === "rooms" ? (
            <div className="mb-4 rounded-xl border bg-card">{tableToolbar}</div>
          ) : null}

          {!workspace.unavailable && contractView === "rooms" ? (
            <SaleWorkbenchRooms
              groups={groupedContracts}
              units={unitMap}
              customers={customerMap}
              summaries={contractSummaryMap}
              locale={locale}
              onOpen={(id, section) => selectPreview(id, section)}
              onPrint={printContract}
            />
          ) : null}
        </div>
        {!workspace.unavailable ? (
          <div
            className={styles.inspectorColumn}
            ref={previewColumnRef}
            data-selected={Boolean(previewId)}
            tabIndex={-1}
            role="region"
            aria-label={locale === "zh" ? "选中出售合同详情" : "Détails de la vente sélectionnée"}
          >
            <SaleWorkbenchInspector
              key={`${previewId ?? "empty"}-${previewTab}`}
              data={
                workspace.enabled
                  ? preview.data
                  : previewId
                    ? {
                        contracts: contracts.filter((row) => row.id === previewId),
                        units,
                        customers,
                        payments,
                        receivables,
                        schedules,
                        summaries: Object.fromEntries(contractSummaryMap),
                        buildings: buildings as WorkspaceData["buildings"],
                        today: new Date().toISOString().slice(0, 10),
                      }
                    : null
              }
              locale={locale}
              loading={workspace.enabled && preview.loading}
              error={workspace.enabled && preview.error}
              selectedId={previewId}
              returnTo={currentHref}
              onClose={closePreview}
              onRetry={preview.retry}
              initialTab={previewTab}
              canRecordFinance={canRecordFinance}
              canManage={canManage}
              canTerminate={canTerminate}
              busy={saving}
              onAction={(action) => {
                if (previewId) void openAction(previewId, action);
              }}
              onPrint={printContract}
            />
          </div>
        ) : null}
      </div>

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
                          onClick={() => selectPreview(row.contract.id)}
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

      {/* The inspector is the only contract detail. Drawers contain one action only. */}
      {selected && ["payment", "installment", "transfer", "terminate"].includes(panel ?? "") && (
        <SalePanelShell
          onClose={() => {
            if (!saving) setPanel(null);
          }}
          title={
            panel === "payment"
              ? locale === "zh"
                ? "登记出售收款"
                : "Enregistrer un paiement"
              : panel === "installment"
                ? locale === "zh"
                  ? "新增付款分期"
                  : "Ajouter une échéance"
                : panel === "transfer"
                  ? locale === "zh"
                    ? "更新过户进度"
                    : "Mettre à jour le transfert"
                  : locale === "zh"
                    ? "确认终止出售合同"
                    : "Confirmer la résiliation"
          }
        >
          <div className="space-y-5">
            <p className="border-b pb-4 text-sm text-muted-foreground">
              {selected.contract_no} · {selectedBuilding?.display_name ?? "—"} ·{" "}
              {selectedUnit?.unit_no ?? "—"} · {selectedCustomer?.name ?? "—"}
            </p>
            {/* Pay form */}
            {canRecordFinance && panel === "payment" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="sale-action-schedule" className="text-xs text-muted-foreground">
                      {locale === "zh" ? "选择分期" : "Echeance"}
                    </label>
                    <select
                      id="sale-action-schedule"
                      disabled={saving}
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
                    <label
                      htmlFor="sale-action-payment-date"
                      className="text-xs text-muted-foreground"
                    >
                      {locale === "zh" ? "收款日期" : "Date"}
                    </label>
                    <DateInput
                      id="sale-action-payment-date"
                      disabled={saving}
                      value={payDate}
                      onChangeValue={setPayDate}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sale-action-amount" className="text-xs text-muted-foreground">
                      {locale === "zh" ? "金额" : "Montant"}
                    </label>
                    <input
                      id="sale-action-amount"
                      disabled={saving}
                      type="number"
                      value={payAmount}
                      onChange={(e) => setPayAmount(Number(e.target.value))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sale-action-receipt" className="text-xs text-muted-foreground">
                      {locale === "zh" ? "收据号" : "Recu"}
                    </label>
                    <input
                      id="sale-action-receipt"
                      disabled={saving}
                      type="text"
                      value={payReceiptNo}
                      onChange={(e) => setPayReceiptNo(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  {!contractSchedules.some((schedule) => schedule.status !== "paid") ? (
                    <p className="text-xs text-muted-foreground">
                      {locale === "zh"
                        ? "暂无可选分期，请先核对付款计划。"
                        : "Aucune échéance disponible. Vérifiez le plan de paiement."}
                    </p>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={handlePay}
                    disabled={saving || !payScheduleId || payAmount <= 0}
                  >
                    {saving ? "..." : locale === "zh" ? "确认收款" : "Encaisser"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setPayScheduleId("");
                      setPanel(null);
                      setError("");
                    }}
                  >
                    {locale === "zh" ? "取消" : "Annuler"}
                  </Button>
                </div>
              </div>
            )}

            {/* Flex installment form */}
            {canManage && panel === "installment" && showFlexForm && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="sale-action-due-date" className="text-xs text-muted-foreground">
                      {locale === "zh" ? "到期日" : "Echeance"}
                    </label>
                    <DateInput
                      id="sale-action-due-date"
                      disabled={saving}
                      value={flexDueDate}
                      onChangeValue={setFlexDueDate}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sale-action-amount" className="text-xs text-muted-foreground">
                      {locale === "zh" ? "金额" : "Montant"}
                    </label>
                    <input
                      id="sale-action-amount"
                      disabled={saving}
                      type="number"
                      value={flexAmount}
                      onChange={(e) => setFlexAmount(Number(e.target.value))}
                      className={inputClass}
                    />
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddFlex}
                    disabled={saving || !flexDueDate || flexAmount <= 0}
                  >
                    {saving ? "..." : locale === "zh" ? "新增" : "Ajouter"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setShowFlexForm(false);
                      setPanel(null);
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
            {canManage && panel === "transfer" && selected.status === "active" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label
                      htmlFor="sale-action-transfer-status"
                      className="text-xs text-muted-foreground"
                    >
                      {locale === "zh" ? "过户状态" : "Transfert"}
                    </label>
                    <select
                      id="sale-action-transfer-status"
                      disabled={saving}
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
                    <label
                      htmlFor="sale-action-transfer-date"
                      className="text-xs text-muted-foreground"
                    >
                      {locale === "zh" ? "过户日期" : "Date"}
                    </label>
                    <DateInput
                      id="sale-action-transfer-date"
                      disabled={saving}
                      value={trDate}
                      onChangeValue={setTrDate}
                      className={inputClass}
                    />
                  </div>
                  <div className="col-span-2">
                    <label
                      htmlFor="sale-action-certificate"
                      className="text-xs text-muted-foreground"
                    >
                      {locale === "zh" ? "产权证号" : "Titre"}
                    </label>
                    <input
                      id="sale-action-certificate"
                      disabled={saving}
                      type="text"
                      value={trCertNo}
                      onChange={(e) => setTrCertNo(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleTransfer} disabled={saving || !trDate}>
                    {saving ? "..." : locale === "zh" ? "保存" : "OK"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setTrDate("");
                      setPanel(null);
                    }}
                  >
                    {locale === "zh" ? "取消" : "Annuler"}
                  </Button>
                </div>
              </div>
            )}
            {canTerminate && panel === "terminate" && selected.status === "active" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {locale === "zh"
                    ? "终止后保留历史合同与财务记录，不代表已退款或欠款已清。请核对后确认。"
                    : "Les contrats et écritures restent conservés. La résiliation ne confirme ni un remboursement ni le règlement des dettes."}
                </p>
                <label className="block space-y-2 text-sm">
                  <span>{locale === "zh" ? "终止原因" : "Motif"}</span>
                  <textarea
                    disabled={saving}
                    className={inputClass}
                    value={termReason}
                    onChange={(event) => setTermReason(event.target.value)}
                    rows={3}
                  />
                </label>
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button variant="destructive" disabled={saving} onClick={handleTerminateSale}>
                    {saving ? "…" : locale === "zh" ? "确认终止" : "Confirmer la résiliation"}
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => setPanel(null)}>
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
