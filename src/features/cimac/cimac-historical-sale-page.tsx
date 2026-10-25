import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/currency";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { getCimacWorkspaceContext, type CimacDetailPageProps } from "./cimac-workspace-pages";
import { CimacWorkspaceReadError } from "./cimac-workspace-types";
import { readCimacHistoricalSale } from "./cimac-historical-sale-read";
import { CimacPageHeading, CimacPanel } from "./cimac-view-parts";
import styles from "./cimac-workspace.module.css";

export async function CimacHistoricalSalePage({
  params,
  searchParams,
  locale,
}: CimacDetailPageProps & { locale: "zh" | "fr" }) {
  const { client, scope } = await getCimacWorkspaceContext();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const t = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  let data: Awaited<ReturnType<typeof readCimacHistoricalSale>>;
  try {
    data = await readCimacHistoricalSale(client, scope, id);
  } catch (error) {
    if (error instanceof CimacWorkspaceReadError && [400, 403, 404].includes(error.status))
      notFound();
    throw error;
  }
  const base = `${locale === "fr" ? "/fr" : ""}/cimac`;
  const money = (amount: unknown, currency = "XOF") =>
    amount === null || amount === undefined || !Number.isFinite(Number(amount))
      ? t("待核", "À vérifier")
      : `${formatMoney(Number(amount), currency, locale)}${currency === "XOF" ? "" : ` ${currency}`}`;
  const { contract, unit, customer } = data;
  return (
    <div className={styles.view}>
      <CimacPageHeading
        overline="CIMAC · HISTORICAL CONTRACT"
        title={contract.contract_no || t("历史出售合同", "Ancien contrat de vente")}
        subtitle={t(
          "历史档案只读保留，不开放新的出售业务；原币分别展示，不自动折算。",
          "Archives en lecture seule, sans nouvelle vente ni conversion automatique des devises.",
        )}
        actions={
          <Link
            className={styles.button}
            href={safeWorkbenchReturnTo(query.returnTo) ?? `${base}/contracts`}
          >
            {t("返回", "Retour")}
          </Link>
        }
      />
      <CimacPanel title={t("合同档案", "Dossier du contrat")}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt>{t("客户", "Client")}</dt>
            <dd>
              <Link className={styles.link} href={`${base}/customers/${customer.id}`}>
                {customer.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt>{t("资产", "Bien")}</dt>
            <dd>
              <Link className={styles.link} href={`${base}/assets/${unit.id}`}>
                {unit.unit_no || unit.code}
              </Link>
            </dd>
          </div>
          <div>
            <dt>{t("合同状态", "Statut")}</dt>
            <dd>
              {contract.status} · {contract.transfer_status}
            </dd>
          </div>
          <div>
            <dt>{t("签约日期", "Signature")}</dt>
            <dd>{contract.signed_date || t("待核", "À vérifier")}</dd>
          </div>
          <div>
            <dt>{t("原合同总价", "Montant contractuel")}</dt>
            <dd>
              {contract.total_amount_confirmed
                ? money(contract.total_amount_xof)
                : t("待核", "À vérifier")}
            </dd>
          </div>
          <div>
            <dt>{t("付款方式", "Échéancier")}</dt>
            <dd>{contract.payment_plan_type}</dd>
          </div>
          <div>
            <dt>{t("产权证号", "Titre foncier")}</dt>
            <dd>{contract.title_certificate_no || "—"}</dd>
          </div>
          <div>
            <dt>{t("移交日期", "Transfert")}</dt>
            <dd>{contract.transfer_date || "—"}</dd>
          </div>
        </dl>
      </CimacPanel>
      <div className="mt-5 grid gap-5">
        <CimacPanel title={t("付款期次", "Échéances du contrat")}>
          <RecordTable
            headers={[
              t("期次", "N°"),
              t("到期日", "Échéance"),
              t("原定金额", "Montant prévu"),
              t("状态", "Statut"),
            ]}
            rows={data.schedules.map((row) => [
              String(row.installment_no),
              row.due_date,
              money(row.amount_xof),
              row.status,
            ])}
            empty={t("未登记付款期次", "Aucune échéance enregistrée")}
          />
        </CimacPanel>
        <CimacPanel title={t("历史应收", "Créances historiques")}>
          <RecordTable
            headers={[
              t("账单", "Créance"),
              t("到期日", "Échéance"),
              t("原币应收", "Montant d’origine"),
              t("已核销", "Affecté"),
              t("状态", "Statut"),
            ]}
            rows={data.receivables.map((row) => [
              row.title || row.category,
              row.due_date,
              money(row.currency === "XOF" ? row.amount_xof : row.amount_native, row.currency),
              money(
                row.currency === "XOF" ? row.paid_amount_xof : row.paid_amount_native,
                row.currency,
              ),
              `${row.status} · ${row.management_status ?? "managed"}`,
            ])}
            empty={t(
              "未登记应收；不代表没有合同义务",
              "Aucune créance enregistrée ; les obligations ne sont pas présumées nulles",
            )}
          />
        </CimacPanel>
        <CimacPanel title={t("历史收款与校正记录", "Encaissements et corrections historiques")}>
          <RecordTable
            headers={[
              t("日期", "Date"),
              t("收据", "Reçu"),
              t("类别", "Catégorie"),
              t("原币金额", "Montant d’origine"),
              t("收款人 / 记录人", "Collecteur / Auteur"),
            ]}
            rows={data.payments.map((row) => [
              row.payment_date,
              row.receipt_no || row.id,
              row.reversal_of_payment_id
                ? `${row.source_type} · ${t("关联冲正", "Contrepassation liée")} ${row.reversal_of_payment_id}`
                : row.source_type,
              money(row.amount, row.currency),
              `${row.actual_collector || "—"} / ${row.recorded_by || "—"}`,
            ])}
            empty={t("未登记收款记录", "Aucun encaissement enregistré")}
          />
        </CimacPanel>
      </div>
    </div>
  );
}

function RecordTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  if (!rows.length) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="whitespace-nowrap border-b px-3 py-2 font-medium"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} className="border-b px-3 py-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
