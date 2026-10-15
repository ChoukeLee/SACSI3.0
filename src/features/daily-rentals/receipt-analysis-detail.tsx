"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { auditActionLabel } from "@/lib/audit-labels";
import type { ReceiptDetailData, ReceiptLine } from "./receipt-analysis-types";
import {
  number,
  formatDate,
  kindLabel,
  methodLabel,
  exclusionLabel,
  type Locale,
} from "./receipt-analysis-format";
import styles from "./receipt-analysis.module.css";

function safeAttachmentUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function receiptAuditLabel(action: string, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    daily_payment: ["日租收款", "Encaissement court séjour"],
    daily_supplementary_payment: ["日租补收", "Encaissement complémentaire"],
    daily_refund: ["实际退款", "Remboursement réel"],
    daily_partial_refund: ["部分退款", "Remboursement partiel"],
    daily_reversal: ["错误收款冲正", "Contrepassation"],
  };
  if (labels[action]) return labels[action][locale === "zh" ? 0 : 1];
  const label = auditActionLabel(action, locale);
  return label === "其他操作" ? action : label;
}

export function ReceiptAnalysisDetail({
  row,
  locale,
  onClose,
  trigger,
}: {
  row: ReceiptLine | null;
  locale: Locale;
  onClose: () => void;
  trigger: HTMLElement | null;
}) {
  const fr = locale === "fr";
  const text = (zh: string, french: string) => (fr ? french : zh);
  const [drilldown, setDrilldown] = useState<ReceiptDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const rowId = row?.id;
  useEffect(() => {
    setDrilldown(null);
    setDetailError(false);
    if (!rowId) return;
    const controller = new AbortController();
    setDetailLoading(true);
    const read = async () => {
      try {
        const response = await fetch(`/api/daily-rentals/receipts/${encodeURIComponent(rowId)}`, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body.attachments) || !Array.isArray(body.audit))
          throw new Error("detailUnavailable");
        setDrilldown(body as ReceiptDetailData);
      } catch {
        if (!controller.signal.aborted) setDetailError(true);
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    };
    void read();
    return () => controller.abort();
  }, [rowId, detailRetry]);
  if (!row) return null;
  const fields = [
    [text("收款记录日期", "Date comptable"), formatDate(row.date)],
    [text("房号", "Logement"), row.room ?? "—"],
    [text("楼栋", "Bâtiment"), row.buildingName ?? "—"],
    [text("住客", "Client hébergé"), row.guestName ?? "—"],
    [text("类型", "Type"), kindLabel(row.kind, fr)],
    [text("收款方式", "Mode"), methodLabel(row.paymentMethod, fr)],
    [text("收据号", "N° de reçu"), row.receiptNo ?? "—"],
    [
      text("订单经办人", "Responsable de réservation"),
      row.bookingAgentName ?? text("未记录", "Non renseigné"),
    ],
    [
      text("原始金额", "Montant d’origine"),
      `${number(row.amount, locale)} ${row.currency || text("币种未记录", "devise non renseignée")}`,
    ],
    [text("订单 ID", "ID de réservation"), row.bookingId ?? "—"],
    [text("记录 ID", "ID d’écriture"), row.id],
    [text("冲正原记录", "Écriture contrepassée"), row.reversalOf ?? "—"],
    [
      text("创建时间", "Créée le"),
      row.createdAt
        ? new Intl.DateTimeFormat(fr ? "fr-FR" : "zh-CN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Africa/Abidjan",
          }).format(new Date(row.createdAt))
        : "—",
    ],
    [text("备注", "Notes"), row.notes ?? "—"],
  ];
  return (
    <Dialog.Root
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.detail}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger?.focus();
          }}
        >
          <Dialog.Title className={styles.detailTitle}>
            {text("收款记录详情", "Détail de l’écriture")}
          </Dialog.Title>
          <Dialog.Description className={styles.detailDescription}>
            {text("原始账务记录 · 仅查询，不在此修改", "Écriture d’origine · consultation seule")}
          </Dialog.Description>
          <Dialog.Close className={styles.close} aria-label={text("关闭详情", "Fermer le détail")}>
            <X size={19} />
          </Dialog.Close>
          <div className={styles.detailAmount}>
            {number(row.amountXof ?? row.amount, locale)}{" "}
            <small>{row.amountXof === null ? row.currency : "XOF"}</small>
          </div>
          {row.kind === "excluded" && (
            <p className={styles.warning}>
              {text("未纳入 XOF 净收款：", "Hors calcul du net XOF : ")}
              {exclusionLabel(row.exclusionReason, fr)}
            </p>
          )}
          <dl className={styles.detailList}>
            {fields.map(([label, value]) => (
              <div style={{ display: "contents" }} key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.detailNote}>
            {text(
              "订单经办人不等同于实际收款人或本笔录入人。具体操作人请以审计日志中的登录账号为准。",
              "Le responsable de réservation n’est pas nécessairement l’encaisseur ni l’auteur de l’écriture. Consultez le compte authentifié dans le journal d’audit.",
            )}
          </p>
          {detailLoading ? (
            <p className={styles.metricNote} role="status">
              {text(
                "正在读取关联订单、凭证与审计记录…",
                "Chargement de la réservation, des justificatifs et du journal…",
              )}
            </p>
          ) : detailError ? (
            <div className={styles.warning} role="alert">
              <span>
                {text(
                  "关联详情暂时无法读取，不代表没有凭证或审计记录。",
                  "Les détails liés sont indisponibles ; cela ne signifie pas qu’ils sont absents.",
                )}{" "}
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setDetailRetry((value) => value + 1)}
                >
                  {text("重试详情", "Réessayer")}
                </button>
              </span>
            </div>
          ) : (
            drilldown && (
              <>
                <section className={styles.detailSection}>
                  <h3>{text("关联住宿", "Séjour lié")}</h3>
                  {drilldown.booking ? (
                    <>
                      <p>
                        {formatDate(drilldown.booking.checkIn)} –{" "}
                        {formatDate(drilldown.booking.checkOut)}
                      </p>
                      <p className={styles.metricNote}>
                        {text("订单状态", "État de réservation")} ·{" "}
                        {(
                          {
                            confirmed: text("已预订", "Confirmée"),
                            checked_in: text("已入住", "En cours"),
                            checked_out: text("已退房", "Terminée"),
                            cancelled: text("已取消", "Annulée"),
                            pending_review: text("待审核", "À vérifier"),
                          } as Record<string, string>
                        )[drilldown.booking.status] ?? drilldown.booking.status}
                      </p>
                    </>
                  ) : (
                    <p className={styles.metricNote}>
                      {text("无可读取的关联订单。", "Aucune réservation liée accessible.")}
                    </p>
                  )}
                </section>
                <section className={styles.detailSection}>
                  <h3>{text("原始凭证", "Justificatifs d’origine")}</h3>
                  {drilldown.attachmentsUnavailable && (
                    <p className={styles.warning}>
                      {text(
                        "凭证读取失败，不能据此判断凭证缺失。",
                        "Lecture des justificatifs impossible ; leur absence n’est pas établie.",
                      )}
                    </p>
                  )}
                  {drilldown.attachments.length === 0 && !drilldown.attachmentsUnavailable ? (
                    <p className={styles.metricNote}>
                      {text(
                        "本笔尚无可读取的归档凭证。收据编号不代表原件已归档，群聊或 Excel 图片不会自动出现在这里。",
                        "Aucun justificatif archivé accessible. Un numéro de reçu ne garantit pas un original archivé ; les images externes ne sont pas importées automatiquement.",
                      )}
                    </p>
                  ) : drilldown.attachments.length > 0 ? (
                    <ul className={styles.detailLinks}>
                      {drilldown.attachments.map((attachment, index) => {
                        const href = safeAttachmentUrl(attachment.url);
                        return (
                          <li key={attachment.id}>
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                {text("查看凭证", "Ouvrir le justificatif")} {index + 1} ·{" "}
                                {attachment.fileType}
                              </a>
                            ) : (
                              <span>
                                {text("凭证", "Justificatif")} {index + 1} ·{" "}
                                {text("暂时无法打开", "indisponible")}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </section>
                <section className={styles.detailSection}>
                  <h3>
                    {text("操作记录（最近 20 条关联记录）", "Opérations liées (20 dernières)")}
                  </h3>
                  {!drilldown.auditAllowed ? (
                    <p className={styles.metricNote}>
                      {text(
                        "当前账号没有查看审计日志的权限。",
                        "Votre compte ne peut pas consulter le journal d’audit.",
                      )}
                    </p>
                  ) : drilldown.auditUnavailable ? (
                    <p className={styles.warning}>
                      {text(
                        "审计读取失败，不能据此判断没有操作记录。",
                        "Lecture du journal impossible ; son absence n’est pas établie.",
                      )}
                    </p>
                  ) : drilldown.audit.length === 0 ? (
                    <p className={styles.metricNote}>
                      {text(
                        "未找到可关联的审计记录，不推断实际操作人。",
                        "Aucune opération liée trouvée ; l’auteur n’est pas déduit.",
                      )}
                    </p>
                  ) : (
                    <ul className={styles.auditList}>
                      {drilldown.audit.map((entry) => (
                        <li key={entry.id}>
                          <span title={entry.action}>
                            {receiptAuditLabel(entry.action, locale)}
                          </span>
                          <strong>
                            {entry.actorId
                              ? entry.actorName || entry.actorId
                              : text("无登录账号记录", "Compte non enregistré")}
                          </strong>
                          <small>
                            {formatDate(entry.createdAt)} · {entry.createdAt.slice(11, 16)} UTC
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
