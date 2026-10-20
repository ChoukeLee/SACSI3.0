"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { LeaseRentPeriodCorrection } from "./lease-rent-period-correction";
import { leaseRequestIdentity, clearLeaseRequestIdentity } from "./lease-request-identity";
import {
  Plus,
  AlertTriangle,
  FileText,
  DollarSign,
  LogOut,
  Printer,
  Eye,
  CalendarClock,
  Phone,
  ChevronRight,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { nativeLease, leaseRentLabel } from "@/lib/native-money";
import { NativeLeaseFinance } from "./native-lease-finance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { RoomCard } from "@/components/room-card";
import { RoomBoard } from "@/components/room-board";
import { RoomLegend } from "@/components/room-legend";
import { EmptyState } from "@/components/empty-state";
import {
  OperationalPage,
  RightDrawer,
  SegmentedControl,
  controlClass,
} from "@/components/ui/operational";
import type { RoomVisualStatus } from "@/lib/status-styles";
import type {
  LeaseContractRow,
  UnitRow,
  CustomerRow,
  PaymentRow,
  ReceivableRow,
} from "@/types/database";
import type { ContractStatus, CurrencyCode } from "@/types/domain";
import { contractStatusVariant as statusVariant } from "@/lib/status-styles";
import { printLeaseContract } from "@/features/print";
import {
  createLeaseContract,
  activateContract,
  terminateContract,
  processMoveOut,
  recordLeaseFinancialEntry,
} from "./actions";
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
import {
  isOverdueReceivable,
  resolveLeaseOverdue,
  summarizeLeaseReceivables,
} from "./lease-receivable-summary";
import {
  ALL_BUILDINGS,
  groupLeaseBuildings,
  resolveBuildingScope,
  type LeaseBuilding,
} from "./project-scope";
import { ContractListControls } from "@/features/contracts/contract-table";
import { LeaseWorkbenchTable } from "./lease-workbench-table";
import { LeaseWorkbenchInspector } from "./lease-workbench-inspector";
import { useLeaseWorkbenchPreview } from "./use-lease-workbench-preview";
import styles from "./lease-workbench.module.css";
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
import { computeFinanceMetrics } from "@/features/finance/metrics";
import { resolveContractProjectLink } from "@/features/contracts/project-link";
import { useContractWorkspace } from "@/features/contracts/use-workspace";
import type { WorkspaceData } from "@/features/contracts/workspace-model";
import { workspaceQueryKey } from "@/features/contracts/workspace-model";
import { useContractPrinter } from "@/features/contracts/use-contract-printer";
import {
  defaultLeaseScope,
  leaseScopeStorageKey,
  LEASE_SCOPE_LEGACY_KEY,
  LEASE_SCOPE_LEGACY_CLAIM_KEY,
  serializeLeaseScope,
  type LeaseScopePreference,
} from "@/features/contracts/lease-scope-preference";

interface UnitBusinessFlag {
  business_type: "daily_rental" | "long_lease" | "sale";
  is_enabled: boolean;
  default_price_xof: number | null;
}

type LeaseUnitRow = UnitRow & {
  unit_business_flags?: UnitBusinessFlag[];
};

interface LeaseListProps {
  workspace?: WorkspaceData;
  initialProject?: string;
  initialBuilding?: string;
  initialContract?: string;
  returnTo?: string;
  scopePreference?: LeaseScopePreference;
  contracts: LeaseContractRow[];
  units: LeaseUnitRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  buildings: LeaseBuilding[];
  locale: Locale;
  canCreate?: boolean;
  canRecordFinance?: boolean;
  canCorrectRentPeriod?: boolean;
  canActivate?: boolean;
  canMoveOut?: boolean;
}
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
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000,
  );
}

function isManagedLeaseUnit(unit: LeaseUnitRow) {
  return (
    unit.status === "sold" &&
    unit.unit_business_flags?.some((flag) => flag.business_type === "long_lease" && flag.is_enabled)
  );
}

function getLeaseDataFlags(contract: LeaseContractRow, customer?: CustomerRow | null) {
  return {
    needsData:
      (nativeLease(contract)
        ? Number(contract.monthly_rent_amount) <= 0
        : Number(contract.monthly_rent_xof) <= 0) ||
      Number(contract.deposit_amount_xof) <= 0 ||
      !contract.start_date ||
      !contract.expected_end_date ||
      contract.expected_end_date >= "2099-01-01" ||
      customer?.name.includes("资料待补") ||
      customer?.name.includes("待补充") ||
      customer?.notes?.includes("legacy_placeholder=true"),
  };
}

function isContractEndConfirmed(contract: LeaseContractRow) {
  return !!contract.expected_end_date && contract.expected_end_confirmed !== false;
}

function isPaidThroughOverdue(contract: LeaseContractRow) {
  return (
    !!contract.paid_through_date &&
    contract.paid_through_date < new Date().toISOString().slice(0, 10)
  );
}

function paymentAmountXof(payment: PaymentRow) {
  return payment.currency === "XOF"
    ? Number(payment.amount)
    : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
}

function getRecordedOriginalPayment(payment: PaymentRow) {
  const metadata = payment.notes?.match(
    /original_currency=([A-Z]{3});original_amount=([\d.]+);original_period_months=(\d+)/,
  );
  if (!metadata) return null;
  const amount = Number(metadata[2]);
  const periodMonths = Number(metadata[3]);
  if (amount <= 0 || periodMonths <= 0) return null;
  return { currency: metadata[1], amount, periodMonths };
}

function getOriginalMonthlyRent(contract: LeaseContractRow, payments: PaymentRow[]) {
  if (nativeLease(contract)) return null;
  const contractPayments = payments
    .filter((payment) => payment.source_id === contract.id && payment.source_type === "lease_rent")
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const originalCurrencyPayments = contractPayments.filter(
    (payment) => payment.currency !== "XOF" && Number(payment.exchange_rate_to_xof) > 0,
  );
  const originalCurrency = originalCurrencyPayments[0]?.currency;
  if (
    originalCurrency &&
    originalCurrencyPayments.every((payment) => payment.currency === originalCurrency)
  ) {
    return {
      currency: originalCurrency,
      amount:
        Number(contract.monthly_rent_xof) /
        Number(originalCurrencyPayments[0].exchange_rate_to_xof),
    };
  }

  for (const payment of contractPayments) {
    const recordedOriginal = getRecordedOriginalPayment(payment);
    if (recordedOriginal)
      return {
        currency: recordedOriginal.currency,
        amount: recordedOriginal.amount / recordedOriginal.periodMonths,
      };
  }
  return null;
}

