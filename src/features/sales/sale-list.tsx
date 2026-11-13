"use client";

import { formatPropertyXof } from "@/lib/property-money";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
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
  terminateSaleContract,
} from "./actions";
import { buildSaleContractNumber } from "@/lib/contract-number";
import { printSaleContract } from "@/features/print";
import { buildContractReceivableSummaries } from "@/features/contracts/contract-list-model";
import { resolveContractProjectLink } from "@/features/contracts/project-link";
import { useContractWorkspace } from "@/features/contracts/use-workspace";
import type { WorkspaceData } from "@/features/contracts/workspace-model";
import { workspaceQueryKey } from "@/features/contracts/workspace-model";
import { useContractPrinter } from "@/features/contracts/use-contract-printer";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { SaleWorkbenchInspector, type SaleWorkbenchAction } from "./sale-workbench-inspector";
import { useSaleWorkbenchPreview } from "./use-sale-workbench-preview";
import { SaleRoomOverview } from "./sale-room-overview";
import { buildSaleRecordOverview, buildSaleRoomOverview } from "./sale-room-overview-model";
import { SALE_UUID, saleWorkbenchHref } from "./sale-workbench-model";
import styles from "./sale-workbench.module.css";
import { SaleWorkbenchScope, SaleNoSaleWorkspace } from "./sale-workbench-chrome";

