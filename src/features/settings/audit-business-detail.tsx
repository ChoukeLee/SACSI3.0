import type { Locale } from "@/lib/i18n";
import type { AuditLogRow } from "./audit-log-enrichment";
import { auditBusinessSummary } from "./audit-business-summary";

export function AuditBusinessDetail({ log, locale }: { log: AuditLogRow; locale: Locale }) {
  const info = auditBusinessSummary(log, locale);
  const zh = locale === "zh";
  const collection = info.leaseCollection;
  const methods: Record<string, string> = zh
    ? { cash: "现金", check: "支票", bank_transfer: "银行转账", other: "其他" }
    : { cash: "Espèces", check: "Chèque", bank_transfer: "Virement bancaire", other: "Autre" };
  const fields = [
    [zh ? "操作账号（历史记录）" : "Compte opérateur enregistré", info.actor],
    [zh ? "身份记录状态" : "État de l’identité enregistrée", info.identityStatus],
    [zh ? "业务经办人" : "Responsable métier", info.agent],
    [zh ? "录入渠道（记录值）" : "Canal déclaré", info.channel],
    ...(!collection ? [[zh ? "输入来源" : "Source", info.source]] : []),
    [zh ? "本次收款" : "Ce paiement", info.paymentAmount],
    [zh ? "收款日期" : "Date du paiement", info.paymentDate],
    [
      collection ? (zh ? "系统收据号" : "Références internes") : zh ? "收据号" : "Numéro de reçu",
      info.receiptNo,
    ],
    ...(collection
      ? [
          [
            zh ? "实际收款人（记录值）" : "Encaisseur déclaré",
            collection.actualCollector ||
              (zh ? "未记录，不能推断" : "Non enregistré, sans déduction"),
          ],
          [zh ? "收款人依据（记录值）" : "Justificatif de l’encaisseur", collection.collectorBasis],
          [
            zh ? "收款方式（记录值）" : "Mode de paiement déclaré",
            methods[collection.paymentMethod] || collection.paymentMethod,
          ],
          [
            zh ? "外部凭证号（记录值）" : "Référence externe déclarée",
            collection.externalReceiptNo,
          ],
          [
            zh ? "缴费覆盖：实际变更前 → 后" : "Couverture : avant → après",
            `${collection.paidThroughBefore} → ${collection.paidThroughAfter}`,
          ],
          [zh ? "覆盖处理结果" : "Traitement de la couverture", collection.coverageStatus],
          [zh ? "系统收款编号" : "Identifiants des paiements", collection.paymentIds.join(" · ")],
          [zh ? "收款备注（记录值）" : "Note déclarée", collection.notes],
        ]
      : []),
    ...(!collection
      ? [
          [
            zh ? "累计已收：变更前 → 后" : "Total reçu : avant → après",
            info.beforePaid ? `${info.beforePaid} → ${info.afterPaid}` : "",
          ],
        ]
      : []),
    [zh ? "请求编号" : "Identifiant de requête", info.requestId],
    ...(!collection
      ? [
          [
            zh ? "截图行号 / 分项请求号" : "Ligne / sous-requête",
            info.lineId ? `${info.lineId} / ${info.childRequestId}` : "",
          ],
          [zh ? "本行凭证原文" : "Texte de la ligne", info.sourceText],
          [
            zh ? "连接器 / 协议版本" : "Version connecteur / protocole",
            `${info.connectorVersion || "—"} / ${info.protocolVersion || "—"}`,
          ],
        ]
      : []),
  ];
  return (
    <section
      aria-label={zh ? "业务操作详情" : "Détail métier"}
      className="mb-4 rounded-lg border bg-card p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">
        {info.summary || (zh ? "业务操作详情" : "Détail métier")}
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      {collection && (
        <section
          className="mt-5 border-t pt-4"
          aria-label={zh ? "明确核销明细" : "Affectations explicites"}
        >
          <h3 className="text-sm font-medium">{zh ? "明确核销明细" : "Affectations explicites"}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {zh
              ? "金额、币种与收款编号取自本次操作的已保存结果；账单名称与账期来自当时的应收快照。缺失信息不以当前账单或到期日补全。"
              : "Montants, devises et identifiants proviennent du résultat enregistré. Libellés et périodes proviennent de l’état historique, sans déduction à partir des données actuelles."}
          </p>
          {collection.allocations.length > 0 ? (
            <ol className="mt-3 space-y-2">
              {collection.allocations.map((row, index) => (
                <li
                  key={`${row.receivableId}-${index}`}
                  className="min-w-0 rounded-md border p-3 text-xs [overflow-wrap:anywhere]"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      {row.title || (zh ? "账单名称未记录" : "Libellé non enregistré")}
                    </span>
                    <span className="font-medium tabular-nums">{row.amount}</span>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    {zh ? "服务期" : "Période"}：
                    {row.servicePeriodStart || (zh ? "起日未记录" : "Début non enregistré")} →{" "}
                    {row.servicePeriodEnd || (zh ? "止日未记录" : "Fin non enregistrée")}
                  </p>
                  <dl className="mt-2 grid gap-1 text-muted-foreground">
                    <div>
                      <dt className="inline">{zh ? "应收编号" : "Créance"}：</dt>
                      <dd className="inline">{row.receivableId || "—"}</dd>
                    </div>
                    <div>
                      <dt className="inline">{zh ? "收款编号" : "Paiement"}：</dt>
                      <dd className="inline">{row.paymentId || "—"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {zh
                ? "未记录可验证的核销结果。"
                : "Aucun résultat d’affectation vérifiable enregistré."}
            </p>
          )}
        </section>
      )}
      {(!collection || info.instruction) && (
        <div className="mt-4 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {zh ? "原始指令 / 识别文字（历史记录）" : "Instruction / texte reconnu (historique)"}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
            {info.instruction || (zh ? "未记录" : "Non enregistré")}
          </p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {zh
          ? "登录账号、业务经办人和实际收款人不是同一概念；多人共用同一账号时，系统只能证明该登录账号执行了操作，不能证明当时坐在电脑前的人。未记录实际收款人时不能推断。此处展示历史审计，不代表人工复核或当前账务复查已通过。"
          : "Le compte de saisie, le responsable et l’encaisseur sont distincts. Cet historique ne constitue pas une validation humaine ni un contrôle du solde actuel."}
      </p>
    </section>
  );
}