export function LeaseList({
  workspace: initialWorkspace,
  initialProject,
  initialBuilding,
  initialContract,
  returnTo,
  scopePreference,
  contracts: initialContracts,
  units: initialUnits,
  customers: initialCustomers,
  payments: initialPayments,
  receivables: initialReceivables,
  buildings,
  locale,
  canCreate = true,
  canRecordFinance = true,
  canCorrectRentPeriod = false,
  canActivate = true,
  canMoveOut = true,
}: LeaseListProps) {
  const router = useRouter();
  const workspace = useContractWorkspace(initialWorkspace);
  const contracts = (workspace.data?.contracts ?? initialContracts) as LeaseContractRow[];
  const units = (workspace.data?.units ?? initialUnits) as LeaseUnitRow[];
  const customers = workspace.data?.customers ?? initialCustomers;
  const payments = workspace.data?.payments ?? initialPayments;
  const receivables = workspace.data?.receivables ?? initialReceivables;
  const t = dictionaries[locale].leases;
  const formatXof = (amount: number) => formatContractXof(amount, locale);
  const [statusFilter, setStatusFilter] = useState<string>("current");
  const [contractView, setContractView] = useState<"table" | "rooms">("table");
  const [search, setSearch] = useState("");
  const [statFilter, setStatFilter] = useState<LeaseStatFilter | null>(null);
  const [panel, setPanel] = useState<PanelType>(null);
  useEffect(() => {
    if (
      workspace.enabled &&
      contractView === "table" &&
      panel !== "insight" &&
      panel !== "attention"
    )
      workspace.closeScope();
  }, [workspace.enabled, workspace.closeScope, contractView, panel]);
  const [detailSection, setDetailSection] = useState<"overview" | "finance">("overview");
  const [attentionTab, setAttentionTab] = useState<AttentionTab>("overdue");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewSelection, setPreviewSelection] = useState<{
    id: string;
    scope: string;
    page: WorkspaceData | undefined;
    contracts: LeaseContractRow[];
    version: number;
  } | null>(null);
  const [linkedPreviewDismissed, setLinkedPreviewDismissed] = useState(false);
  const safeReturnTo = safeWorkbenchReturnTo(returnTo);
  useEffect(() => {
    setLinkedPreviewDismissed(false);
    setPreviewSelection(null);
  }, [initialProject, initialBuilding, initialContract]);
  const previewVersion = useRef(0);
  const previewColumnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [writeConfirmed, setWriteConfirmed] = useState(false);
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
  const [moEndDate, setMoEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [moUnpaid, setMoUnpaid] = useState(0);
  const [moUtility, setMoUtility] = useState(false);
  const [moDeduction, setMoDeduction] = useState(0);
  const [moRefund, setMoRefund] = useState(0);
  const [financeType, setFinanceType] = useState<LeaseFinancialBusinessType>("rent_income");
  const [financeDate, setFinanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [financeAmountWan, setFinanceAmountWan] = useState(0);
  const [financeCurrency, setFinanceCurrency] = useState<CurrencyCode>("XOF");
  const [financeExchangeRate, setFinanceExchangeRate] = useState(1);
  const [financeExternalReceiptNo, setFinanceExternalReceiptNo] = useState("");
  const [financePaidThrough, setFinancePaidThrough] = useState("");
  const [financeMethod, setFinanceMethod] = useState<
    "cash" | "check" | "bank_transfer" | "offset" | "other"
  >("other");
  const [financeNotes, setFinanceNotes] = useState("");
  const financeRequestIdRef = useRef<string | null>(null);
  const lifecycleBusy = useRef(false);
  const [moCollectedConfirmed, setMoCollectedConfirmed] = useState(false);
  const [moMethod, setMoMethod] = useState<
    "cash" | "check" | "bank_transfer" | "offset" | "other" | ""
  >("");
  const financeSectionRef = useRef<HTMLDivElement | null>(null);

  const projects = useMemo(() => groupLeaseBuildings(buildings), [buildings]);
  const requestedProjectId = resolveContractProjectLink(buildings, initialProject);
  const requestedBuildingId = initialBuilding
    ? buildings.find(
        (b) =>
          b.id === initialBuilding && (!requestedProjectId || b.project_id === requestedProjectId),
      )?.id
    : undefined;
  const scopeStorageKey = leaseScopeStorageKey(scopePreference?.cookieName);
  const [scope, setScope] = useState(() => {
    const initial = defaultLeaseScope(buildings);
    const serverScope = scopePreference && initialWorkspace ? initialWorkspace.query : undefined;
    const projectId = requestedProjectId ?? serverScope?.projectId ?? initial.projectId;
    return {
      projectId,
      buildings: {
        [projectId]: requestedProjectId
          ? (requestedBuildingId ?? ALL_BUILDINGS)
          : serverScope
            ? serverScope.buildingId || ALL_BUILDINGS
            : initial.buildingId || ALL_BUILDINGS,
      } as Record<string, string>,
    };
  });
  const [scopeLoaded, setScopeLoaded] = useState(false);
  useEffect(() => {
    let canReadLegacy = false;
    if (scopePreference?.cookieName) {
      try {
        let owner = localStorage.getItem(LEASE_SCOPE_LEGACY_CLAIM_KEY);
        if (!owner && localStorage.getItem(LEASE_SCOPE_LEGACY_KEY)) {
          owner = scopePreference.cookieName;
          localStorage.setItem(LEASE_SCOPE_LEGACY_CLAIM_KEY, owner);
        }
        canReadLegacy = owner === scopePreference.cookieName;
      } catch {
        /* Do not import a shared legacy preference if ownership cannot be established. */
      }
    }
    if (requestedProjectId) {
      setScope((current) => ({
        ...current,
        projectId: requestedProjectId,
        buildings: {
          ...current.buildings,
          [requestedProjectId]: requestedBuildingId ?? ALL_BUILDINGS,
        },
      }));
      setPanel(null);
      setSelectedId(null);
      setFUnitId("");
      setScopeLoaded(true);
      return;
    }
    const serverScope = scopePreference?.serverResolved ? initialWorkspace?.query : undefined;
    let restored: { projectId: string; buildings: Record<string, string> } | undefined;
    try {
      let raw = localStorage.getItem(scopeStorageKey);
      if (!raw && canReadLegacy) {
        raw = localStorage.getItem(LEASE_SCOPE_LEGACY_KEY);
      }
      const saved = JSON.parse(raw ?? "null");
      if (
        saved &&
        typeof saved.projectId === "string" &&
        saved.buildings &&
        typeof saved.buildings === "object" &&
        !Array.isArray(saved.buildings)
      ) {
        const remembered = Object.fromEntries(
          Object.entries(saved.buildings).filter(([, value]) => typeof value === "string"),
        ) as Record<string, string>;
        restored = { projectId: saved.projectId, buildings: remembered };
      }
    } catch {
      /* Storage is optional. */
    }
    if (serverScope) {
      setScope((current) => ({
        projectId: serverScope.projectId,
        buildings: {
          ...current.buildings,
          ...restored?.buildings,
          [serverScope.projectId]: serverScope.buildingId || ALL_BUILDINGS,
        },
      }));
    } else if (restored) setScope(restored);
    setScopeLoaded(true);
  }, [
    requestedProjectId,
    requestedBuildingId,
    scopeStorageKey,
    scopePreference?.cookieName,
    scopePreference?.serverResolved,
    initialWorkspace?.query.projectId,
    initialWorkspace?.query.buildingId,
  ]);
  useEffect(() => {
    if (scopeLoaded) {
      try {
        localStorage.setItem(scopeStorageKey, JSON.stringify(scope));
      } catch {
        /* Storage is optional. */
      }
    }
  }, [scope, scopeLoaded, scopeStorageKey]);
  const project = projects.find((p) => p.id === scope.projectId) ?? projects[0];
  const projectBuildings = project?.buildings ?? [];
  const activeBuildingId = resolveBuildingScope(
    projectBuildings,
    scope.buildings[project?.id ?? ""],
  );
  useEffect(() => {
    if (!scopeLoaded || !scopePreference?.cookieName || !project?.id || project.id === "unassigned")
      return;
    try {
      document.cookie = `${scopePreference.cookieName}=${serializeLeaseScope(project.id, activeBuildingId)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch {
      /* A navigation preference is optional, never a prerequisite to business reads. */
    }
  }, [scopeLoaded, scopePreference?.cookieName, project?.id, activeBuildingId]);
  const scopeBuildingIds = new Set(
    projectBuildings
      .filter((b) => activeBuildingId === ALL_BUILDINGS || b.id === activeBuildingId)
      .map((b) => b.id),
  );
  const projectLabel = (p: typeof project) =>
    p?.code === "SACSI"
      ? locale === "zh"
        ? "公寓项目"
        : "Résidences SACSI"
      : p?.code === "CIMAC"
        ? locale === "zh"
          ? "科建建材城"
          : "CIMAC"
        : p?.name || (locale === "zh" ? "未归属项目" : "Projet non affecté");
  const scopeLabel = `${projectLabel(project)} · ${activeBuildingId === ALL_BUILDINGS ? (locale === "zh" ? "全部楼栋合计" : "Tous les bâtiments") : (projectBuildings.find((b) => b.id === activeBuildingId)?.display_name ?? "")}`;
  const printer = useContractPrinter(
    workspace.query ? workspaceQueryKey(workspace.query) : `${project?.id}/${activeBuildingId}`,
    locale,
    initialWorkspace,
  );
  const closeScopePanel = () => {
    setLinkedPreviewDismissed(true);
    setPreviewSelection(null);
    setPanel(null);
    setSelectedId(null);
    setFUnitId("");
    setError("");
  };
  useEffect(() => {
    if (!workspace.enabled || !scopeLoaded) return;
    workspace.change({
      projectId: project?.id === "unassigned" ? "" : (project?.id ?? ""),
      buildingId: activeBuildingId === ALL_BUILDINGS ? "" : activeBuildingId,
      status: statusFilter,
      search,
      locale,
      page: 1,
    });
  }, [
    workspace.enabled,
    workspace.change,
    scopeLoaded,
    project?.id,
    activeBuildingId,
    statusFilter,
    search,
    locale,
  ]);
  const changeProject = (projectId: string) => {
    setScope((current) => ({ ...current, projectId }));
    closeScopePanel();
  };
  const changeBuilding = (id: string) => {
    if (project)
      setScope((current) => ({
        ...current,
        buildings: { ...current.buildings, [project.id]: id },
      }));
    closeScopePanel();
  };

  // Build unit -> building_id map
  const unitBuildingMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.building_id);
    return m;
  }, [units]);

  const filteredByBuilding = useMemo(() => {
    const ids = new Set(
      project?.buildings
        .filter((b) => activeBuildingId === ALL_BUILDINGS || b.id === activeBuildingId)
        .map((b) => b.id),
    );
    return contracts.filter((c) => ids.has(unitBuildingMap.get(c.unit_id) ?? ""));
  }, [contracts, project, activeBuildingId, unitBuildingMap]);

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const buildingMap = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filteredByStatus = useMemo(
    () =>
      statusFilter === "current"
        ? filteredByBuilding.filter((c) => c.status !== "terminated")
        : statusFilter === "all"
          ? filteredByBuilding
          : filteredByBuilding.filter((c) => c.status === statusFilter),
    [filteredByBuilding, statusFilter],
  );

  const contractSummaryMap = useMemo(
    () =>
      new Map([
        ...Object.entries(workspace.data?.summaries ?? {}),
        ...buildContractReceivableSummaries(receivables, "lease_contract", todayStr),
      ]),
    [receivables, todayStr, workspace.data?.summaries],
  );
  const tableRows = useMemo<ContractTableRow[]>(
    () =>
      filteredByStatus
        .filter(
          (contract) =>
            !workspace.enabled ||
            workspace.pageData?.contracts.some((row) => row.id === contract.id),
        )
        .map((contract) => {
          const unit = unitMap.get(contract.unit_id);
          const customer = customerMap.get(contract.customer_id);
          const summary = contractSummaryMap.get(contract.id) ?? EMPTY_CONTRACT_RECEIVABLE_SUMMARY;
          const confirmedEnd = isContractEndConfirmed(contract);
          const longTerm = confirmedEnd && contract.expected_end_date >= "2099-01-01";
          return {
            id: contract.id,
            contractNo: contract.contract_no,
            building: buildingMap.get(unit?.building_id ?? "")?.display_name ?? "—",
            unit: unit?.unit_no ?? "—",
            customer: customer?.name ?? (locale === "zh" ? "客户待补" : "Client à compléter"),
            searchText: customer?.phone ?? "",
            periodStart: contract.start_date ?? "",
            periodLabel: `${contract.start_date ?? (locale === "zh" ? "待确认" : "À confirmer")} → ${!confirmedEnd ? (locale === "zh" ? "期限待确认" : "Fin à confirmer") : longTerm ? (locale === "zh" ? "长期" : "Long terme") : contract.expected_end_date}`,
            periodDetail: contract.paid_through_date
              ? `${locale === "zh" ? "已缴至" : "Payé au"} ${contract.paid_through_date}`
              : undefined,
            amountXof:
              Number(contract.monthly_rent_xof) > 0 ? Number(contract.monthly_rent_xof) : null,
            nativeAmountLabel: nativeLease(contract) ? leaseRentLabel(contract, locale) : undefined,
            nativeBalanceLabel: nativeLease(contract)
              ? `${contract.rent_currency} · ${locale === "zh" ? "原币账务另列" : "voir le détail en devise"}`
              : undefined,
            amountDetail: `${locale === "zh" ? "每月" : "par mois"} · ${contract.rent_currency ?? "XOF"}`,
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
              unit && isManagedLeaseUnit(unit)
                ? locale === "zh"
                  ? "代管"
                  : "Gestion déléguée"
                : undefined,
            needsReview: Boolean(getLeaseDataFlags(contract, customer).needsData),
          };
        }),
    [
      filteredByStatus,
      unitMap,
      customerMap,
      contractSummaryMap,
      buildingMap,
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
  const previewScope = JSON.stringify([
    project?.id,
    activeBuildingId,
    statusFilter,
    search,
    contractView,
    workspace.query ? workspaceQueryKey(workspace.query) : null,
  ]);
  const linkedPreviewId =
    !linkedPreviewDismissed &&
    scopeLoaded &&
    requestedProjectId === project?.id &&
    workspace.query?.projectId === requestedProjectId &&
    workspace.query.buildingId === (requestedBuildingId ?? "") &&
    activeBuildingId === (requestedBuildingId ?? ALL_BUILDINGS) &&
    statusFilter === "current" &&
    !search &&
    initialContract &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(initialContract)
      ? initialContract
      : null;
  const previewId =
    !workspace.unavailable && panel === null && contractView === "table"
      ? (linkedPreviewId ??
        (previewSelection?.scope === previewScope &&
        previewSelection.page === workspace.pageData &&
        previewSelection.contracts === initialContracts &&
        searchedTableRows.some((row) => row.id === previewSelection.id)
          ? previewSelection.id
          : null))
      : null;
  const preview = useLeaseWorkbenchPreview(workspace.query, previewId, previewSelection?.version);
  const previewContract = previewId
    ? workspace.enabled
      ? ((preview.data?.contracts.find((row) => row.id === previewId) as
          LeaseContractRow | undefined) ?? null)
      : (contracts.find((row) => row.id === previewId) ?? null)
    : null;
  const previewUnits = workspace.enabled ? preview.data?.units : units;
  const previewCustomers = workspace.enabled ? preview.data?.customers : customers;
  const previewUnit = previewUnits?.find((row) => row.id === previewContract?.unit_id) ?? null;
  const previewCustomer =
    previewCustomers?.find((row) => row.id === previewContract?.customer_id) ?? null;
  const previewPayments = workspace.enabled ? (preview.data?.payments ?? []) : payments;
  const previewReceivables = workspace.enabled ? (preview.data?.receivables ?? []) : receivables;
  const selectPreview = (id: string) => {
    setLinkedPreviewDismissed(true);
    if (id === previewId && preview.error) preview.retry();
    setPreviewSelection({
      id,
      scope: previewScope,
      page: workspace.pageData,
      contracts: initialContracts,
      version: ++previewVersion.current,
    });
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1279px)").matches
    ) {
      requestAnimationFrame(() => {
        const target = previewColumnRef.current;
        if (!target) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      });
    }
  };
  const syncVisiblePreview = useCallback((ids: string[]) => {
    setPreviewSelection((current) => (current && !ids.includes(current.id) ? null : current));
  }, []);
  const filtered = useMemo(() => {
    if (workspace.enabled && contractView === "rooms")
      return filteredByStatus.filter((row) =>
        workspace.scopeData?.contracts.some((c) => c.id === row.id),
      );
    const searchedIds = new Set(searchedTableRows.map((row) => row.id));
    return filteredByStatus.filter((contract) => searchedIds.has(contract.id));
  }, [searchedTableRows, filteredByStatus, workspace.enabled, workspace.scopeData, contractView]);

  const groupedContracts = useMemo(() => {
    const grouped = new Map<string, LeaseContractRow[]>();
    for (const contract of filtered) {
      const unit = unitMap.get(contract.unit_id);
      const floor = normalizeFloorLabel(unit?.floor_label ?? null, unit?.unit_no ?? "");
      const key = `${unit?.building_id ?? ""}|${floor}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(contract);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => {
        const [ab, af] = a.split("|");
        const [bb, bf] = b.split("|");
        return (
          (buildingMap.get(ab)?.code ?? "").localeCompare(
            buildingMap.get(bb)?.code ?? "",
            undefined,
            { numeric: true },
          ) || floorSortValue(af) - floorSortValue(bf)
        );
      })
      .map(
        ([floor, floorContracts]) =>
          [
            activeBuildingId === ALL_BUILDINGS
              ? `${buildingMap.get(floor.split("|")[0])?.display_name ?? ""} · ${floor.split("|")[1]}`
              : floor.split("|")[1],
            [...floorContracts].sort((a, b) => {
              const aUnit = unitMap.get(a.unit_id)?.unit_no ?? "";
              const bUnit = unitMap.get(b.unit_id)?.unit_no ?? "";
              return aUnit.localeCompare(bUnit, undefined, { numeric: true });
            }),
          ] as [string, LeaseContractRow[]],
      );
  }, [filtered, unitMap, buildingMap, activeBuildingId]);

  const getContractReceivableSummary = (contractId: string) => {
    return contractSummaryMap.get(contractId) ?? EMPTY_CONTRACT_RECEIVABLE_SUMMARY;
  };

  const selected =
    selectedId &&
    (!workspace.enabled ||
      (!workspace.unavailable && workspace.detailData?.contracts[0]?.id === selectedId))
      ? contracts.find((c) => c.id === selectedId)
      : null;
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
      const related = receivables.filter(
        (row) =>
          row.source_type === "lease_contract" &&
          row.source_id === contract.id &&
          row.status !== "cancelled" &&
          row.management_status !== "historical_pending" &&
          row.management_status !== "excluded",
      );
      const summary = summarizeLeaseReceivables(related, today);
      const coverageDue = contract.paid_through_date
        ? addDaysToIso(contract.paid_through_date, 1)
        : null;
      const overdueResolution = workspace.enabled
        ? (workspace.data?.accruals[contract.id] ?? null)
        : resolveLeaseOverdue({
            receivables: related,
            today,
            paidThroughDate: contract.paid_through_date ?? null,
            monthlyRentXof: Number(contract.monthly_rent_xof),
            contractStatus: contract.status,
            actualEndDate: contract.actual_end_date,
          });
      const projected = workspace.data?.summaries[contract.id];
      const dueDate =
        overdueResolution?.dueDate ??
        (workspace.enabled
          ? workspace.data?.attentionDue[contract.id]
          : summary.earliestOutstandingDue) ??
        coverageDue;
      if (!dueDate) return [];
      const isOverdue = overdueResolution !== null;
      const isUpcoming = !isOverdue && dueDate <= upcomingLimit;
      if (!isOverdue && !isUpcoming) return [];
      const building = buildingMap.get(unit.building_id);
      return [
        {
          contract,
          unit,
          customer,
          buildingName: building?.display_name || building?.code || "-",
          dueDate,
          paidThrough: contract.paid_through_date,
          amount: overdueResolution
            ? overdueResolution.amount
            : (projected?.outstanding ?? summary.outstanding) > 0
              ? (projected?.outstanding ?? summary.outstanding)
              : Number(contract.monthly_rent_xof),
          amountIsEstimated:
            overdueResolution?.source === "contract" ||
            (!overdueResolution && (projected?.outstanding ?? summary.outstanding) <= 0),
          days: diffIsoDays(today, dueDate),
          kind: isOverdue ? ("overdue" as const) : ("upcoming" as const),
        },
      ];
    });
    return {
      overdue: rows
        .filter((row) => row.kind === "overdue")
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      upcoming: rows
        .filter((row) => row.kind === "upcoming")
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    };
  }, [
    buildings,
    customerMap,
    filteredByBuilding,
    receivables,
    unitMap,
    workspace.enabled,
    workspace.data,
  ]);

  const dashboardStats = useMemo(() => {
    if (workspace.enabled && workspace.pageData) return workspace.pageData.stats;
    const active = filteredByBuilding.filter((c) => c.status === "active");
    const scopeIds = new Set(filteredByBuilding.map((contract) => contract.id));
    const related = receivables.filter(
      (row) => row.source_type === "lease_contract" && row.source_id && scopeIds.has(row.source_id),
    );
    const metrics = computeFinanceMetrics(related, { asOfDate: todayStr });
    const unknownContracts = filteredByBuilding.filter(
      (contract) => !contractSummaryMap.has(contract.id),
    ).length;
    return {
      active: active.length,
      rent: active.reduce((sum, c) => sum + Number(c.monthly_rent_xof), 0),
      dueSoon: leaseAttention.upcoming.length,
      currentDue: metrics.outstanding,
      overdue: metrics.overdue,
      overdueContracts: filteredByBuilding.filter(
        (contract) => (contractSummaryMap.get(contract.id)?.overdue ?? 0) > 0,
      ).length,
      unknownContracts,
      unknownAll: filteredByBuilding.length > 0 && metrics.count === 0,
    };
  }, [
    filteredByBuilding,
    leaseAttention.upcoming.length,
    contractSummaryMap,
    receivables,
    todayStr,
    workspace.enabled,
    workspace.pageData,
  ]);

  const leaseInsightContracts = useMemo(() => {
    return filteredByBuilding
      .map((contract) => {
        const unit = unitMap.get(contract.unit_id);
        const customer = customerMap.get(contract.customer_id);
        const summary = contractSummaryMap.get(contract.id) ?? EMPTY_CONTRACT_RECEIVABLE_SUMMARY;
        return {
          contract,
          unit,
          customer,
          summary,
        };
      })
      .filter((row) => row.unit)
      .sort((a, b) =>
        (a.unit?.unit_no ?? "").localeCompare(b.unit?.unit_no ?? "", undefined, { numeric: true }),
      );
  }, [customerMap, filteredByBuilding, contractSummaryMap, unitMap]);

  const currentDueRows = leaseInsightContracts
    .filter((row) => row.summary.outstanding > 0)
    .map((row) => ({
      ...row,
      buildingName: buildingMap.get(row.unit?.building_id ?? "")?.display_name ?? "—",
      dueDate: row.summary.nextDue,
      amount: row.summary.outstanding,
    }));
  const managedOverdueRows = leaseAttention.overdue.filter((row) => !row.amountIsEstimated);

  const contractReceivables = useMemo(
    () =>
      selectedId
        ? receivables.filter(
            (r) =>
              r.source_type === "lease_contract" &&
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
  const leaseCash = useMemo(() => summarizeContractCash(contractPayments), [contractPayments]);
  const totalIncome = leaseCash.income;
  const totalExpense = leaseCash.expense;
  const netFinancial = leaseCash.net;
  const receivableStats = useMemo(() => {
    const metrics = computeFinanceMetrics(contractReceivables, { asOfDate: todayStr });
    return {
      totalReceivable: metrics.receivable,
      totalPaid: metrics.collected,
      outstanding: metrics.outstanding,
      overdue: metrics.overdue,
      known: metrics.count > 0,
    };
  }, [contractReceivables, todayStr]);
  const contractRisk = useMemo(() => {
    if (!selected || selected.status !== "active" || !isContractEndConfirmed(selected))
      return { expiringSoon: false, daysLeft: 0 };
    const today = new Date();
    const diff = Math.floor(
      (new Date(selected.expected_end_date).getTime() - today.getTime()) / 86400000,
    );
    return { expiringSoon: diff <= 30 && diff >= 0, daysLeft: Math.max(0, diff) };
  }, [selected]);
  const availableUnits = units.filter(
    (u) =>
      scopeBuildingIds.has(u.building_id) &&
      (u.status === "available" || isManagedLeaseUnit(u)) &&
      (!workspace.enabled ||
        (u.unit_business_flags ?? []).some(
          (flag) => flag.business_type === "long_lease" && flag.is_enabled,
        )),
  );
  const selectedNewUnit = useMemo(
    () => units.find((unit) => unit.id === fUnitId),
    [fUnitId, units],
  );
  const generatedLeaseContractNo = useMemo(() => {
    if (!selectedNewUnit || !fStartDate) return "";
    const building = buildingMap.get(selectedNewUnit.building_id);
    return buildLeaseContractNumber(building?.code ?? "SACSI", selectedNewUnit.unit_no, fStartDate);
  }, [buildingMap, fStartDate, selectedNewUnit]);

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
  const openNew = async () => {
    setPreviewSelection(null);
    if (workspace.enabled) {
      try {
        await workspace.ensure("context");
      } catch {
        return;
      }
    }
    resetNewForm();
    setPanel("new");
    setSelectedId(null);
  };
  const openDetail = async (id: string, section: "overview" | "finance" = "overview") => {
    setPreviewSelection(null);
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
  const openFinanceEntry = () => {
    setFinanceType("rent_income");
    setFinanceCurrency(selected?.rent_currency ?? "XOF");
    setFinanceDate(new Date().toISOString().slice(0, 10));
    setFinanceAmountWan(0);
    setFinancePaidThrough("");
    setFinanceMethod("other");
    setFinanceNotes("");
    financeRequestIdRef.current = null;
    setError("");
    setPanel("financeEntry");
  };
  const openMoveOut = async (id: string) => {
    if (workspace.enabled) {
      try {
        await workspace.ensure("detail", id);
      } catch {
        return;
      }
    }
    setSelectedId(id);
    setPanel("moveout");
    setError("");
    setMoUnpaid(0);
    setMoDeduction(0);
    setMoRefund(0);
    setMoUtility(false);
    setMoCollectedConfirmed(false);
    setMoMethod("");
    setMoEndDate(new Date().toISOString().slice(0, 10));
  };

  useEffect(() => {
    if (panel !== "detail" || detailSection !== "finance") return;
    const frame = window.requestAnimationFrame(() =>
      financeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [detailSection, panel, selectedId]);

  const runLifecycle = async (
    operation: string,
    target: string,
    payload: unknown,
    submit: (
      requestId: string,
    ) => Promise<{ success: boolean; error?: string; rejected?: boolean }>,
    done: () => void,
  ) => {
    if (lifecycleBusy.current || workspace.unavailable) return;
    lifecycleBusy.current = true;
    setSaving(true);
    setError("");
    try {
      const requestId = await leaseRequestIdentity(operation, target, payload);
      const result = await submit(requestId);
      if (result.success || result.rejected) clearLeaseRequestIdentity(operation, target);
      if (result.success) {
        setWriteConfirmed(true);
        done();
        if (workspace.enabled) await workspace.refresh();
        else router.refresh();
      } else
        setError(
          (result.error ?? "操作失败") +
            (result.rejected ? "" : "；结果可能未知，请保留原内容重试。操作号：" + requestId),
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : "结果未知，请保留原内容重试。");
    } finally {
      lifecycleBusy.current = false;
      setSaving(false);
    }
  };
  const handleCreate = async () => {
    if (!fUnitId || !fCustomerId || !fStartDate || !fEndDate) {
      setError(locale === "zh" ? "请填写必填字段" : "Champs obligatoires");
      return;
    }
    const payload = {
      unitId: fUnitId,
      customerId: fCustomerId,
      contractNo: generatedLeaseContractNo,
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
    };
    await runLifecycle(
      "create",
      fUnitId,
      payload,
      (requestId) => createLeaseContract({ ...payload, requestId }),
      () => {
        resetNewForm();
        setPanel(null);
      },
    );
  };
  const handleActivate = async (id: string) => {
    const contract = contracts.find((c) => c.id === id);
    if (!contract) return;
    const payload = { contractId: id, expectedUpdatedAt: contract.updated_at };
    await runLifecycle(
      "activate",
      id,
      payload,
      (requestId) => activateContract(id, requestId, contract.updated_at),
      () => {},
    );
  };
  const handleTerminate = async (id: string) => {
    const contract = contracts.find((c) => c.id === id);
    if (!contract) return;
    const payload = { contractId: id, expectedUpdatedAt: contract.updated_at };
    await runLifecycle(
      "terminate",
      id,
      payload,
      (requestId) => terminateContract(id, requestId, contract.updated_at),
      () => {},
    );
  };
  const handleMoveOut = async () => {
    if (!selected) return;
    const payload = {
      contractId: selected.id,
      expectedUpdatedAt: selected.updated_at,
      actualEndDate: moEndDate,
      unpaidRentXof: moUnpaid,
      utilityCleared: moUtility,
      depositDeductionXof: moDeduction,
      depositRefundXof: moRefund,
      rentCollectedConfirmed: moCollectedConfirmed,
      paymentMethod: moMethod || undefined,
    };
    await runLifecycle(
      "move_out",
      selected.id,
      payload,
      (requestId) => processMoveOut({ ...payload, requestId }),
      () => setPanel(null),
    );
  };
  const handleFinanceEntry = async () => {
    if (workspace.unavailable) return;
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
      exchangeRateToXof:
        selected && nativeLease(selected) && financeType === "rent_income"
          ? null
          : financeCurrency === "XOF"
            ? 1
            : financeExchangeRate,
      paidThroughDate: financePaidThrough || undefined,
      paymentMethod: financeMethod,
      externalReceiptNo: financeExternalReceiptNo || undefined,
      notes: financeNotes || undefined,
      requestId,
    });
    setSaving(false);
    if (result.success) {
      setWriteConfirmed(true);
      financeRequestIdRef.current = null;
      setFinanceAmountWan(0);
      setFinanceCurrency("XOF");
      setFinanceExchangeRate(1);
      setFinanceExternalReceiptNo("");
      setPanel("detail");
      if (workspace.enabled) await workspace.refresh();
      else router.refresh();
    } else {
      setError(result.error ?? (locale === "zh" ? "操作失败。" : "Échec de l'opération."));
    }
  };

  const inputClass =
    "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-border-strong outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";

  const paymentKindLabel = (sourceType: string) => {
    const configured = getLeaseFinancialConfigBySourceType(sourceType);
    if (configured) return locale === "zh" ? configured.labelZh : configured.labelFr;
    if (sourceType === "lease_deposit_deduction")
      return locale === "zh" ? "押金扣款" : "Retenue sur dépôt";
    if (sourceType === "lease_rent_refund")
      return locale === "zh" ? "租金退款" : "Remboursement de loyer";
    if (sourceType === "lease_contract") return locale === "zh" ? "租金收入" : "Revenu de loyer";
    return locale === "zh" ? "财务记录" : "Écriture financière";
  };

  const openInsight = async (key: LeaseStatFilter) => {
    setPreviewSelection(null);
    if (workspace.enabled) {
      try {
        await workspace.ensure("scope", undefined, true);
      } catch {
        return;
      }
    }
    setStatFilter(key);
    if (key === "dueSoon") setAttentionTab("upcoming");
    if (key === "overdue") setAttentionTab("overdue");
    setPanel("insight");
    setSelectedId(null);
  };
  const changeView = async (value: "table" | "rooms") => {
    setLinkedPreviewDismissed(true);
    setPreviewSelection(null);
    if (workspace.enabled && value === "rooms") {
      try {
        await workspace.ensure("scope");
      } catch {
        return;
      }
    }
    setContractView(value);
  };
  const printById = (id: string) =>
    printer.print(
      async () => {
        if (workspace.enabled) {
          const data = await workspace.ensure("detail", id);
          return {
            contracts: data.contracts as LeaseContractRow[],
            units: data.units,
            customers: data.customers,
            receivables: data.receivables,
          };
        }
        return { contracts, units, customers, receivables };
      },
      (source, target) => {
        const contract = source.contracts.find((row) => row.id === id);
        if (!contract) throw new Error("ContractPrintUnavailable");
        printLeaseContract(
          {
            contract,
            unit: source.units.find((row) => row.id === contract.unit_id) ?? null,
            customer: source.customers.find((row) => row.id === contract.customer_id) ?? null,
            receivables: source.receivables.filter(
              (row) =>
                row.source_type === "lease_contract" &&
                row.source_id === id &&
                row.status !== "cancelled",
            ),
          },
          locale,
          target,
        );
      },
    );
  const statBlocks: Array<{
    key: LeaseStatFilter;
    label: string;
    value: string;
    dot: string;
    hint: string;
  }> = [
    {
      key: "active",
      label: locale === "zh" ? "生效合同" : "Actifs",
      value: String(dashboardStats.active),
      dot: "bg-accentGreen-500",
      hint: locale === "zh" ? "点击查看生效合同" : "Voir les contrats actifs",
    },
    {
      key: "rent",
      label: locale === "zh" ? "月租规模" : "Loyer/mois",
      value: formatXof(dashboardStats.rent),
      dot: "bg-accentBlue-500",
      hint: locale === "zh" ? "点击查看产生月租的合同" : "Voir les loyers actifs",
    },
    {
      key: "dueSoon",
      label: locale === "zh" ? "15天内跟进" : "Suivi sous 15j",
      value: String(dashboardStats.dueSoon),
      dot: dashboardStats.dueSoon > 0 ? "bg-accentAmber-500" : "bg-muted-foreground/40",
      hint:
        locale === "zh" ? "含合同缴费提醒，非确认应收" : "Rappels contrat, pas créances confirmées",
    },
    {
      key: "currentDue",
      label: locale === "zh" ? "已建应收未收" : "Créances restantes",
      value: dashboardStats.unknownAll ? "—" : formatXof(dashboardStats.currentDue),
      dot: "bg-accentPurple-500",
      hint: dashboardStats.unknownContracts
        ? `${dashboardStats.unknownContracts} ${locale === "zh" ? "份合同未建已核应收" : "contrats sans créance vérifiée"}`
        : locale === "zh"
          ? "不含合同估算、历史待核"
          : "Hors estimations et historique à vérifier",
    },
    {
      key: "overdue",
      label: locale === "zh" ? "逾期" : "En retard",
      value: dashboardStats.unknownAll ? "—" : formatXof(dashboardStats.overdue),
      dot: dashboardStats.overdue > 0 ? "bg-accentRed-500" : "bg-muted-foreground/40",
      hint: `${dashboardStats.overdueContracts}${locale === "zh" ? "份 · 已核应收" : " · créances vérifiées"}`,
    },
  ];

  const listToolbar = (
    <div className={styles.toolbar}>
      <div className={styles.listHeading}>
        <h2>
          {contractView === "table"
            ? locale === "zh"
              ? "合同列表"
              : "Liste des contrats"
            : locale === "zh"
              ? "楼层房源"
              : "Lots par étage"}
        </h2>
        <span className={styles.listCount}>
          {workspace.unavailable
            ? "—"
            : workspace.enabled
              ? `${workspace.pageData?.total ?? 0} / ${workspace.pageData?.scopeCount ?? 0}`
              : `${filtered.length} / ${filteredByBuilding.length}`}{" "}
          {locale === "zh" ? "份合同" : "contrats"}
        </span>
      </div>
      <ContractListControls
        locale={locale}
        query={search}
        onQueryChange={(value) => {
          setLinkedPreviewDismissed(true);
          setPreviewSelection(null);
          setSearch(value);
        }}
        view={contractView}
        onViewChange={changeView}
      />
      <div className={styles.statusRow}>
        <SegmentedControl
          value={statusFilter}
          onChange={(value) => {
            setLinkedPreviewDismissed(true);
            setPreviewSelection(null);
            setStatusFilter(value);
          }}
          ariaLabel={locale === "zh" ? "合同状态筛选" : "Filtre statut contrat"}
          items={["current", "all", "draft", "active", "terminated", "expired"].map((value) => ({
            value,
            label:
              value === "current"
                ? locale === "fr"
                  ? "En cours"
                  : "当前"
                : value === "all"
                  ? locale === "fr"
                    ? "Tous"
                    : "全部"
                  : t.contractStatus[value as keyof typeof t.contractStatus],
          }))}
        />
        <span className={styles.scopeCaption}>
          {locale === "zh" ? "金额统一以 XOF 展示" : "Montants en XOF"}
        </span>
      </div>
    </div>
  );

  return (
    <OperationalPage
      className={styles.workbench}
      eyebrow="LEASE WORKSPACE"
      title={locale === "zh" ? "长租工作台" : "Espace location"}
      description={
        locale === "zh"
          ? "合同、应收与收款，在同一个工作区核对。"
          : "Contrats, créances et encaissements réunis pour vérification."
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
      {safeReturnTo && (
        <Link
          href={safeReturnTo}
          className="mb-3 inline-flex text-sm text-blue-700 hover:underline"
        >
          {locale === "zh" ? "← 返回来源工作台" : "← Revenir à l'espace précédent"}
        </Link>
      )}
      <section
        className={styles.scopeRow}
        aria-label={locale === "zh" ? "项目与楼栋" : "Projet et bâtiment"}
      >
        <div className={styles.scopeFields}>
          <nav
            className={styles.scopeProjects}
            aria-label={locale === "zh" ? "项目切换" : "Choix du projet"}
          >
            {projects.map((p) => (
              <button
                type="button"
                key={p.id}
                aria-pressed={project?.id === p.id}
                onClick={() => changeProject(p.id)}
              >
                {projectLabel(p)}
              </button>
            ))}
          </nav>
          <div className={styles.scopeBuildings}>
            <span className={styles.scopeLabel}>{locale === "zh" ? "楼栋" : "Bâtiment"}</span>
            <select
              aria-label={locale === "zh" ? "选择楼栋" : "Choisir un bâtiment"}
              className={`${controlClass} min-w-0 flex-1 sm:hidden`}
              value={activeBuildingId}
              onChange={(e) => changeBuilding(e.target.value)}
            >
              <option value={ALL_BUILDINGS}>
                {locale === "zh" ? "全部楼栋" : "Tous les bâtiments"}
              </option>
              {projectBuildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.display_name || b.code}
                </option>
              ))}
            </select>
            <SegmentedControl
              value={activeBuildingId}
              onChange={changeBuilding}
              className="hidden min-w-0 sm:inline-flex"
              ariaLabel={locale === "zh" ? "楼栋切换" : "Choix du bâtiment"}
              items={[
                {
                  value: ALL_BUILDINGS,
                  label: locale === "zh" ? "全部楼栋" : "Tous les bâtiments",
                },
                ...projectBuildings.map((b) => ({ value: b.id, label: b.display_name || b.code })),
              ]}
            />
          </div>
        </div>
        <p className={styles.scopeCaption}>{scopeLabel}</p>
      </section>

      {/* ── Summary stats ── */}
      <section
        className={styles.summaryStrip}
        aria-label={locale === "zh" ? "项目与楼栋经营摘要" : "Synthèse du périmètre"}
      >
        {statBlocks.map((b) => (
          <button
            type="button"
            key={b.key}
            className={styles.summaryItem}
            disabled={workspace.unavailable}
            aria-pressed={panel === "insight" && statFilter === b.key}
            onClick={() => {
              void openInsight(b.key);
            }}
          >
            <span className={styles.summaryLabel}>{b.label}</span>
            <span className={styles.summaryValue}>
              {workspace.unavailable ? "—" : b.value.replace(/\sXOF$/, "")}
              {b.value.endsWith("XOF") && !workspace.unavailable && (
                <span className={styles.summaryUnit}> XOF</span>
              )}
            </span>
            <span className={styles.summaryHint}>
              {workspace.unavailable
                ? locale === "zh"
                  ? "读取中或暂不可核验"
                  : "Lecture en cours ou indisponible"
                : panel === "insight" && statFilter === b.key
                  ? locale === "zh"
                    ? "明细已打开"
                    : "Détail ouvert"
                  : b.hint}
            </span>
          </button>
        ))}
      </section>

      {printer.error && (
        <p role="alert" className="text-sm text-destructive">
          {printer.error}
        </p>
      )}
      <div className={cn(styles.workspaceGrid, contractView === "rooms" && styles.roomsWorkspace)}>
        <section
          className="min-w-0"
          aria-label={locale === "zh" ? "合同查询区" : "Recherche de contrats"}
        >
          {(contractView === "rooms" || workspace.unavailable) && (
            <div className={styles.roomsToolbar}>{listToolbar}</div>
          )}
          {workspace.enabled && (
            <p className="sr-only">
              {locale === "zh"
                ? "汇总范围：当前项目与楼栋全部合同，不随搜索、状态或分页截断。"
                : "Synthèse : tous les contrats du projet et bâtiment, indépendante de la recherche, du statut et des pages."}
            </p>
          )}
          {workspace.unavailable && (
            <div role="status" className={styles.unavailable}>
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
            <LeaseWorkbenchTable
              toolbar={listToolbar}
              pagination={
                workspace.pagination
                  ? {
                      ...workspace.pagination,
                      onPageChange: (page) => {
                        setLinkedPreviewDismissed(true);
                        setPreviewSelection(null);
                        workspace.pagination?.onPageChange(page);
                      },
                      onSortChange: (key, direction) => {
                        setPreviewSelection(null);
                        workspace.pagination?.onSortChange(key, direction);
                      },
                    }
                  : undefined
              }
              rows={searchedTableRows}
              selectedId={previewId}
              onSelect={selectPreview}
              onVisibleIdsChange={syncVisiblePreview}
              locale={locale}
              amountLabel={locale === "zh" ? "月租金" : "Loyer mensuel"}
              periodLabel={locale === "zh" ? "合同期限 / 缴费" : "Période / paiement"}
              onOpen={openDetail}
              onFinance={(id) => openDetail(id, "finance")}
              onPrint={printById}
            />
          )}

          {/* ── Contract matrix (BusinessRoomCard) ── */}
          {!workspace.unavailable &&
            contractView === "rooms" &&
            (groupedContracts.length === 0 ? (
              <EmptyState title={t.empty} />
            ) : (
              groupedContracts.map(([floor, floorContracts]) => (
                <RoomBoard
                  key={floor}
                  header={
                    <>
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                        <h3 className="text-sm font-semibold">{floor}</h3>
                      </div>
                      <span className="text-[12px] font-medium text-[#5D7186]">
                        {floorContracts.length} {locale === "fr" ? "contrats" : "份合同"}
                      </span>
                    </>
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                    {floorContracts.map((contract) => {
                      const unit = unitMap.get(contract.unit_id);
                      const customer = customerMap.get(contract.customer_id);
                      const summary = getContractReceivableSummary(contract.id);
                      const relatedReceivables = receivables.filter(
                        (row) =>
                          row.source_type === "lease_contract" &&
                          row.source_id === contract.id &&
                          row.status !== "cancelled" &&
                          row.management_status !== "historical_pending" &&
                          row.management_status !== "excluded",
                      );
                      const accruedRent = workspace.enabled
                        ? (workspace.data?.accruals[contract.id] ?? null)
                        : contract.status === "active"
                          ? resolveLeaseOverdue({
                              receivables: relatedReceivables,
                              today: todayStr,
                              paidThroughDate: contract.paid_through_date ?? null,
                              monthlyRentXof: Number(contract.monthly_rent_xof),
                              contractStatus: contract.status,
                              actualEndDate: contract.actual_end_date ?? null,
                            })
                          : null;
                      const displayedOutstanding = accruedRent?.amount ?? summary.outstanding;
                      const endConfirmed = isContractEndConfirmed(contract);
                      const daysLeft = endConfirmed
                        ? Math.floor(
                            (new Date(contract.expected_end_date).getTime() - Date.now()) /
                              86400000,
                          )
                        : null;
                      const isLongTerm = endConfirmed && contract.expected_end_date >= "2099-01-01";
                      const rent = Number(contract.monthly_rent_xof);
                      const isManaged = unit ? isManagedLeaseUnit(unit) : false;
                      const dataFlags = getLeaseDataFlags(contract, customer);
                      const paidThrough = contract.paid_through_date;
                      const paidPeriodStartsBeforeCutoff =
                        paidThrough && contract.start_date
                          ? contract.start_date <= paidThrough
                          : false;
                      const hasOverdueRent = accruedRent !== null || summary.overdue > 0;
                      const nextRentIsFuture =
                        !hasOverdueRent && !!summary.nextDue && summary.nextDue >= todayStr;
                      return (
                        <RoomCard
                          key={contract.id}
                          roomNo={unit?.unit_no ?? "-"}
                          status={isManaged ? "managed" : "leased"}
                          locale={locale}
                          onClick={() => openDetail(contract.id)}
                        >
                          {/* Customer and tags */}
                          <div className="flex min-h-[62px] flex-col justify-start gap-2">
                            <p
                              className="text-[13px] font-semibold leading-snug line-clamp-2 break-words"
                              title={customer?.name ?? (locale === "zh" ? "无客户" : "Sans client")}
                            >
                              {customer?.name ?? "—"}
                            </p>
                            <div className="flex min-h-5 flex-wrap items-center gap-1.5">
                              {isManaged && (
                                <Badge
                                  variant="success"
                                  className="h-5 bg-white/70 px-2 text-[10px] text-[#217365]"
                                >
                                  {locale === "zh" ? "代管" : "Gestion"}
                                </Badge>
                              )}
                              {dataFlags.needsData && (
                                <Badge variant="warning" className="h-5 px-2 text-[10px]">
                                  {locale === "zh" ? "资料待补" : "A compléter"}
                                </Badge>
                              )}
                              <Badge
                                variant={statusVariant[contract.status]}
                                className="h-5 px-2 text-[10px]"
                              >
                                {t.contractStatus[contract.status as keyof typeof t.contractStatus]}
                              </Badge>
                            </div>
                          </div>
                          {/* Rent + expiry */}
                          <div className="min-h-[50px] text-[11px] leading-relaxed text-[#5D7186]">
                            <p className="tabular-nums">
                              {rent > 0
                                ? formatXof(rent)
                                : locale === "zh"
                                  ? "租金未录入"
                                  : "Loyer non saisi"}
                            </p>
                            {paidThrough ? (
                              <p
                                className={cn(
                                  "tabular-nums font-medium",
                                  isPaidThroughOverdue(contract)
                                    ? "text-red-600"
                                    : "text-emerald-700",
                                )}
                              >
                                {paidPeriodStartsBeforeCutoff ? (
                                  <>
                                    {locale === "zh" ? "缴费期" : "Période payée"}{" "}
                                    {contract.start_date} → {paidThrough}
                                  </>
                                ) : (
                                  <>
                                    {locale === "zh" ? "已缴至" : "Payé au"} {paidThrough}
                                  </>
                                )}
                              </p>
                            ) : (
                              <p className="tabular-nums">
                                {contract.start_date ??
                                  (locale === "zh" ? "待确认" : "À confirmer")}{" "}
                                →{" "}
                                {!endConfirmed
                                  ? locale === "zh"
                                    ? "缴租截至日待补"
                                    : "Paiement à compléter"
                                  : isLongTerm
                                    ? locale === "zh"
                                      ? "长期有效"
                                      : "Long terme"
                                    : contract.expected_end_date}
                                {endConfirmed &&
                                  !isLongTerm &&
                                  daysLeft !== null &&
                                  daysLeft >= 0 &&
                                  daysLeft <= 30 && (
                                    <span className="ml-1 text-amber-600 font-medium">
                                      ({daysLeft}j)
                                    </span>
                                  )}
                              </p>
                            )}
                          </div>
                          {/* Outstanding alert */}
                          {displayedOutstanding > 0 && (
                            <p
                              className={cn(
                                "text-[11px] font-medium leading-tight",
                                hasOverdueRent ? "text-red-600" : "text-[#5D7186]",
                              )}
                            >
                              {hasOverdueRent
                                ? accruedRent?.source === "contract"
                                  ? locale === "zh"
                                    ? "合同估算待核"
                                    : "Estimation à vérifier"
                                  : locale === "zh"
                                    ? "逾期未收"
                                    : "Impayé"
                                : nextRentIsFuture
                                  ? locale === "zh"
                                    ? "下期应收"
                                    : "Prochaine échéance"
                                  : locale === "zh"
                                    ? "待收"
                                    : "Dû"}
                              : {formatXof(displayedOutstanding)}
                              {nextRentIsFuture ? ` · ${summary.nextDue}` : ""}
                            </p>
                          )}
                          {/* Action buttons */}
                          <div className="mt-auto flex justify-center gap-5 border-t border-[rgba(23,50,77,0.06)] pt-3">
                            <ActionBtn
                              icon={Eye}
                              label={locale === "zh" ? "查看详情" : "Voir les détails"}
                              onClick={() => openDetail(contract.id)}
                            />
                            <ActionBtn
                              icon={DollarSign}
                              label={locale === "zh" ? "查看财务" : "Voir les finances"}
                              onClick={() => openDetail(contract.id, "finance")}
                            />
                            <ActionBtn
                              icon={FileText}
                              label={locale === "zh" ? "合同/打印" : "Contrat / imprimer"}
                              onClick={() => printById(contract.id)}
                            />
                          </div>
                        </RoomCard>
                      );
                    })}
                  </div>
                </RoomBoard>
              ))
            ))}

          <p className={styles.summaryExplanation}>
            {locale === "zh"
              ? "上方摘要覆盖当前项目与楼栋的全部合同，不随搜索、状态或分页截断。月租规模不是实收；15 天内跟进含缴费提醒，不等于合同到期。"
              : "La synthèse couvre tous les contrats du périmètre, sans limitation de recherche, statut ou page. Le loyer mensuel n'est pas un encaissement ; les rappels de paiement ne sont pas des fins de bail."}
          </p>
        </section>
        {contractView === "table" && (
          <div className={styles.inspectorColumn} ref={previewColumnRef} tabIndex={-1}>
            <LeaseWorkbenchInspector
              contract={previewContract}
              unit={previewUnit}
              customer={previewCustomer}
              buildingLabel={buildingMap.get(previewUnit?.building_id ?? "")?.display_name}
              summary={
                previewId
                  ? workspace.enabled
                    ? preview.data?.summaries[previewId]
                    : contractSummaryMap.get(previewId)
                  : null
              }
              payments={previewPayments}
              receivables={previewReceivables}
              locale={locale}
              today={workspace.pageData?.today ?? todayStr}
              loading={Boolean(previewId && preview.loading)}
              error={Boolean(previewId && preview.error)}
              onOpen={(section) => {
                if (previewId) void openDetail(previewId, section ?? "overview");
              }}
              onPrint={() => {
                if (previewId) void printById(previewId);
              }}
              onClose={() => {
                setLinkedPreviewDismissed(true);
                setPreviewSelection(null);
              }}
            />
            {previewId && preview.error && (
              <Button
                className={styles.previewRetry}
                variant="outline"
                size="sm"
                onClick={preview.retry}
              >
                {locale === "zh" ? "重试预览" : "Réessayer l'aperçu"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── KPI insight panel ── */}
      {!workspace.unavailable &&
        panel === "insight" &&
        statFilter &&
        (() => {
          const titleMap: Record<LeaseStatFilter, string> = {
            active: locale === "zh" ? "生效合同明细" : "Contrats actifs",
            rent: locale === "zh" ? "月租规模明细" : "Détail des loyers",
            dueSoon: locale === "zh" ? "15天内应缴" : "Échéances sous 15 jours",
            currentDue: locale === "zh" ? "已建应收未收" : "Créances restantes",
            overdue: locale === "zh" ? "逾期明细" : "Détail des retards",
          };
          const activeRows = leaseInsightContracts.filter(
            (row) => row.contract.status === "active",
          );
          const rentRows = [...activeRows].sort(
            (a, b) => Number(b.contract.monthly_rent_xof) - Number(a.contract.monthly_rent_xof),
          );
          const noticeRows =
            statFilter === "dueSoon" ? leaseAttention.upcoming : managedOverdueRows;

          if (statFilter === "dueSoon" || statFilter === "overdue") {
            return (
              <PanelShell
                onClose={() => setPanel(null)}
                title={titleMap[statFilter]}
                badge={
                  <Badge variant={statFilter === "overdue" ? "destructive" : "warning"}>
                    {noticeRows.length}
                  </Badge>
                }
              >
                <div className="space-y-4">
                  <div
                    className={cn(
                      "rounded-xl border p-3",
                      statFilter === "overdue"
                        ? "border-red-200 bg-red-50/50"
                        : "border-amber-200 bg-amber-50/50",
                    )}
                  >
                    <p className="text-xs text-muted-foreground">
                      {locale === "zh" ? "合计金额" : "Total"}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-xl font-semibold tabular-nums",
                        statFilter === "overdue" ? "text-red-700" : "text-amber-700",
                      )}
                    >
                      {formatXof(noticeRows.reduce((sum, row) => sum + row.amount, 0))}
                    </p>
                  </div>
                  {noticeRows.length === 0 ? (
                    <EmptyState
                      title={locale === "zh" ? "当前没有需要跟进的合同" : "Aucun contrat à suivre"}
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {noticeRows.map((row) => (
                        <div
                          key={row.contract.id}
                          className={cn(
                            "rounded-xl border p-3.5",
                            row.kind === "overdue"
                              ? "border-red-200 bg-red-50/40"
                              : "border-amber-200 bg-amber-50/40",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold">
                                  {row.buildingName} · {row.unit.unit_no}
                                </span>
                                <Badge
                                  variant={row.kind === "overdue" ? "destructive" : "warning"}
                                  className="h-5 px-2 text-[10px]"
                                >
                                  {row.kind === "overdue"
                                    ? row.amountIsEstimated
                                      ? locale === "zh"
                                        ? "合同累计"
                                        : "Calcul contrat"
                                      : `${locale === "zh" ? "逾期" : "Retard"} ${Math.abs(row.days)}${locale === "zh" ? "天" : "j"}`
                                    : `${row.days}${locale === "zh" ? "天后应缴" : "j"}`}
                                </Badge>
                              </div>
                              <p className="mt-1 truncate text-[13px] font-medium text-foreground">
                                {row.customer?.name ??
                                  (locale === "zh" ? "客户待补" : "Client à compléter")}
                              </p>
                            </div>
                            <p
                              className={cn(
                                "shrink-0 text-sm font-semibold tabular-nums",
                                row.kind === "overdue" ? "text-red-700" : "text-amber-700",
                              )}
                            >
                              {formatXof(row.amount)}
                            </p>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {locale === "zh" ? "应缴日" : "Échéance"} {row.dueDate}
                            </span>
                            <span className="text-right">
                              {row.amountIsEstimated
                                ? locale === "zh"
                                  ? "按已缴至日期逐月累计"
                                  : "Cumul selon la date payée"
                                : locale === "zh"
                                  ? "未结应收"
                                  : "Créance ouverte"}
                            </span>
                            <span>
                              {locale === "zh" ? "已缴至" : "Payé au"}{" "}
                              {row.paidThrough ?? (locale === "zh" ? "待补" : "À compléter")}
                            </span>
                            <span className="flex items-center justify-end gap-1.5">
                              <Phone className="h-3.5 w-3.5" />
                              {row.customer?.phone ||
                                (locale === "zh" ? "电话待补" : "Téléphone à compléter")}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 w-full"
                            onClick={() => openDetail(row.contract.id)}
                          >
                            {locale === "zh" ? "查看合同并收款" : "Voir et encaisser"}
                            <ChevronRight className="h-3.5 w-3.5" />
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
              <PanelShell
                onClose={() => setPanel(null)}
                title={titleMap[statFilter]}
                badge={<Badge variant="secondary">{currentDueRows.length}</Badge>}
              >
                <div className="space-y-4">
                  <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      {locale === "zh"
                        ? "已建、已核应收未收合计（含未来期）"
                        : "Créances vérifiées restantes, échéances futures incluses"}
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-purple-700">
                      {formatXof(currentDueRows.reduce((sum, row) => sum + row.amount, 0))}
                    </p>
                  </div>
                  {currentDueRows.length === 0 ? (
                    <EmptyState
                      title={locale === "zh" ? "当前没有累计未收款" : "Aucun montant cumulé dû"}
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {currentDueRows.map((row) => (
                        <div
                          key={row.contract.id}
                          className="rounded-xl border border-border bg-card p-3.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">
                                {row.buildingName} · {row.unit?.unit_no} ·{" "}
                                {row.customer?.name ??
                                  (locale === "zh" ? "客户待补" : "Client à compléter")}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {locale === "zh"
                                  ? "首笔未结应收到期日"
                                  : "Première créance ouverte"}{" "}
                                {row.dueDate}
                              </p>
                            </div>
                            <p className="shrink-0 text-sm font-semibold tabular-nums text-purple-700">
                              {formatXof(row.amount)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 w-full"
                            onClick={() => openDetail(row.contract.id)}
                          >
                            {locale === "zh" ? "查看合同并收款" : "Voir et encaisser"}
                            <ChevronRight className="h-3.5 w-3.5" />
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
            <PanelShell
              onClose={() => setPanel(null)}
              title={titleMap[statFilter]}
              badge={<Badge variant="success">{contractRows.length}</Badge>}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {locale === "zh" ? "合同数" : "Contrats"}
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{contractRows.length}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {locale === "zh" ? "折合月租合计" : "Loyer total converti"}
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">
                      {formatXof(
                        contractRows.reduce(
                          (sum, row) => sum + Number(row.contract.monthly_rent_xof),
                          0,
                        ),
                      )}
                    </p>
                  </div>
                </div>
                {contractRows.length === 0 ? (
                  <EmptyState title={locale === "zh" ? "当前没有合同" : "Aucun contrat"} />
                ) : (
                  <div className="space-y-2.5">
                    {contractRows.map((row) => (
                      <div
                        key={row.contract.id}
                        className="rounded-xl border border-border bg-card p-3.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">
                              {row.unit?.unit_no ?? "-"} ·{" "}
                              {row.customer?.name ??
                                (locale === "zh" ? "客户待补" : "Client à compléter")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {locale === "zh" ? "已缴至" : "Payé au"}{" "}
                              {row.contract.paid_through_date ??
                                (locale === "zh" ? "待补" : "À compléter")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <p className="text-sm font-semibold">
                              {formatXof(Number(row.contract.monthly_rent_xof))}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <span>
                            {locale === "zh" ? "起租" : "Début"}{" "}
                            {row.contract.start_date ??
                              (locale === "zh" ? "待确认" : "À confirmer")}
                          </span>
                          <span className="text-right">
                            {locale === "zh" ? "应收" : "Dû"} {formatXof(row.summary.outstanding)}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 w-full"
                          onClick={() => openDetail(row.contract.id)}
                        >
                          {locale === "zh" ? "查看合同" : "Voir le contrat"}
                          <ChevronRight className="h-3.5 w-3.5" />
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
      {!workspace.unavailable && panel === "attention" && (
        <PanelShell
          onClose={() => setPanel(null)}
          title={locale === "zh" ? "长租收费提醒" : "Rappels de loyer"}
          badge={
            <Badge variant={attentionTab === "overdue" ? "destructive" : "warning"}>
              {attentionTab === "overdue"
                ? leaseAttention.overdue.length
                : leaseAttention.upcoming.length}
            </Badge>
          }
        >
          <div className="space-y-4">
            <SegmentedControl
              value={attentionTab}
              onChange={(value) => setAttentionTab(value as AttentionTab)}
              ariaLabel={locale === "zh" ? "收费提醒类型" : "Type de rappel"}
              items={[
                {
                  value: "overdue",
                  label: `${locale === "zh" ? "已逾期" : "En retard"} ${leaseAttention.overdue.length}`,
                },
                {
                  value: "upcoming",
                  label: `${locale === "zh" ? "15天内应缴" : "Sous 15 jours"} ${leaseAttention.upcoming.length}`,
                },
              ]}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {locale === "zh"
                ? "合同估算仅用于提醒核对，不作为确认欠款或现金收入；确认余额只取已建立、已核实的应收记录。"
                : "Les estimations servent au suivi, jamais à confirmer une dette ou un flux de caisse. Les soldes proviennent des créances vérifiées."}
            </p>
            {(attentionTab === "overdue" ? leaseAttention.overdue : leaseAttention.upcoming)
              .length === 0 ? (
              <EmptyState
                title={locale === "zh" ? "当前没有需要跟进的合同" : "Aucun contrat à suivre"}
              />
            ) : (
              <div className="space-y-2.5">
                {(attentionTab === "overdue"
                  ? leaseAttention.overdue
                  : leaseAttention.upcoming
                ).map((row) => (
                  <div
                    key={row.contract.id}
                    className={cn(
                      "rounded-xl border p-3.5",
                      row.kind === "overdue"
                        ? "border-red-200 bg-red-50/40"
                        : "border-amber-200 bg-amber-50/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {row.buildingName} · {row.unit.unit_no}
                          </span>
                          <Badge
                            variant={row.kind === "overdue" ? "destructive" : "warning"}
                            className="h-5 px-2 text-[10px]"
                          >
                            {row.kind === "overdue"
                              ? `${locale === "zh" ? "逾期" : "Retard"} ${Math.abs(row.days)}${locale === "zh" ? "天" : "j"}`
                              : `${row.days}${locale === "zh" ? "天后应缴" : "j"}`}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-[13px] font-medium text-foreground">
                          {row.customer?.name ??
                            (locale === "zh" ? "客户待补" : "Client à compléter")}
                        </p>
                      </div>
                      <p
                        className={cn(
                          "shrink-0 text-sm font-semibold tabular-nums",
                          row.kind === "overdue" ? "text-red-700" : "text-amber-700",
                        )}
                      >
                        {formatXof(row.amount)}
                      </p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {locale === "zh" ? "应缴日" : "Échéance"} {row.dueDate}
                      </span>
                      <span className="text-right">
                        {row.amountIsEstimated
                          ? locale === "zh"
                            ? "按已缴至日期逐月累计"
                            : "Cumul selon la date payée"
                          : locale === "zh"
                            ? "未结应收"
                            : "Créance ouverte"}
                      </span>
                      <span>
                        {locale === "zh" ? "已缴至" : "Payé au"}{" "}
                        {row.paidThrough ?? (locale === "zh" ? "待补" : "À compléter")}
                      </span>
                      <span className="flex items-center justify-end gap-1.5">
                        <Phone className="h-3.5 w-3.5" />
                        {row.customer?.phone ||
                          (locale === "zh" ? "电话待补" : "Téléphone à compléter")}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => openDetail(row.contract.id)}
                    >
                      {locale === "zh" ? "查看合同并收款" : "Voir et encaisser"}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PanelShell>
      )}

      {/* ── New Contract Panel ── */}
      {!workspace.unavailable && panel === "new" && (
        <PanelShell onClose={() => setPanel(null)} title={t.form.newContract}>
          {/* form fields same as before, using shadcn tokens */}
          {/* kept compact */}
          <div className="space-y-4">
            <div>
              <label className={labelClass}>
                {locale === "zh" ? "合同编号（自动生成）" : "N° de contrat (automatique)"}
              </label>
              <input
                type="text"
                value={generatedLeaseContractNo}
                readOnly
                placeholder={
                  locale === "zh" ? "选择房源和起租日期后生成" : "Choisissez le logement et la date"
                }
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
                {availableUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {buildingMap.get(u.building_id)?.display_name} · {u.unit_no} ({u.floor_label})
                    {isManagedLeaseUnit(u) ? (locale === "zh" ? " · 已售代管" : " · Gestion") : ""}
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
                      {cc.name} {cc.phone ? `(${cc.phone})` : ""}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t.form.startDate}</label>
                <DateInput
                  value={fStartDate}
                  onChangeValue={setFStartDate}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t.form.expectedEndDate}</label>
                <DateInput value={fEndDate} onChangeValue={setFEndDate} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>{t.form.paymentCycle}</label>
                <select
                  value={fCycle}
                  onChange={(e) => setFCycle(e.target.value)}
                  className={inputClass}
                >
                  {paymentCycles.map((pc) => (
                    <option key={pc} value={pc}>
                      {t.paymentCycle[pc as keyof typeof t.paymentCycle]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.form.paymentDay}</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={fPayDay}
                  onChange={(e) => setFPayDay(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t.form.monthlyRent}</label>
                <input
                  type="number"
                  value={fRent}
                  onChange={(e) => setFRent(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t.form.deposit}</label>
                <input
                  type="number"
                  value={fDeposit}
                  onChange={(e) => setFDeposit(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t.form.rentFreeDays}</label>
                <input
                  type="number"
                  value={fFreeDays}
                  onChange={(e) => setFFreeDays(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fDepositReceived}
                disabled={!canRecordFinance}
                onChange={(e) => setFDepositReceived(e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              {t.form.depositReceived}
              {!canRecordFinance &&
                (locale === "zh" ? "（请由财务账号登记实收）" : " (à enregistrer par la finance)")}
            </label>
            <div>
              <label className={labelClass}>{t.form.signerName}</label>
              <input
                type="text"
                value={fSigner}
                onChange={(e) => setFSigner(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t.form.statusLabel}</label>
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value as ContractStatus)}
                className={inputClass}
              >
                <option value="draft">{t.contractStatus.draft}</option>
                <option value="active">{t.contractStatus.active}</option>
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full" onClick={handleCreate} disabled={saving}>
              {saving ? "..." : t.form.newContract}
            </Button>
          </div>
        </PanelShell>
      )}

      {/* ── Detail Panel ── */}
      {panel === "detail" && selected && (
        <PanelShell
          onClose={() => setPanel(null)}
          title={selected.contract_no}
          badge={
            <Badge variant={statusVariant[selected.status]}>
              {t.contractStatus[selected.status as keyof typeof t.contractStatus]}
            </Badge>
          }
          actions={
            <button
              onClick={() =>
                printLeaseContract(
                  {
                    contract: selected,
                    unit: selectedUnit ?? null,
                    customer: selectedCustomer ?? null,
                    receivables: contractReceivables,
                  },
                  locale,
                )
              }
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title={dictionaries[locale].settings.print.print}
            >
              <Printer className="h-4 w-4" />
            </button>
          }
        >
          <div className="space-y-4">
            <NativeLeaseFinance
              contract={selected}
              payments={contractPayments}
              receivables={contractReceivables}
              locale={locale}
              today={todayStr}
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "zh" ? "楼栋 / 房号" : "Bâtiment / Lot"}
                </dt>
                <dd className="font-medium">
                  {selectedUnit
                    ? buildingMap.get(selectedUnit.building_id)?.display_name ||
                      buildingMap.get(selectedUnit.building_id)?.code ||
                      "-"
                    : "-"}{" "}
                  · {selectedUnit?.unit_no ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.customer}</dt>
                <dd className="font-medium">{selectedCustomer?.name ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.startDate}</dt>
                <dd>{selected.start_date ?? (locale === "zh" ? "待确认" : "À confirmer")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "zh" ? "正式合同到期日" : t.form.expectedEndDate}
                </dt>
                <dd>
                  {isContractEndConfirmed(selected)
                    ? selected.expected_end_date
                    : locale === "zh"
                      ? "未确认"
                      : "Non confirmée"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {locale === "zh" ? "缴租截至日" : "Loyer payé au"}
                </dt>
                <dd
                  className={cn(
                    selected.paid_through_date && isPaidThroughOverdue(selected)
                      ? "font-medium text-red-600"
                      : "font-medium text-emerald-700",
                  )}
                >
                  {selected.paid_through_date ?? (locale === "zh" ? "待补" : "À compléter")}
                </dd>
              </div>
              {selected.actual_end_date && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t.form.actualEndDate}</dt>
                  <dd>{selected.actual_end_date}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.paymentCycle}</dt>
                <dd>
                  {t.paymentCycle[selected.payment_cycle as keyof typeof t.paymentCycle]} /{" "}
                  {selected.payment_day}
                  {locale === "zh" ? "号" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.monthlyRent}</dt>
                <dd className="font-semibold">{leaseRentLabel(selected, locale)}</dd>
                {selectedOriginalMonthlyRent && (
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    {locale === "zh" ? "原币约 " : "Devise d'origine env. "}
                    {formatMoney(
                      selectedOriginalMonthlyRent.amount,
                      selectedOriginalMonthlyRent.currency,
                      locale,
                    )}
                    /{locale === "zh" ? "月" : "mois"}
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t.form.deposit}</dt>
                <dd>
                  {formatXof(Number(selected.deposit_amount_xof))}{" "}
                  {selected.deposit_received ? t.form.depositPaid : t.form.depositUnpaid}
                </dd>
              </div>
              {selected.rent_free_days > 0 && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t.form.rentFreeDays}</dt>
                  <dd>
                    {selected.rent_free_days}
                    {locale === "zh" ? "天" : " jours"}
                  </dd>
                </div>
              )}
              {selected.signer_name && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t.form.signerName}</dt>
                  <dd>{selected.signer_name}</dd>
                </div>
              )}
            </dl>
            {canActivate && selected.status === "draft" && (
              <Button
                className="w-full"
                variant="default"
                onClick={() => handleActivate(selected.id)}
                disabled={saving}
              >
                {saving ? "..." : t.form.activateContract}
              </Button>
            )}
            {canMoveOut && selected.status === "active" && (
              <Button className="w-full" variant="outline" onClick={() => openMoveOut(selected.id)}>
                <LogOut className="mr-1 inline h-4 w-4" />
                {t.settlement.moveOut}
              </Button>
            )}
            {/* Risk indicators */}
            {selected.status === "active" && (
              <div className="border-t pt-4">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  {locale === "zh" ? "风险概览" : "Apercu des risques"}
                </h4>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div
                    className={cn(
                      "rounded-md border px-3 py-2",
                      receivableStats.outstanding > 0
                        ? "border-amber-200 bg-amber-50"
                        : "border-border bg-muted/25",
                    )}
                  >
                    <p className="text-muted-foreground">
                      {locale === "zh" ? "已建应收未收" : "Créances restantes"}
                    </p>
                    <p
                      className={cn(
                        "font-semibold tabular-nums",
                        receivableStats.outstanding > 0 ? "text-amber-700" : "text-foreground",
                      )}
                    >
                      {receivableStats.known
                        ? formatXof(receivableStats.outstanding)
                        : locale === "zh"
                          ? "未建已核应收"
                          : "Aucune créance vérifiée"}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-md border px-3 py-2",
                      receivableStats.overdue > 0
                        ? "border-red-200 bg-red-50"
                        : "border-border bg-muted/25",
                    )}
                  >
                    <p className="text-muted-foreground">{t.risk.overdueTotal}</p>
                    <p
                      className={cn(
                        "font-semibold tabular-nums",
                        receivableStats.overdue > 0 ? "text-red-700" : "text-foreground",
                      )}
                    >
                      {receivableStats.known ? formatXof(receivableStats.overdue) : "—"}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-md border px-3 py-2",
                      !selected.deposit_received
                        ? "border-red-200 bg-red-50"
                        : "border-emerald-200 bg-emerald-50",
                    )}
                  >
                    <p className="text-muted-foreground">{t.risk.depositStatus}</p>
                    <p
                      className={cn(
                        "text-xs font-semibold",
                        selected.deposit_received ? "text-emerald-700" : "text-red-600",
                      )}
                    >
                      {selected.deposit_received ? t.form.depositPaid : t.form.depositUnpaid}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-md border px-3 py-2",
                      contractRisk.expiringSoon
                        ? "border-amber-200 bg-amber-50"
                        : "border-emerald-200 bg-emerald-50",
                    )}
                  >
                    <p className="text-muted-foreground">{t.risk.expiringSoon}</p>
                    <p
                      className={cn(
                        "text-xs font-semibold",
                        contractRisk.expiringSoon ? "text-amber-700" : "text-emerald-700",
                      )}
                    >
                      {contractRisk.expiringSoon
                        ? `${contractRisk.daysLeft} ${locale === "zh" ? "天后到期" : "j restants"}`
                        : locale === "zh"
                          ? "否"
                          : "Non"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Payment history */}
            <div
              ref={financeSectionRef}
              className={cn(
                "scroll-mt-20 border-t pt-4",
                detailSection === "finance" && "-mx-2 rounded-xl px-2 ring-2 ring-primary/20",
              )}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold">
                    {locale === "zh" ? "财务记录" : "Écritures financières"}
                  </h4>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium tabular-nums">
                    <span className="text-emerald-700">
                      {locale === "zh" ? "已录经营收款" : "Encaissements enregistrés"}{" "}
                      {formatXof(totalIncome)}
                    </span>
                    <span className="text-red-600">
                      {locale === "zh" ? "已录经营支出" : "Décaissements enregistrés"}{" "}
                      {formatXof(totalExpense)}
                    </span>
                    <span className="text-slate-700">
                      {locale === "zh" ? "经营现金净额" : "Flux de caisse net"}{" "}
                      {formatXof(netFinancial)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {locale === "zh" ? "押金实收" : "Dépôts encaissés"}{" "}
                    {formatXof(leaseCash.depositIn)} ·{" "}
                    {locale === "zh" ? "押金实退" : "Dépôts remboursés"}{" "}
                    {formatXof(leaseCash.depositOut)} ·{" "}
                    {locale === "zh" ? "不计入经营收款" : "Hors encaissements d'exploitation"}
                  </p>
                  {(leaseCash.excludedCount > 0 || leaseCash.nonCashCount > 0) && (
                    <p className="text-xs text-amber-700">
                      {leaseCash.excludedCount}{" "}
                      {locale === "zh"
                        ? "笔待核对记录未计入现金汇总"
                        : "écritures à vérifier exclues du flux"}{" "}
                      · {leaseCash.nonCashCount}{" "}
                      {locale === "zh" ? "笔非现金变动" : "mouvements hors caisse"}
                    </p>
                  )}
                </div>
                {canCorrectRentPeriod && selected && (
                  <LeaseRentPeriodCorrection
                    key={selected.id}
                    contractId={selected.id}
                    locale={locale}
                    onSaved={() => {
                      if (workspace.enabled) void workspace.refresh();
                      else router.refresh();
                    }}
                  />
                )}
                {canRecordFinance && (
                  <Button size="sm" variant="outline" onClick={openFinanceEntry}>
                    <Plus className="h-3.5 w-3.5" />
                    {locale === "zh" ? "新增记录" : "Ajouter"}
                  </Button>
                )}
              </div>
              {contractPayments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {locale === "zh" ? "暂无财务记录" : "Aucune écriture financière"}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {contractPayments.map((payment) => {
                    const cashLine = classifyContractCashPayment(payment);
                    const isExpense =
                      cashLine.kind === "expense" || cashLine.kind === "deposit_out";
                    const recordedOriginal = getRecordedOriginalPayment(payment);
                    return (
                      <div
                        key={payment.id}
                        className={cn(
                          "rounded-lg border px-3 py-2.5 text-[13px]",
                          cashLine.kind === "excluded"
                            ? "border-border bg-muted/25"
                            : isExpense
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
                                {paymentKindLabel(payment.source_type)}
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {payment.payment_date}
                              </span>
                            </div>
                            <p
                              className="mt-1 truncate text-[11px] text-muted-foreground"
                              title={payment.receipt_no ?? ""}
                            >
                              {payment.receipt_no || (locale === "zh" ? "无收据号" : "Sans reçu")}
                            </p>
                            {cashLine.kind === "excluded" && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {locale === "zh"
                                  ? payment.native_settlement
                                    ? "原币结算，不折算、不并入XOF汇总"
                                    : "未计入现金汇总，保留原始记录"
                                  : "Hors synthèse de caisse, écriture conservée"}
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <p
                              className={cn(
                                "font-semibold",
                                isExpense ? "text-red-600" : "text-emerald-700",
                              )}
                            >
                              {isExpense ? "- " : ""}
                              {recordedOriginal
                                ? formatMoney(
                                    recordedOriginal.amount,
                                    recordedOriginal.currency,
                                    locale,
                                  )
                                : payment.currency === "XOF"
                                  ? formatXof(Number(payment.amount))
                                  : formatMoney(Number(payment.amount), payment.currency, locale)}
                            </p>
                            {cashLine.amountXof !== null &&
                              (payment.currency !== "XOF" || recordedOriginal) && (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  {locale === "zh" ? "折合" : "Équiv."}{" "}
                                  {formatXof(cashLine.amountXof)}
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
          </div>
        </PanelShell>
      )}

      {canRecordFinance && panel === "financeEntry" && selected && (
        <PanelShell
          onClose={() => setPanel("detail")}
          title={locale === "zh" ? "新增长租财务记录" : "Nouvelle écriture financière"}
          badge={<Badge variant="secondary">{selectedUnit?.unit_no ?? "-"}</Badge>}
        >
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/35 p-3 text-sm">
              <p className="font-semibold">{selected.contract_no}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedUnit?.unit_no ?? "-"} · {selectedCustomer?.name ?? "-"}
              </p>
            </div>
            <div>
              <label className={labelClass}>
                {locale === "zh" ? "业务类型" : "Type d'opération"} *
              </label>
              <select
                value={financeType}
                onChange={(event) => {
                  const type = event.target.value as LeaseFinancialBusinessType;
                  setFinanceType(type);
                  setFinanceCurrency(
                    type === "rent_income" ? (selected.rent_currency ?? "XOF") : "XOF",
                  );
                }}
                className={inputClass}
              >
                {LEASE_FINANCIAL_BUSINESS_TYPES.map((type) => {
                  const config = LEASE_FINANCIAL_BUSINESS_CONFIG[type];
                  return (
                    <option key={type} value={type}>
                      {locale === "zh" ? config.labelZh : config.labelFr}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{locale === "zh" ? "业务日期" : "Date"} *</label>
                <DateInput
                  value={financeDate}
                  onChangeValue={setFinanceDate}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  {financeCurrency === "XOF"
                    ? locale === "zh"
                      ? "金额（万 FCFA）"
                      : "Montant (10k FCFA)"
                    : `${locale === "zh" ? "原币金额" : "Montant d'origine"} (${financeCurrency})`}{" "}
                  *
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={financeAmountWan || ""}
                  onChange={(event) => setFinanceAmountWan(Number(event.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>
                  {locale === "zh" ? "原始币种" : "Devise d'origine"} *
                </label>
                <select
                  value={financeCurrency}
                  disabled={nativeLease(selected) && financeType === "rent_income"}
                  onChange={(event) => {
                    const currency = event.target.value as CurrencyCode;
                    setFinanceCurrency(currency);
                    setFinanceExchangeRate(currency === "XOF" ? 1 : 0);
                  }}
                  className={inputClass}
                >
                  <option value="XOF">XOF / FCFA</option>
                  <option value="CNY">CNY / RMB</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>
                  {selected && nativeLease(selected) && financeType === "rent_income"
                    ? locale === "zh"
                      ? "原币结算，不折算XOF"
                      : "Devise contractuelle, sans conversion XOF"
                    : locale === "zh"
                      ? `历史汇率（1 ${financeCurrency} = XOF）`
                      : `Taux historique (1 ${financeCurrency} = XOF)`}{" "}
                  *
                </label>
                <input
                  type="number"
                  min={financeCurrency === "XOF" ? 1 : 0.000001}
                  step="0.000001"
                  value={nativeLease(selected) && financeType === "rent_income" ? "" : financeCurrency === "XOF" ? 1 : financeExchangeRate || ""}
                  disabled={
                    financeCurrency === "XOF" ||
                    (nativeLease(selected) && financeType === "rent_income")
                  }
                  onChange={(event) => setFinanceExchangeRate(Number(event.target.value))}
                  className={cn(inputClass, financeCurrency === "XOF" && "bg-muted/50")}
                />
              </div>
            </div>
            {!nativeLease(selected) &&
              financeCurrency !== "XOF" &&
              financeAmountWan > 0 &&
              financeExchangeRate > 0 && (
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {locale === "zh" ? "折合入账" : "Équivalent comptable"}：
                  {formatXof(financeAmountWan * financeExchangeRate)}
                </p>
              )}
            {getLeaseFinancialConfig(financeType).requiresPaidThrough && (
              <div>
                <label className={labelClass}>
                  {locale === "zh" ? "租金已缴至" : "Loyer payé au"} *
                </label>
                <DateInput
                  value={financePaidThrough}
                  onChangeValue={setFinancePaidThrough}
                  className={inputClass}
                />
              </div>
            )}
            <div>
              <label className={labelClass}>
                {locale === "zh" ? "收付方式" : "Mode de paiement"}
              </label>
              <select
                value={financeMethod}
                onChange={(event) => setFinanceMethod(event.target.value as typeof financeMethod)}
                className={inputClass}
              >
                <option value="other">
                  {locale === "zh" ? "其他/待补" : "Autre / à compléter"}
                </option>
                <option value="check">{locale === "zh" ? "支票" : "Chèque"}</option>
                <option value="cash">{locale === "zh" ? "现金" : "Espèces"}</option>
                <option value="bank_transfer">{locale === "zh" ? "银行转账" : "Virement"}</option>
                <option value="offset">{locale === "zh" ? "抵扣/转款" : "Compensation"}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>
                {locale === "zh" ? "自动业务编号" : "Référence automatique"}
              </label>
              <input
                type="text"
                readOnly
                value={`${buildLeaseFinancialReferencePrefix(
                  selectedUnit
                    ? (buildingMap.get(selectedUnit.building_id)?.code ?? "SACSI")
                    : "SACSI",
                  selectedUnit?.unit_no ?? "UNIT",
                  selected.contract_no,
                  financeType,
                  financeDate,
                )}${locale === "zh" ? "-自动顺序" : "-auto"}`}
                className={cn(inputClass, "bg-muted/50 text-xs text-muted-foreground")}
              />
            </div>
            <div>
              <label className={labelClass}>
                {locale === "zh"
                  ? "原始收据/银行凭证号（可选）"
                  : "N° reçu / banque d'origine (facultatif)"}
              </label>
              <input
                type="text"
                value={financeExternalReceiptNo}
                onChange={(event) => setFinanceExternalReceiptNo(event.target.value)}
                placeholder={
                  locale === "zh"
                    ? "仅作为凭证保存，不参与系统编号"
                    : "Conservé comme justificatif uniquement"
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{locale === "zh" ? "备注" : "Note"}</label>
              <textarea
                rows={3}
                value={financeNotes}
                onChange={(event) => setFinanceNotes(event.target.value)}
                placeholder={
                  locale === "zh"
                    ? "可填写对应月份、原始凭证或特殊说明"
                    : "Période, justificatif ou remarque"
                }
                className={inputClass}
              />
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
      {panel === "moveout" && selected && (
        <PanelShell onClose={() => setPanel(null)} title={t.settlement.moveOut}>
          {/* form kept identical to original */}
          {/*...*/}
          <div className="space-y-4">
            <div>
              <label className={labelClass}>{t.form.actualEndDate}</label>
              <DateInput value={moEndDate} onChangeValue={setMoEndDate} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>
                {locale === "zh" ? "本次已实际补收租金（XOF）" : "Loyer effectivement reçu (XOF)"}
              </label>
              <input
                type="number"
                value={moUnpaid}
                onChange={(e) => setMoUnpaid(Number(e.target.value))}
                className={inputClass}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={moUtility}
                onChange={(e) => setMoUtility(e.target.checked)}
              />
              {locale === "zh" ? "水电已结清" : "Charges reglees"}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">
                  {locale === "zh" ? "押金扣除（非租金抵扣，XOF）" : "Retenue hors loyer (XOF)"}
                </label>
                <input
                  type="number"
                  value={moDeduction}
                  onChange={(e) => setMoDeduction(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  {locale === "zh"
                    ? "本次实际退还押金（XOF）"
                    : "Dépôt effectivement remboursé (XOF)"}
                </label>
                <input
                  type="number"
                  value={moRefund}
                  onChange={(e) => setMoRefund(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {locale === "zh"
                ? "补收款只冲抵已有到期欠租；欠款不会自动记为已收。退还与扣除须等于核实后的剩余实收押金。"
                : "Seuls les encaissements réels règlent les impayés existants. Le dépôt doit être vérifié."}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={moCollectedConfirmed}
                onChange={(e) => setMoCollectedConfirmed(e.target.checked)}
              />
              {locale === "zh"
                ? "我确认上述补收和退还均已实际发生"
                : "Je confirme les encaissements et remboursements réels"}
            </label>
            <div>
              <label className={labelClass}>
                {locale === "zh"
                  ? "实际收退款方式（不同方式请分开登记后再结算）"
                  : "Mode de paiement réel"}
              </label>
              <select
                className={inputClass}
                value={moMethod}
                onChange={(e) => setMoMethod(e.target.value as typeof moMethod)}
              >
                <option value="">{locale === "zh" ? "请选择" : "Choisir"}</option>
                <option value="cash">{locale === "zh" ? "现金" : "Espèces"}</option>
                <option value="check">{locale === "zh" ? "支票" : "Chèque"}</option>
                <option value="bank_transfer">{locale === "zh" ? "银行转账" : "Virement"}</option>
                <option value="offset">{locale === "zh" ? "抵扣/转款" : "Compensation"}</option>
                <option value="other">{locale === "zh" ? "其他" : "Autre"}</option>
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full" onClick={handleMoveOut} disabled={saving}>
              {saving ? "..." : locale === "zh" ? "确认退租" : "Confirmer"}
            </Button>
          </div>
        </PanelShell>
      )}
    </OperationalPage>
  );
}

// ── Card helpers ──
function Info({
  label,
  value,
  dim,
  warn,
  danger,
}: {
  label: string;
  value: string;
  dim?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1 text-[12px]">
      <span className="text-[#5D7186] shrink-0">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums truncate text-right",
          danger
            ? "text-[#C0394A]"
            : warn
              ? "text-amber-600"
              : dim
                ? "text-amber-600"
                : "text-[#17324D]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
function ActionBtn({
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,50,77,0.10)] bg-white/80 text-[#27506F] shadow-[0_1px_2px_rgba(25,58,92,0.04)] transition-colors hover:bg-white"
      aria-label={label}
      title={label}
    >
      <Icon className="h-[14px] w-[14px]" strokeWidth={1.5} />
    </button>
  );
}

// ── Shared panel shell ──
function PanelShell({
  onClose,
  title,
  badge,
  actions,
  children,
}: {
  onClose: () => void;
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RightDrawer open title={title} badge={badge} actions={actions} onClose={onClose}>
      {children}
    </RightDrawer>
  );
}