interface SaleListProps {
  workspace?: WorkspaceData;
  initialProject?: string;
  initialContract?: string;
  returnTo?: string;
  initialFollowup?: boolean;
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
type PanelType = "new" | SaleWorkbenchAction | null;

export function SaleList({
  workspace: initialWorkspace,
  initialProject,
  initialContract,
  returnTo,
  initialFollowup = false,
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
  const formatXof = (amount: number) => formatPropertyXof(amount, locale);
  const [statusFilter, setStatusFilter] = useState(initialWorkspace?.query.status ?? "current");
  const [search, setSearch] = useState(initialWorkspace?.query.search ?? "");
  const [previewSelection, setPreviewSelection] = useState<{ id: string; scope: string } | null>(
    () =>
      initialContract && SALE_UUID.test(initialContract) && initialWorkspace
        ? {
            id: initialContract,
            scope: workspaceQueryKey({
              ...initialWorkspace.query,
              status: "all",
              search: "",
              page: 1,
              sort: "unit",
              direction: "asc",
            }),
          }
        : null,
  );
  const [panel, setPanel] = useState<PanelType>(null);
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
  const incomingScope = initialWorkspace
    ? `${initialWorkspace.query.projectId}/${initialWorkspace.query.buildingId}/${initialWorkspace.query.locale}`
    : "";
  const incomingScopeRef = useRef(incomingScope);
  const currentQuery = workspace.query;
  const browseQuery = useMemo(
    () =>
      currentQuery
        ? {
            ...currentQuery,
            status: statusFilter === "historical" ? "all" : statusFilter,
            search,
            page: 1,
            sort: "unit" as const,
            direction: "asc" as const,
          }
        : undefined,
    [currentQuery, statusFilter, search],
  );
  const currentScope = currentQuery
    ? workspaceQueryKey(currentQuery)
    : `${requestedProjectId}/${activeBuildingId}`;
  const pageScopeReady = Boolean(
    currentQuery &&
    currentQuery.status === "all" &&
    !currentQuery.search &&
    currentQuery.page === 1 &&
    currentQuery.sort === "unit" &&
    currentQuery.direction === "asc" &&
    workspace.pageData &&
    workspaceQueryKey(workspace.pageData.query) === currentScope,
  );
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
  const currentHref = browseQuery
    ? saleWorkbenchHref(browseQuery, previewId)
    : `${locale === "fr" ? "/fr" : ""}/sales`;
  const previewTitleContract = (preview.data?.contracts ?? initialContracts).find(
    (row) => row.id === previewId,
  );
  const previewTitleUnit = (preview.data?.units ?? initialUnits).find(
    (row) => row.id === previewTitleContract?.unit_id,
  );
  const previewDrawerTitle = previewTitleUnit
    ? (buildings.find((row) => row.id === previewTitleUnit.building_id)?.display_name ?? "—") +
      " · " +
      previewTitleUnit.unit_no
    : locale === "zh"
      ? "出售资料"
      : "Dossier de vente";
  const safeReturn = safeWorkbenchReturnTo(returnTo);
  actionSelectionRef.current =
    previewSelection?.scope === currentScope ? `${currentScope}/${previewSelection.id}` : "";
  const selectPreview = (id: string, section: "overview" | "finance" = "overview") => {
    actionRequestRef.current += 1;
    setPreviewSelection({ id, scope: currentScope });
    setPreviewTab(section);
    setPanel(null);
    setSelectedId(null);
  };
  const closePreview = () => {
    actionRequestRef.current += 1;
    setPreviewSelection(null);
    setPanel(null);
    setSelectedId(null);
  };
  useEffect(() => {
    if (incomingScopeRef.current === incomingScope) return;
    incomingScopeRef.current = incomingScope;
    if (!initialWorkspace) return;
    setActiveBuildingId(initialWorkspace.query.buildingId);
    actionRequestRef.current += 1;
    setPreviewSelection(null);
    setPanel(null);
    setSelectedId(null);
  }, [incomingScope, initialWorkspace]);
  useEffect(() => {
    if (
      !currentQuery ||
      !browseQuery ||
      typeof window === "undefined" ||
      currentQuery.status !== "all" ||
      currentQuery.search ||
      currentQuery.page !== 1 ||
      currentQuery.sort !== "unit" ||
      currentQuery.direction !== "asc"
    )
      return;
    if ((!pageScopeReady || workspace.unavailable) && previewSelection?.scope === currentScope)
      return;
    const params = new URLSearchParams(window.location.search);
    const back = safeWorkbenchReturnTo(params.get("returnTo"));
    const href = new URL(saleWorkbenchHref(browseQuery, previewId), window.location.origin);
    if (back) href.searchParams.set("returnTo", back);
    const next = href.pathname + href.search;
    if (window.location.pathname + window.location.search !== next)
      window.history.replaceState(window.history.state, "", next);
  }, [
    currentScope,
    previewId,
    previewSelection,
    currentQuery,
    browseQuery,
    pageScopeReady,
    workspace.unavailable,
  ]);
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
        status: "all",
        search: "",
        locale,
        page: 1,
        sort: "unit",
        direction: "asc",
      });
  }, [
    workspace.enabled,
    workspace.change,
    initialWorkspace,
    requestedProjectId,
    activeBuildingId,
    locale,
  ]);

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const roomContext = workspace.contextData;
  const roomContextReady =
    !workspace.enabled ||
    Boolean(
      roomContext &&
      Array.isArray(roomContext.roomReceivables) &&
      Array.isArray(roomContext.roomPayments) &&
      Array.isArray(roomContext.roomSchedules) &&
      roomContext.query.projectId === (requestedProjectId ?? "") &&
      roomContext.query.buildingId === activeBuildingId &&
      roomContext.query.status === "all" &&
      !roomContext.query.search,
    );
  useEffect(() => {
    if (
      !workspace.enabled ||
      noSaleProject ||
      !pageScopeReady ||
      !workspace.query ||
      workspace.query.projectId !== (requestedProjectId ?? "") ||
      workspace.query.buildingId !== activeBuildingId ||
      roomContextReady ||
      workspace.roomContextLoading ||
      workspace.roomContextError ||
      workspace.error
    )
      return;
    void workspace.ensureRoomContext().catch(() => undefined);
  }, [
    workspace.enabled,
    noSaleProject,
    pageScopeReady,
    workspace.query?.projectId,
    workspace.query?.buildingId,
    requestedProjectId,
    activeBuildingId,
    roomContextReady,
    workspace.roomContextLoading,
    workspace.roomContextError,
    workspace.error,
    workspace.ensureRoomContext,
  ]);
  const roomOverview = useMemo(() => {
    if (workspace.enabled && !roomContextReady) return { rows: [], records: [] };
    const source = workspace.enabled ? roomContext : undefined;
    const input = {
      units: (source?.units ?? initialUnits).filter(
        (unit) =>
          scopeBuildingIds.has(unit.building_id) &&
          (!activeBuildingId || unit.building_id === activeBuildingId),
      ),
      contracts: (source?.contracts ?? initialContracts) as SaleContractRow[],
      customers: source?.customers ?? initialCustomers,
      buildings: buildings.map((building) => ({
        ...building,
        project_id: building.project_id ?? null,
        project: building.project ?? null,
      })),
      today: source?.today ?? new Date().toISOString().slice(0, 10),
      receivables: source?.roomReceivables ?? initialReceivables,
      payments: source?.roomPayments ?? initialPayments,
      schedules: source?.roomSchedules ?? initialSchedules,
    };
    return { rows: buildSaleRoomOverview(input), records: buildSaleRecordOverview(input) };
  }, [
    workspace.enabled,
    roomContextReady,
    roomContext,
    initialUnits,
    initialContracts,
    initialCustomers,
    initialReceivables,
    initialPayments,
    initialSchedules,
    scopeBuildingIds,
    activeBuildingId,
    buildings,
  ]);
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
  const selectedNewUnit = useMemo(() => unitMap.get(fUnitId), [fUnitId, unitMap]);
  const generatedSaleContractNo = useMemo(() => {
    if (!selectedNewUnit || !fSignedDate) return "";
    const building = buildings.find((item) => item.id === selectedNewUnit.building_id);
    return buildSaleContractNumber(building?.code ?? "SACSI", selectedNewUnit.unit_no, fSignedDate);
  }, [buildings, fSignedDate, selectedNewUnit]);

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
      (action === "installment" && !canManage) ||
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
    if (
      (action === "payment" || action === "installment") &&
      (fresh.sale_currency ?? "XOF") !== "XOF"
    ) {
      setError(
        locale === "zh"
          ? "原币登记仅供查看核对，不能在此手工录入西法收款或分期。"
          : "Dossier en devise consultable ; aucun encaissement ou échéancier en XOF ne peut être saisi ici.",
      );
      return;
    }
    setSelectedId(id);
    if (action === "payment") {
      setPayScheduleId(freshSchedules.find((row) => row.status !== "paid")?.id ?? "");
    } else if (action === "installment") {
      setShowFlexForm(true);
      setFlexDueDate("");
      setFlexAmount(0);
    }
    setPanel(action);
  };
  const printContract = (contract: SaleContractRow) =>
    printer.print(
      async () => {
        if (workspace.enabled) {
          const data = await workspace.ensure("detail", contract.id);
          const fresh = data.contracts[0] as SaleContractRow;
          if (
            fresh.registration_basis === "source_record" ||
            !fresh.signed_date ||
            (fresh.sale_currency ?? "XOF") !== "XOF"
          )
            throw new Error(
              locale === "zh"
                ? "此初始登记暂无可打印的合同；请查看已登记资料。"
                : "Aucun contrat imprimable pour cet enregistrement ; consultez le dossier.",
            );
          return {
            contract: fresh,
            unit: data.units.find((row) => row.id === fresh.unit_id) ?? null,
            customer: data.customers.find((row) => row.id === fresh.customer_id) ?? null,
            summary: data.summaries[fresh.id],
          };
        }
        if (
          contract.registration_basis === "source_record" ||
          !contract.signed_date ||
          (contract.sale_currency ?? "XOF") !== "XOF"
        )
          throw new Error(
            locale === "zh"
              ? "此初始登记暂无可打印的合同；请查看已登记资料。"
              : "Aucun contrat imprimable pour cet enregistrement ; consultez le dossier.",
          );
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

  const inputClass =
    "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-border-strong outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";
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
  if (noSaleProject)
    return (
      <SaleNoSaleWorkspace locale={locale} projectId={requestedProjectId} scope={scopeToolbar} />
    );

  return (
    <OperationalPage
      className={styles.workbench}
      title={locale === "zh" ? "出售" : "Ventes"}
      description={
        locale === "zh"
          ? "按楼栋看房款，单独跟进未收尾款。"
          : "Acquéreurs, paiements et échéances par bâtiment. Choisissez un lot pour vérifier son dossier."
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

      {printer.error && (
        <p role="alert" className="text-sm text-destructive">
          {printer.error}
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
      <SaleRoomOverview
        rows={roomOverview.rows}
        records={roomOverview.records}
        locale={locale}
        search={search}
        onSearchChange={(value) => {
          closePreview();
          setSearch(value);
        }}
        recordStatus={statusFilter === "current" ? undefined : statusFilter}
        onRecordStatusChange={(value) => {
          closePreview();
          setStatusFilter(value);
        }}
        initialRecordsOpen={statusFilter !== "current"}
        initialFollowup={initialFollowup}
        onBrowseChange={closePreview}
        loading={
          workspace.enabled &&
          (!roomContextReady || workspace.roomContextLoading) &&
          !workspace.roomContextError &&
          !workspace.error
        }
        error={workspace.enabled && (workspace.roomContextError || workspace.error)}
        selectedRecordId={previewId}
        busy={saving}
        onSelectRecord={(row) => selectPreview(row.id)}
        onRetry={() => {
          if (workspace.error) workspace.retry();
          else void workspace.ensureRoomContext().catch(() => undefined);
        }}
      />
      <>
        {!workspace.unavailable && previewId && panel === null ? (
          <RightDrawer open width="wide" title={previewDrawerTitle} onClose={closePreview}>
            <div
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
                embedded
                operationError={error}
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
                historyContent={
                  roomContextReady &&
                  !workspace.roomContextLoading &&
                  !workspace.roomContextError &&
                  !preview.loading &&
                  !preview.error ? (
                    <section
                      aria-label={locale === "zh" ? "本房出售历史" : "Historique des ventes du lot"}
                    >
                      <h3 className="mb-3 text-sm font-semibold">
                        {locale === "zh" ? "本房出售历史" : "Historique des ventes du lot"}
                      </h3>
                      <div className={styles.recordHistory}>
                        {roomOverview.records
                          .filter(
                            (row) =>
                              row.unit.id ===
                              roomOverview.records.find((record) => record.id === previewId)?.unit
                                .id,
                          )
                          .map((record) => (
                            <button
                              key={record.id}
                              type="button"
                              data-sale-room-record-id={record.id}
                              aria-pressed={record.id === previewId}
                              disabled={saving}
                              onClick={() => selectPreview(record.id)}
                            >
                              <strong>
                                {record.customer?.name ??
                                  (locale === "zh" ? "买方待登记" : "Acquéreur à compléter")}
                              </strong>
                              <span>
                                {record.contract.signed_date ||
                                  (locale === "zh"
                                    ? "签约未登记"
                                    : "Signature non renseignée")}{" "}
                                · {t.contractStatus[record.contract.status]}
                              </span>
                            </button>
                          ))}
                      </div>
                    </section>
                  ) : null
                }
                onPrint={printContract}
              />
            </div>
          </RightDrawer>
        ) : null}
      </>

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
      {selected && ["payment", "installment", "terminate"].includes(panel ?? "") && (
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
