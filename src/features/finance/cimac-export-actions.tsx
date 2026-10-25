import { CIMAC_PROJECT_ID, type CimacExportQuery } from "./cimac-export-model";
import type { FinanceFilters, FinanceKind } from "./finance-read";
import { cimacShopPropertyFeeNotice } from "./cimac-property-fee-policy";

/** Server-rendered links only; the endpoint independently enforces authorization. */
export function CimacExportActions({
  kind,
  filters,
  locale,
  workArea = "sacsi",
}: {
  kind: FinanceKind;
  filters: FinanceFilters;
  locale: "zh" | "fr";
  workArea?: "sacsi" | "cimac";
}) {
  if (filters.projectId !== CIMAC_PROJECT_ID) return null;
  const zh = locale === "zh";
  const isReceivable = kind === "receivables";
  const unsupported = Object.entries(filters).some(
    ([key, value]) => value && !["projectId", "dateFrom", "dateTo"].includes(key),
  );
  const href = (view: CimacExportQuery["view"]) => {
    const params = new URLSearchParams({ view, locale });
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    return `/api/finance/cimac-export?${params}`;
  };
  const resetParams = new URLSearchParams({ projectId: CIMAC_PROJECT_ID, kind });
  if (filters.dateFrom) resetParams.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) resetParams.set("dateTo", filters.dateTo);
  const resetHref = `${zh ? "" : "/fr"}${workArea === "cimac" ? "/cimac" : ""}/finance?${resetParams}`;
  const linkClass = "rounded-md border bg-background p-2 text-sm";
  return (
    <section
      aria-label={zh ? "CIMAC专项导出" : "Exports détaillés CIMAC"}
      className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"
    >
      <h2 className="text-sm font-semibold">
        {zh ? "CIMAC专项导出 · Excel可打开CSV" : "Exports CIMAC · CSV ouvrable dans Excel"}
      </h2>
      <p className="rounded-md border border-border bg-background p-3 text-sm">
        {cimacShopPropertyFeeNotice(locale)}
      </p>
      <p className="text-sm text-muted-foreground">
        {isReceivable
          ? zh
            ? "按到期日筛选当前登记的物业费应收，包含全部管理状态及取消记录，不是历史余额。已核销金额不等于原币实收；收费账期仅按明确登记展示，缺项保持待核对。"
            : "Charges enregistrées actuellement, filtrées par date d’échéance, tous états de gestion et annulations inclus ; ce n’est pas un solde historique. Les montants imputés ne sont pas les encaissements en devise. Les périodes manquantes restent à vérifier."
          : zh
            ? "按分录登记日期导出全部匹配记录，不限当前页。关联原币凭证仅包含这些分录对应的正式收款；未入账原币登记不在此表，不代表未收款。"
            : "Toutes les écritures correspondant aux dates d’écriture, sans limite à la page. Les paiements en devise originale sont ceux liés à ces écritures ; les encaissements en attente de comptabilisation n’y figurent pas, ce qui ne signifie pas un impayé."}
      </p>
      {unsupported ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">
            {zh
              ? "专项导出仅支持项目及日期。请先清除楼栋、搜索、方向、类别、管理范围等其他筛选；如需保留这些条件，请使用上方“导出完整筛选结果”。"
              : "Ces exports utilisent uniquement le projet et les dates. Retirez les autres filtres (bâtiment, recherche, sens, catégorie, gestion) ou utilisez « Exporter les résultats » ci-dessus pour les conserver."}
          </p>
          <a href={resetHref} className="underline underline-offset-4">
            {zh ? "仅保留项目及日期，重新查看专项导出" : "Ne conserver que le projet et les dates"}
          </a>
        </div>
      ) : isReceivable ? (
        <a href={href("property-fee-receivables")} className={`${linkClass} inline-block`}>
          {zh ? "物业费应收登记（全管理状态CSV）" : "Créances de charges, tous états (CSV)"}
        </a>
      ) : (
        <div className="flex flex-wrap gap-3">
          <a href={href("ledger")} className={linkClass}>
            {zh ? "导出分录明细（CSV）" : "Exporter les écritures (CSV)"}
          </a>
          <a href={href("payments")} className={linkClass}>
            {zh ? "导出关联原币凭证（CSV）" : "Exporter les paiements liés en devise (CSV)"}
          </a>
          <a href={href("deposits")} className={linkClass}>
            {zh ? "押金收退扣明细（CSV）" : "Dépôts, remboursements et retenues (CSV)"}
          </a>
          <a href={href("refunds")} className={linkClass}>
            {zh ? "押金退款记录（CSV）" : "Remboursements de dépôt (CSV)"}
          </a>
          <a href={href("property-fee-payments")} className={linkClass}>
            {zh ? "物业费收款记录（CSV）" : "Paiements de charges (CSV)"}
          </a>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {isReceivable
          ? zh
            ? "无正式登记不代表免缴或未缴。本专项与下方默认的系统管理范围可能不同，不应把取消、历史待核或排除记录计作当前欠款。不按旧备注自动生成年费、收费账期或核销关系。"
            : "L’absence d’enregistrement ne prouve ni exonération ni impayé. Le périmètre peut différer de la liste gérée ci-dessous ; les annulations, historiques à vérifier et exclusions ne sont pas des dettes courantes. Aucun calcul de charges, de période ou d’imputation à partir d’anciennes notes."
          : zh
            ? "押金收退扣明细与退款子表有重叠，请勿相加；扣除不等于现金退款，日期范围内的流水不等于当前押金余额。物业费应收请切换上方“应收账”；未自动关联收款与应收。"
            : "Le tableau des dépôts inclut les remboursements : ne pas additionner les deux exports. Une retenue n’est pas un remboursement en espèces ; les flux de la période ne sont pas le solde du dépôt. Les créances de charges sont dans la vue Créances, sans rapprochement automatique des paiements."}
      </p>
    </section>
  );
}
