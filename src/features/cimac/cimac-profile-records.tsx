"use client";

import { ReceiptThumb } from "@/components/attachments/receipt-thumb";
import { ProfileAuditTimeline } from "@/features/profiles/audit-timeline";
import { HistoryPagination, useHistoryPage } from "@/features/profiles/history-pagination";
import type { CimacProfileRecords } from "./cimac-profile-service";
import { CimacPanel, type CimacViewLocale } from "./cimac-view-parts";
import styles from "./cimac-workspace.module.css";

export function CimacProfileRecordSections({
  data,
  locale,
  sharedIdentity = false,
}: {
  data: CimacProfileRecords;
  locale: CimacViewLocale;
  sharedIdentity?: boolean;
}) {
  const zh = locale === "zh";
  const page = useHistoryPage(data.attachments);
  return (
    <div className={styles.stack}>
      <CimacPanel
        title={zh ? "明确归属本园区的原始凭证" : "Justificatifs explicitement attribués au parc"}
      >
        <p className={styles.small}>
          {zh
            ? "只展示明确关联本园区资产的附件；未明确归属的共享客户文件不在此混入。账单与收款凭证仍在客户账务中保留。"
            : "Seules les pièces liées explicitement à un actif du parc sont présentées. Les pièces client non attribuées ne sont pas mélangées ; les justificatifs financiers restent dans le compte."}
        </p>
        {page.rows.length ? (
          page.rows.map((attachment) => (
            <div key={attachment.id} className={styles.sideItem}>
              <ReceiptThumb attachment={attachment} locale={locale} />
              <p className={styles.small}>
                {attachment.uploaded_at.slice(0, 10)} · {attachment.file_type}
              </p>
            </div>
          ))
        ) : (
          <p className={styles.empty}>
            {zh
              ? "暂无明确归属的可见附件；未删除或迁移原文件。"
              : "Aucune pièce attribuée visible ; aucun fichier supprimé ni déplacé."}
          </p>
        )}
        <HistoryPagination {...page.pagination} locale={locale} />
      </CimacPanel>
      <CimacPanel title={zh ? "资料操作记录" : "Historique de la fiche"}>
        <p className={styles.small}>
          {sharedIdentity
            ? zh
              ? "这些是共享客户身份的资料操作，不代表其他项目业务被归入建材城；合同、收费和资金历史在各自分区核对。"
              : "Ces événements concernent l’identité client partagée, sans attribuer les activités des autres projets au parc. Les historiques contractuels et financiers restent distincts."
            : zh
              ? "只展示本资产直接记录的操作；不从更新时间猜测操作人或变更内容。"
              : "Événements directement enregistrés pour cet actif, sans déduction de l’opérateur ni de la modification."}
        </p>
        <ProfileAuditTimeline logs={data.auditLogs} locale={locale} />
      </CimacPanel>
    </div>
  );
}
