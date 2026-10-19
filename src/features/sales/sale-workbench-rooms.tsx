"use client";

import { DollarSign, Eye, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  formatContractXof,
  type ContractReceivableSummary,
} from "@/features/contracts/contract-list-model";
import { dictionaries, type Locale } from "@/lib/i18n";
import { contractStatusVariant } from "@/lib/status-styles";
import type { SaleContractRow, UnitRow, CustomerRow } from "@/types/database";
import { salePrice } from "./sale-workbench-model";

/** Optional floor view. Its complete scope is fetched only after explicitly opened. */
export function SaleWorkbenchRooms({
  groups,
  units,
  customers,
  summaries,
  locale,
  onOpen,
  onPrint,
}: {
  groups: [string, SaleContractRow[]][];
  units: Map<string, UnitRow>;
  customers: Map<string, CustomerRow>;
  summaries: Map<string, ContractReceivableSummary>;
  locale: Locale;
  onOpen: (id: string, section?: "overview" | "finance") => void;
  onPrint: (contract: SaleContractRow) => void;
}) {
  const zh = locale === "zh",
    text = (chinese: string, french: string) => (zh ? chinese : french),
    money = (value: number) => formatContractXof(value, locale);
  if (!groups.length) return <EmptyState title={dictionaries[locale].sales.empty} />;
  return (
    <div className="space-y-4">
      {groups.map(([floor, contracts]) => (
        <section key={floor} className="overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-medium">{floor}</h2>
            <span className="text-xs text-muted-foreground">
              {contracts.length} {text("份合同", "contrats")}
            </span>
          </header>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {contracts.map((contract) => {
              const unit = units.get(contract.unit_id),
                customer = customers.get(contract.customer_id),
                summary = summaries.get(contract.id),
                price = salePrice(contract);
              return (
                <article
                  className="flex min-w-0 flex-col rounded-lg border border-border px-3.5 py-3"
                  key={contract.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="text-left text-lg font-semibold text-blue-700 hover:underline dark:text-blue-300"
                      onClick={() => onOpen(contract.id)}
                    >
                      {unit?.unit_no ?? "—"}
                    </button>
                    <Badge variant={contractStatusVariant[contract.status]}>
                      {
                        dictionaries[locale].sales.contractStatus[
                          contract.status as keyof typeof dictionaries.zh.sales.contractStatus
                        ]
                      }
                    </Badge>
                  </div>
                  <p className="mt-2 break-words text-sm font-medium">
                    {customer?.name ?? text("客户待核", "Client à vérifier")}
                  </p>
                  <p className="mt-1 break-all text-[11px] text-muted-foreground">
                    {contract.contract_no}
                  </p>
                  <p className="mt-3 text-xs tabular-nums">
                    {text("合同价", "Prix")}:{" "}
                    {price === null ? text("金额待核实", "Montant à vérifier") : money(price)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {text("应收未收", "Créances restantes")}:{" "}
                    {summary?.count
                      ? money(summary.outstanding)
                      : text("暂无已核应收", "Aucune créance vérifiée")}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t pt-2">
                    {[
                      {
                        icon: Eye,
                        label: text("查看详情", "Voir le dossier"),
                        action: () => onOpen(contract.id),
                      },
                      {
                        icon: DollarSign,
                        label: text("查看财务", "Voir les finances"),
                        action: () => onOpen(contract.id, "finance"),
                      },
                      {
                        icon: FileText,
                        label: text("合同 / 打印", "Contrat / Imprimer"),
                        action: () => onPrint(contract),
                      },
                    ].map(({ icon: Icon, label, action }) => (
                      <Button
                        key={label}
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={action}
                        aria-label={`${label} · ${unit?.unit_no ?? contract.contract_no}`}
                        title={label}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </Button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
