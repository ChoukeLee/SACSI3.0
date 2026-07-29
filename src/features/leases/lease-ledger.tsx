"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Plus, Printer, Search, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, formatXof, sortUnits } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { EmptyState } from "@/components/empty-state";
import { SegmentedControl } from "@/components/ui/operational";
import type { CustomerRow, LeaseContractRow, PaymentRow, ReceivableRow, UnitRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";
import { contractStatusVariant } from "@/lib/status-styles";
import { printLeaseContract } from "@/features/print";
import { activateContract, createLeaseContract, recordLeaseFinancialEntry } from "./actions";
import {
  buildLeaseContractNumber,
  getLeaseFinancialConfig,
  getLeaseFinancialConfigBySourceType,
  isLeaseFinancialExpenseSourceType,
  LEASE_FINANCIAL_BUSINESS_CONFIG,
  LEASE_FINANCIAL_BUSINESS_TYPES,
  type LeaseFinancialBusinessType,
} from "./lease-financial-entry-types";

interface UnitBusinessFlag {
  business_type: "daily_rental" | "long_lease" | "sale";
  is_enabled: boolean;
  default_price_xof: number | null;
}

type LeaseUnitRow = UnitRow & { unit_business_flags?: UnitBusinessFlag[] };

interface LeaseLedgerProps {
  contracts: LeaseContractRow[];
  units: LeaseUnitRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  buildings: { id: string; code: string; display_name: string }[];
  locale: Locale;
  canCreate: boolean;
  canRecordFinance: boolean;
}

type Panel = "detail" | "finance" | "new" | null;

function paymentAmountXof(payment: PaymentRow) {
  return payment.currency === "XOF"
    ? Number(payment.amount)
    : Math.round(Number(payment.amount) * Number(payment.exchange_rate_to_xof));
}

function formatOriginalAmount(payment: PaymentRow) {
  return `${payment.currency} ${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(payment.amount))}`;
}

function getRecordedOriginalPayment(payment: PaymentRow) {
  const match = payment.notes?.match(/original_currency=([A-Z]{3});original_amount=([\d.]+);original_period_months=(\d+)/);
  if (!match) return null;
  const amount = Number(match[2]);
  const months = Number(match[3]);
  return amount > 0 && months > 0 ? { currency: match[1], amount, months } : null;
}

function getOriginalMonthlyRent(contract: LeaseContractRow, payments: PaymentRow[]) {
  const rentPayments = payments
    .filter((payment) => payment.source_id === contract.id && payment.source_type === "lease_rent")
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  for (const payment of rentPayments) {
    const recorded = getRecordedOriginalPayment(payment);
    if (recorded) return { currency: recorded.currency, amount: recorded.amount / recorded.months };
    if (payment.currency !== "XOF" && Number(payment.exchange_rate_to_xof) > 0) {
      return { currency: payment.currency, amount: Number(contract.monthly_rent_xof) / Number(payment.exchange_rate_to_xof) };
    }
  }
  return null;
}

function addOneDay(date: string | null | undefined) {
  if (!date) return null;
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function LeaseLedger({
  contracts,
  units,
  customers,
  payments,
  receivables,
  buildings,
  locale,
  canCreate,
  canRecordFinance,
}: LeaseLedgerProps) {
  const router = useRouter();
  const t = dictionaries[locale].leases;
  const today = new Date().toISOString().slice(0, 10);
  const [activeBuildingId, setActiveBuildingId] = useState(
    buildings.find((building) => building.code === "SACSI11")?.id ?? buildings[0]?.id ?? "all",
  );
  const [statusFilter, setStatusFilter] = useState("current");
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const unitMap = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const customerMap = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const buildingMap = useMemo(() => new Map(buildings.map((building) => [building.id, building])), [buildings]);

  const receivablesByContract = useMemo(() => {
    const result = new Map<string, ReceivableRow[]>();
    for (const row of receivables) {
      if (!row.source_id || row.source_type !== "lease_contract" || row.status === "cancelled") continue;
      result.set(row.source_id, [...(result.get(row.source_id) ?? []), row]);
    }
    return result;
  }, [receivables]);

  const paymentsByContract = useMemo(() => {
    const result = new Map<string, PaymentRow[]>();
    for (const row of payments) {
      if (!row.source_id) continue;
      result.set(row.source_id, [...(result.get(row.source_id) ?? []), row]);
    }
    return result;
  }, [payments]);

  const rows = useMemo(() => contracts.map((contract) => {
    const unit = unitMap.get(contract.unit_id);
    const customer = customerMap.get(contract.customer_id);
    const relatedReceivables = receivablesByContract.get(contract.id) ?? [];
    const relatedPayments = paymentsByContract.get(contract.id) ?? [];
    const totalReceivable = relatedReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0);
    const paidAgainstReceivables = relatedReceivables.reduce((sum, row) => sum + Number(row.paid_amount_xof), 0);
    const outstanding = Math.max(0, totalReceivable - paidAgainstReceivables);
    const overdue = relatedReceivables.reduce((sum, row) => {
      const balance = Math.max(0, Number(row.amount_xof) - Number(row.paid_amount_xof));
      return row.status === "overdue" || (balance > 0 && row.due_date < today) ? sum + balance : sum;
    }, 0);
    const earliestOpenDue = relatedReceivables
      .filter((row) => Number(row.amount_xof) > Number(row.paid_amount_xof))
      .map((row) => row.due_date)
      .sort()[0] ?? addOneDay(contract.paid_through_date);
    const actualIncome = relatedPayments.reduce(
      (sum, payment) => isLeaseFinancialExpenseSourceType(payment.source_type) ? sum : sum + paymentAmountXof(payment),
      0,
    );
    return {
      contract,
      unit,
      customer,
      relatedReceivables,
      relatedPayments,
      totalReceivable,
      paidAgainstReceivables,
      actualIncome,
      outstanding,
      overdue,
      nextDue: earliestOpenDue,
      originalRent: getOriginalMonthlyRent(contract, payments),
    };
  }), [contracts, customerMap, payments, paymentsByContract, receivablesByContract, today, unitMap]);

  const scopedRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return rows
      .filter((row) => activeBuildingId === "all" || row.unit?.building_id === activeBuildingId)
      .filter((row) => {
        if (statusFilter === "current") return row.contract.status !== "terminated" && row.contract.status !== "expired";
        return row.contract.status === statusFilter;
      })
      .filter((row) => {
        if (!keyword) return true;
        return [
          row.unit?.unit_no,
          row.customer?.name,
          row.customer?.phone,
          row.customer?.notes,
          row.contract.contract_no,
          row.contract.signer_name,
        ].some((value) => value?.toLocaleLowerCase().includes(keyword));
      })
      .sort((a, b) => {
        const buildingCompare = (a.unit?.building_id ?? "").localeCompare(b.unit?.building_id ?? "");
        if (buildingCompare) return buildingCompare;
        return (a.unit?.unit_no ?? "").localeCompare(b.unit?.unit_no ?? "", undefined, { numeric: true });
      });
  }, [activeBuildingId, rows, search, statusFilter]);

  const summary = useMemo(() => {
    const active = scopedRows.filter((row) => row.contract.status === "active");
    return {
      active: active.length,
      monthlyRent: active.reduce((sum, row) => sum + Number(row.contract.monthly_rent_xof), 0),
      outstanding: scopedRows.reduce((sum, row) => sum + row.outstanding, 0),
      overdue: scopedRows.reduce((sum, row) => sum + row.overdue, 0),
    };
  }, [scopedRows]);

  const selected = rows.find((row) => row.contract.id === selectedId) ?? null;
  const openDetail = (id: string) => {
    setSelectedId(id);
    setError("");
    setPanel("detail");
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{locale === "zh" ? "租售业务" : "Locations et ventes"}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{locale === "zh" ? "长租台账" : "Registre des locations"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {locale === "zh" ? "以合同、实际收款和未结应收为准" : "Contrats, encaissements réels et créances ouvertes"}
          </p>
        </div>
        {canCreate && <Button onClick={() => { setError(""); setPanel("new"); }}><Plus className="h-4 w-4" />{locale === "zh" ? "新建长租" : "Nouveau bail"}</Button>}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label={locale === "zh" ? "生效合同" : "Contrats actifs"} value={`${summary.active}`} />
        <SummaryCard label={locale === "zh" ? "月租合计" : "Loyer mensuel"} value={formatXof(summary.monthlyRent)} />
        <SummaryCard label={locale === "zh" ? "未收合计" : "Reste à recevoir"} value={formatXof(summary.outstanding)} tone={summary.outstanding > 0 ? "amber" : "normal"} />
        <SummaryCard label={locale === "zh" ? "其中逾期" : "Dont en retard"} value={formatXof(summary.overdue)} tone={summary.overdue > 0 ? "red" : "normal"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          {buildings.length > 1 && (
            <SegmentedControl
              value={activeBuildingId}
              onChange={setActiveBuildingId}
              ariaLabel={locale === "zh" ? "楼栋筛选" : "Filtre bâtiment"}
              items={[
                { value: "all", label: locale === "zh" ? "全部楼栋" : "Tous" },
                ...buildings.map((building) => ({ value: building.id, label: building.display_name || building.code })),
              ]}
            />
          )}
          <SegmentedControl
            value={statusFilter}
            onChange={setStatusFilter}
            ariaLabel={locale === "zh" ? "合同状态" : "Statut"}
            items={[
              { value: "current", label: locale === "zh" ? "当前" : "En cours" },
              { value: "active", label: t.contractStatus.active },
              { value: "draft", label: t.contractStatus.draft },
              { value: "terminated", label: t.contractStatus.terminated },
              { value: "expired", label: t.contractStatus.expired },
            ]}
          />
        </div>
        <label className="flex h-9 min-w-64 items-center gap-2 rounded-md border bg-background px-3 text-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none"
            placeholder={locale === "zh" ? "搜索房号、租客、电话、备注" : "Rechercher logement, locataire, note"}
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {scopedRows.length === 0 ? <EmptyState title={t.empty} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1420px] border-collapse text-sm">
              <thead className="bg-muted/55 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">{locale === "zh" ? "楼栋 / 房号" : "Bâtiment / Lot"}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">{locale === "zh" ? "租客" : "Locataire"}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">{locale === "zh" ? "状态" : "Statut"}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">{locale === "zh" ? "租期" : "Période"}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">{locale === "zh" ? "月租" : "Loyer"}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">{locale === "zh" ? "押金" : "Dépôt"}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">{locale === "zh" ? "实际已收" : "Encaissé"}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">{locale === "zh" ? "未收" : "À recevoir"}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">{locale === "zh" ? "下次到期" : "Prochaine échéance"}</th>
                  <th className="px-4 py-3 font-medium">{locale === "zh" ? "备注" : "Note"}</th>
                  <th className="w-20 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {scopedRows.map((row) => {
                  const building = row.unit ? buildingMap.get(row.unit.building_id) : null;
                  return (
                    <tr key={row.contract.id} className="border-t transition-colors hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-semibold">{building?.display_name || building?.code || "-"}</p>
                        <p className="mt-0.5 text-muted-foreground">{row.unit?.unit_no ?? "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-40 truncate font-medium" title={row.customer?.name}>{row.customer?.name ?? "-"}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{row.customer?.phone || "-"}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3"><Badge variant={contractStatusVariant[row.contract.status]}>{t.contractStatus[row.contract.status as keyof typeof t.contractStatus]}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                        <p>{row.contract.start_date}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">→ {row.contract.expected_end_confirmed === false ? (locale === "zh" ? "待确认" : "À confirmer") : row.contract.expected_end_date}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        <p className="font-medium">{formatXof(Number(row.contract.monthly_rent_xof))}</p>
                        {row.originalRent && <p className="mt-0.5 text-xs text-muted-foreground">≈ {row.originalRent.currency} {new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(row.originalRent.amount)}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="tabular-nums">{formatXof(Number(row.contract.deposit_amount_xof))}</p>
                        <p className={cn("mt-0.5 text-xs font-medium", row.contract.deposit_received ? "text-emerald-700" : "text-amber-700")}>{row.contract.deposit_received ? (locale === "zh" ? "已收" : "Reçu") : (locale === "zh" ? "未收" : "Non reçu")}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-emerald-700">{formatXof(row.actualIncome)}</td>
                      <td className={cn("whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums", row.overdue > 0 ? "text-red-600" : row.outstanding > 0 ? "text-amber-700" : "text-muted-foreground")}>{formatXof(row.outstanding)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                        <p className={cn(row.overdue > 0 && "font-medium text-red-600")}>{row.nextDue ?? "-"}</p>
                        {row.contract.paid_through_date && <p className="mt-0.5 text-xs text-muted-foreground">{locale === "zh" ? "已缴至" : "Payé au"} {row.contract.paid_through_date}</p>}
                      </td>
                      <td className="px-4 py-3"><p className="max-w-52 truncate text-xs text-muted-foreground" title={row.customer?.notes ?? ""}>{row.customer?.notes || "-"}</p></td>
                      <td className="px-4 py-3 text-right">
                        <Button size="icon" variant="ghost" onClick={() => openDetail(row.contract.id)} title={locale === "zh" ? "查看明细" : "Voir"}><Eye className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {panel === "detail" && selected && (
        <DetailPanel
          row={selected}
          locale={locale}
          canCreate={canCreate}
          canRecordFinance={canRecordFinance}
          onClose={() => setPanel(null)}
          onFinance={() => { setError(""); setPanel("finance"); }}
          onActivate={async () => {
            setSaving(true);
            setError("");
            const result = await activateContract(selected.contract.id);
            setSaving(false);
            if (!result.success) setError(result.error ?? "Failed");
            else router.refresh();
          }}
          saving={saving}
          error={error}
        />
      )}
      {panel === "finance" && selected && (
        <FinancePanel
          row={selected}
          locale={locale}
          onClose={() => setPanel("detail")}
          onSuccess={() => { setPanel("detail"); router.refresh(); }}
        />
      )}
      {panel === "new" && canCreate && (
        <NewLeasePanel
          locale={locale}
          units={units}
          customers={customers}
          buildings={buildings}
          onClose={() => setPanel(null)}
          onSuccess={() => { setPanel(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

type LedgerRow = {
  contract: LeaseContractRow;
  unit: LeaseUnitRow | undefined;
  customer: CustomerRow | undefined;
  relatedReceivables: ReceivableRow[];
  relatedPayments: PaymentRow[];
  totalReceivable: number;
  paidAgainstReceivables: number;
  actualIncome: number;
  outstanding: number;
  overdue: number;
  nextDue: string | null;
  originalRent: { currency: string; amount: number } | null;
};

function SummaryCard({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "amber" | "red" }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-lg font-semibold tabular-nums", tone === "amber" && "text-amber-700", tone === "red" && "text-red-600")}>{value}</p>
    </div>
  );
}

function DetailPanel({
  row,
  locale,
  canCreate,
  canRecordFinance,
  onClose,
  onFinance,
  onActivate,
  saving,
  error,
}: {
  row: LedgerRow;
  locale: Locale;
  canCreate: boolean;
  canRecordFinance: boolean;
  onClose: () => void;
  onFinance: () => void;
  onActivate: () => void;
  saving: boolean;
  error: string;
}) {
  const t = dictionaries[locale].leases;
  return (
    <PanelShell title={`${row.unit?.unit_no ?? "-"} · ${row.customer?.name ?? "-"}`} onClose={onClose} actions={
      <button onClick={() => printLeaseContract({ contract: row.contract, unit: row.unit ?? null, customer: row.customer ?? null, receivables: row.relatedReceivables }, locale)} className="rounded-md p-2 hover:bg-muted" title={locale === "zh" ? "打印" : "Imprimer"}><Printer className="h-4 w-4" /></button>
    }>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/25 p-4 text-sm">
          <Info label={locale === "zh" ? "合同编号" : "Contrat"} value={row.contract.contract_no} wide />
          <Info label={locale === "zh" ? "状态" : "Statut"} value={t.contractStatus[row.contract.status as keyof typeof t.contractStatus]} />
          <Info label={locale === "zh" ? "联系电话" : "Téléphone"} value={row.customer?.phone || "-"} />
          <Info label={locale === "zh" ? "起租日" : "Début"} value={row.contract.start_date} />
          <Info label={locale === "zh" ? "到期日" : "Fin"} value={row.contract.expected_end_confirmed === false ? (locale === "zh" ? "待确认" : "À confirmer") : row.contract.expected_end_date} />
          <Info label={locale === "zh" ? "月租" : "Loyer"} value={formatXof(Number(row.contract.monthly_rent_xof))} />
          <Info label={locale === "zh" ? "押金" : "Dépôt"} value={`${formatXof(Number(row.contract.deposit_amount_xof))} · ${row.contract.deposit_received ? (locale === "zh" ? "已收" : "reçu") : (locale === "zh" ? "未收" : "non reçu")}`} />
          <Info label={locale === "zh" ? "已缴至" : "Payé au"} value={row.contract.paid_through_date || "-"} />
          <Info label={locale === "zh" ? "实际已收" : "Encaissé"} value={formatXof(row.actualIncome)} />
          <Info label={locale === "zh" ? "未收应收" : "À recevoir"} value={formatXof(row.outstanding)} />
          <Info label={locale === "zh" ? "备注" : "Note"} value={row.customer?.notes || "-"} wide />
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="font-semibold">{locale === "zh" ? "历史收付款" : "Historique financier"}</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">{locale === "zh" ? "原币与折合西法同时保留" : "Devise d'origine et équivalent XOF"}</p>
            </div>
            {canRecordFinance && <Button size="sm" onClick={onFinance}><Plus className="h-4 w-4" />{locale === "zh" ? "登记收付款" : "Saisir"}</Button>}
          </div>
          <div className="space-y-2">
            {row.relatedPayments.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{locale === "zh" ? "暂无记录" : "Aucune écriture"}</p> : row.relatedPayments.map((payment) => {
              const expense = isLeaseFinancialExpenseSourceType(payment.source_type);
              const config = getLeaseFinancialConfigBySourceType(payment.source_type);
              const recorded = getRecordedOriginalPayment(payment);
              return (
                <div key={payment.id} className="flex items-start justify-between gap-4 rounded-lg border p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{config
                      ? (locale === "zh" ? config.labelZh : config.labelFr)
                      : payment.source_type === "lease_contract"
                        ? (locale === "zh" ? "租金收入" : "Revenu de loyer")
                        : (locale === "zh" ? "财务记录" : "Écriture")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{payment.payment_date} · {payment.receipt_no || (locale === "zh" ? "无业务编号" : "Sans référence")}</p>
                    {payment.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{payment.notes}</p>}
                  </div>
                  <div className={cn("shrink-0 text-right font-semibold tabular-nums", expense ? "text-red-600" : "text-emerald-700")}>
                    <p>{expense ? "- " : ""}{recorded ? `${recorded.currency} ${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(recorded.amount)}` : payment.currency === "XOF" ? formatXof(Number(payment.amount)) : formatOriginalAmount(payment)}</p>
                    {(payment.currency !== "XOF" || recorded) && <p className="mt-1 text-xs font-normal text-muted-foreground">≈ {formatXof(paymentAmountXof(payment))}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {row.contract.status === "draft" && canCreate && <Button className="w-full" onClick={onActivate} disabled={saving}>{locale === "zh" ? "确认启用合同" : "Activer le contrat"}</Button>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </PanelShell>
  );
}

function FinancePanel({ row, locale, onClose, onSuccess }: { row: LedgerRow; locale: Locale; onClose: () => void; onSuccess: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [businessType, setBusinessType] = useState<LeaseFinancialBusinessType>("rent_income");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountWan, setAmountWan] = useState(0);
  const [paidThrough, setPaidThrough] = useState("");
  const [method, setMethod] = useState<"cash" | "check" | "bank_transfer" | "offset" | "other">("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30";
  const config = getLeaseFinancialConfig(businessType);
  const submit = async () => {
    if (amountWan <= 0) return setError(locale === "zh" ? "请输入有效金额" : "Montant invalide");
    if (config.requiresPaidThrough && !paidThrough) return setError(locale === "zh" ? "请填写租金已缴至日期" : "Date payée au obligatoire");
    setSaving(true);
    setError("");
    const result = await recordLeaseFinancialEntry({
      contractId: row.contract.id,
      businessType,
      paymentDate: date,
      amountXof: Math.round(amountWan * 10000),
      paidThroughDate: paidThrough || undefined,
      paymentMethod: method,
      notes: notes || undefined,
      requestId,
    });
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
    else onSuccess();
  };
  return (
    <PanelShell title={locale === "zh" ? "登记长租收付款" : "Saisir une opération"} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm"><p className="font-semibold">{row.unit?.unit_no} · {row.customer?.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.contract.contract_no}</p></div>
        <Field label={locale === "zh" ? "业务类型" : "Type"}>
          <select className={inputClass} value={businessType} onChange={(event) => setBusinessType(event.target.value as LeaseFinancialBusinessType)}>
            {LEASE_FINANCIAL_BUSINESS_TYPES.map((type) => <option key={type} value={type}>{locale === "zh" ? LEASE_FINANCIAL_BUSINESS_CONFIG[type].labelZh : LEASE_FINANCIAL_BUSINESS_CONFIG[type].labelFr}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={locale === "zh" ? "日期" : "Date"}><DateInput className={inputClass} value={date} onChangeValue={setDate} /></Field>
          <Field label={locale === "zh" ? "金额（万 FCFA）" : "Montant (10k FCFA)"}><input className={inputClass} type="number" min="0" step="0.01" value={amountWan || ""} onChange={(event) => setAmountWan(Number(event.target.value))} /></Field>
        </div>
        {config.requiresPaidThrough && <Field label={locale === "zh" ? "租金已缴至" : "Loyer payé au"}><DateInput className={inputClass} value={paidThrough} onChangeValue={setPaidThrough} /></Field>}
        <Field label={locale === "zh" ? "收付方式" : "Mode"}>
          <select className={inputClass} value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option value="cash">{locale === "zh" ? "现金" : "Espèces"}</option>
            <option value="check">{locale === "zh" ? "支票" : "Chèque"}</option>
            <option value="bank_transfer">{locale === "zh" ? "银行转账" : "Virement"}</option>
            <option value="offset">{locale === "zh" ? "抵扣 / 转款" : "Compensation"}</option>
            <option value="other">{locale === "zh" ? "其他" : "Autre"}</option>
          </select>
        </Field>
        <Field label={locale === "zh" ? "备注" : "Note"}><textarea className={inputClass} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        <p className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs leading-relaxed text-blue-800">{locale === "zh" ? "财务最终以西非法郎入账；如原始付款为人民币、美元或欧元，请在备注中保留币种、原金额和汇率。" : "La comptabilité est arrêtée en XOF. Conservez la devise, le montant d'origine et le taux dans la note."}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full" onClick={submit} disabled={saving}>{locale === "zh" ? "确认登记" : "Confirmer"}</Button>
      </div>
    </PanelShell>
  );
}

function NewLeasePanel({ locale, units, customers, buildings, onClose, onSuccess }: { locale: Locale; units: LeaseUnitRow[]; customers: CustomerRow[]; buildings: { id: string; code: string; display_name: string }[]; onClose: () => void; onSuccess: () => void }) {
  const [unitId, setUnitId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [cycle, setCycle] = useState("monthly");
  const [payDay, setPayDay] = useState(5);
  const [rentWan, setRentWan] = useState(0);
  const [depositWan, setDepositWan] = useState(0);
  const [depositReceived, setDepositReceived] = useState(false);
  const [signer, setSigner] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const buildingMap = new Map(buildings.map((building) => [building.id, building]));
  const availableUnits = sortUnits(units.filter((unit) => unit.kind === "apartment" && (
    unit.status === "available" ||
    (unit.status === "sold" && unit.unit_business_flags?.some((flag) => flag.business_type === "long_lease" && flag.is_enabled))
  )));
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const contractNo = selectedUnit && startDate ? buildLeaseContractNumber(buildingMap.get(selectedUnit.building_id)?.code ?? "SACSI", selectedUnit.unit_no, startDate) : "";
  const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30";
  const submit = async () => {
    if (!unitId || !customerId || !startDate || !endDate || rentWan <= 0) return setError(locale === "zh" ? "请完整填写房源、租客、租期和租金" : "Complétez le logement, le locataire, la période et le loyer");
    setSaving(true);
    setError("");
    const result = await createLeaseContract({
      unitId,
      customerId,
      contractNo,
      startDate,
      expectedEndDate: endDate,
      paymentCycle: cycle,
      paymentDay: payDay,
      monthlyRentXof: Math.round(rentWan * 10000),
      depositAmountXof: Math.round(depositWan * 10000),
      depositReceived,
      rentFreeDays: 0,
      signerName: signer || undefined,
      status: "active" as ContractStatus,
    });
    setSaving(false);
    if (!result.success) setError(result.error ?? "Failed");
    else onSuccess();
  };
  return (
    <PanelShell title={locale === "zh" ? "新建长租" : "Nouveau bail"} onClose={onClose}>
      <div className="space-y-4">
        <Field label={locale === "zh" ? "房源" : "Logement"}><select className={inputClass} value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="">-</option>{availableUnits.map((unit) => <option key={unit.id} value={unit.id}>{buildingMap.get(unit.building_id)?.display_name || buildingMap.get(unit.building_id)?.code} · {unit.unit_no}</option>)}</select></Field>
        <Field label={locale === "zh" ? "租客" : "Locataire"}><select className={inputClass} value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">-</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label={locale === "zh" ? "起租日" : "Début"}><DateInput className={inputClass} value={startDate} onChangeValue={setStartDate} /></Field><Field label={locale === "zh" ? "到期日" : "Fin"}><DateInput className={inputClass} value={endDate} onChangeValue={setEndDate} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label={locale === "zh" ? "月租（万 FCFA）" : "Loyer (10k FCFA)"}><input className={inputClass} type="number" min="0" step="0.01" value={rentWan || ""} onChange={(event) => setRentWan(Number(event.target.value))} /></Field><Field label={locale === "zh" ? "押金（万 FCFA）" : "Dépôt (10k FCFA)"}><input className={inputClass} type="number" min="0" step="0.01" value={depositWan || ""} onChange={(event) => setDepositWan(Number(event.target.value))} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label={locale === "zh" ? "缴租周期" : "Cycle"}><select className={inputClass} value={cycle} onChange={(event) => setCycle(event.target.value)}><option value="monthly">{locale === "zh" ? "月付" : "Mensuel"}</option><option value="quarterly">{locale === "zh" ? "季付" : "Trimestriel"}</option><option value="semiannual">{locale === "zh" ? "半年付" : "Semestriel"}</option><option value="annual">{locale === "zh" ? "年付" : "Annuel"}</option></select></Field><Field label={locale === "zh" ? "每期缴租日" : "Jour de paiement"}><input className={inputClass} type="number" min="1" max="31" value={payDay} onChange={(event) => setPayDay(Number(event.target.value))} /></Field></div>
        <Field label={locale === "zh" ? "签约 / 经办人" : "Signataire"}><input className={inputClass} value={signer} onChange={(event) => setSigner(event.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={depositReceived} onChange={(event) => setDepositReceived(event.target.checked)} />{locale === "zh" ? "押金已实际收到" : "Dépôt effectivement reçu"}</label>
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">{locale === "zh" ? `合同编号：${contractNo || "选择房源和起租日后自动生成"}。提交后直接生效，不经过审核。` : `Contrat : ${contractNo || "généré automatiquement"}. Activation immédiate sans validation.`}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full" onClick={submit} disabled={saving}>{locale === "zh" ? "确认创建并生效" : "Créer et activer"}</Button>
      </div>
    </PanelShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</span>{children}</label>;
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return <div className={cn(wide && "col-span-2")}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}

function PanelShell({ title, onClose, actions, children }: { title: string; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 top-12 z-overlay bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed bottom-0 right-0 top-12 z-panel w-full max-w-[560px] overflow-y-auto border-l bg-card shadow-2xl">
        <div className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b bg-card/95 px-5 backdrop-blur">
          <h3 className="font-semibold">{title}</h3>
          <div className="flex items-center gap-1">{actions}<button onClick={onClose} className="rounded-md p-2 hover:bg-muted"><X className="h-4 w-4" /></button></div>
        </div>
        <div className="p-5">{children}</div>
      </aside>
    </>
  );
}
