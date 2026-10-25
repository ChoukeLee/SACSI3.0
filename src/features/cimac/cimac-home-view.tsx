import Link from "next/link";
import type { CimacAssetAttentionReason, CimacHomeData } from "./cimac-workspace-types";
import { cimacWorkspaceHref } from "./cimac-workspace-query";
import {
  CimacEmpty,
  CimacLink,
  CimacPageHeading,
  CimacPanel,
  CimacPill,
  cimacAssetKind,
  cimacConstruction,
  cimacOccupancy,
  cimacText,
  type CimacViewLocale,
} from "./cimac-view-parts";
import styles from "./cimac-workspace.module.css";

export function cimacAttentionLabel(reason: CimacAssetAttentionReason, locale: CimacViewLocale) {
  const labels: Record<CimacAssetAttentionReason, [string, string]> = {
    construction_unverified: ["建设状态待核", "État du bâti à vérifier"],
    construction_pending: ["建设准备待跟进", "Préparation du bâti à suivre"],
    occupancy_unverified: ["占用资料待核", "Occupation à vérifier"],
    maintenance: ["维修状态待跟进", "Maintenance à suivre"],
    locked: ["锁定状态待核", "Blocage à vérifier"],
  };
  return labels[reason][locale === "zh" ? 0 : 1];
}

export function CimacHomeView({ data, locale }: { data: CimacHomeData; locale: CimacViewLocale }) {
  const t = (zh: string, fr: string) => cimacText(locale, zh, fr);
  const home = cimacWorkspaceHref("home", locale);
  const assets = cimacWorkspaceHref("assets", locale);
  const changes = data.assetIndex
    .filter((asset) => asset.updatedAt)
    .toSorted((a, b) => b.updatedAt!.localeCompare(a.updatedAt!))
    .slice(0, 6);
  const groups = new Map<string, typeof data.assetIndex>();
  for (const asset of data.assetIndex) {
    const values = groups.get(asset.buildingId) ?? [];
    values.push(asset);
    groups.set(asset.buildingId, values);
  }
  return (
    <div className={styles.view}>
      <CimacPageHeading
        overline="OPERATIONS DESK"
        title={t("园区工作台", "Tableau de bord du parc")}
        subtitle={t(
          "建设、客户与园区运营，先看需要核对的事项，再进入具体业务。",
          "Construction, clients et exploitation : les points à vérifier avant les opérations détaillées.",
        )}
        actions={
          <CimacLink href={cimacWorkspaceHref("customers", locale)} button>
            {t("查看客户", "Voir les clients")}
          </CimacLink>
        }
      />
      <div className={styles.summary} aria-label={t("授权园区范围", "Périmètre autorisé du parc")}>
        <span>
          <strong>{data.assetSummary.total}</strong>
          {t("项已登记资产", "actifs enregistrés")}
        </span>
        <span>
          <strong>{data.customerCount}</strong>
          {t("位关联客户", "clients liés")}
        </span>
        <span>
          <strong>{data.attentionTotal}</strong>
          {t("项资产状态需核对", "actifs à vérifier")}
        </span>
        <span>{t("当前账号 · CIMAC 授权范围", "Compte actuel · périmètre CIMAC autorisé")}</span>
      </div>
      <div className={styles.homeGrid}>
        <CimacPanel
          title={t("当前需要核对", "Points à vérifier")}
          aside={
            <CimacLink href={cimacWorkspaceHref("assets", locale, { filter: "attention" })}>
              {t("查看全部", "Tout voir")}
            </CimacLink>
          }
        >
          {data.attention.length ? (
            <ul>
              {data.attention.map((asset) => (
                <li className={styles.task} key={asset.id}>
                  <span
                    className={`${styles.taskMark} ${asset.attentionReasons.some((reason) => reason === "maintenance" || reason === "locked") ? styles.urgent : styles.normal}`}
                    aria-hidden="true"
                  />
                  <div>
                    <p className={styles.taskTitle}>
                      {asset.buildingName} · {asset.unitNo}
                    </p>
                    <p className={styles.taskMeta}>
                      {asset.attentionReasons
                        .map((reason) => cimacAttentionLabel(reason, locale))
                        .join(" · ")}
                    </p>
                  </div>
                  <CimacLink
                    href={cimacWorkspaceHref("assets", locale, { returnTo: home }, asset.id)}
                  >
                    {t("查看", "Voir")}
                  </CimacLink>
                </li>
              ))}
            </ul>
          ) : (
            <CimacEmpty>
              {t(
                "当前读取范围未发现上述状态核对项，不代表已经完成交付或开业。",
                "Aucun de ces points relevé dans le périmètre lu ; cela ne prouve ni la livraison ni l’ouverture.",
              )}
            </CimacEmpty>
          )}
          <p className={styles.indexNote}>
            {t(
              "根据已登记状态列示；不是已分派工单，不推断负责人或处理期限。",
              "D’après les états enregistrés ; il ne s’agit pas de tâches affectées. Aucun responsable ni délai n’est déduit.",
            )}
          </p>
        </CimacPanel>
        <CimacPanel
          title={t("园区资产索引", "Index des actifs du parc")}
          aside={<CimacLink href={assets}>{t("资产目录", "Répertoire")}</CimacLink>}
        >
          {groups.size ? (
            [...groups].map(([buildingId, rows]) => (
              <div className={styles.zone} key={buildingId}>
                <div className={styles.zoneHeading}>
                  <span>{rows[0].buildingName}</span>
                  <CimacLink href={cimacWorkspaceHref("assets", locale, { building: buildingId })}>
                    {t("本栋", "Bâtiment")}
                  </CimacLink>
                </div>
                <div className={styles.assetIndex}>
                  {rows.map((asset) => (
                    <Link
                      prefetch={false}
                      className={styles.assetTile}
                      href={cimacWorkspaceHref("assets", locale, { returnTo: home }, asset.id)}
                      key={asset.id}
                    >
                      <strong>
                        {asset.buildingName} · {asset.unitNo}
                      </strong>
                      <span>
                        {cimacAssetKind(asset.kind, locale)} · {cimacOccupancy(asset, locale)}
                      </span>
                      <span>{cimacConstruction(asset.constructionStatus, locale)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <CimacEmpty>
              {t(
                "当前授权范围没有已登记的资产索引。",
                "Aucun actif enregistré dans cet index autorisé.",
              )}
            </CimacEmpty>
          )}
          <p className={styles.indexNote}>
            {t(
              `索引展示 ${data.assetIndex.length} 项；完整库存请进入资产目录。`,
              `${data.assetIndex.length} actifs dans cet index ; consultez le répertoire pour l’inventaire complet.`,
            )}
          </p>
        </CimacPanel>
      </div>
      <CimacPanel
        className={styles.sectionGap}
        title={t("最近资产档案更新", "Dernières mises à jour des actifs")}
        aside={<CimacPill>{t("记录保存时间", "Date d’enregistrement")}</CimacPill>}
      >
        {changes.length ? (
          <ul>
            {changes.map((asset) => (
              <li className={styles.activityRow} key={asset.id}>
                <time className={styles.activityTime} dateTime={asset.updatedAt!}>
                  {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
                    timeZone: "Africa/Abidjan",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }).format(new Date(asset.updatedAt!))}
                </time>
                <div>
                  <CimacLink
                    href={cimacWorkspaceHref("assets", locale, { returnTo: home }, asset.id)}
                  >
                    {asset.buildingName} · {asset.unitNo}
                  </CimacLink>
                  <p className={styles.small}>
                    {t(
                      "档案有更新，具体变更需核对原记录。",
                      "Fiche mise à jour ; vérifiez le détail dans le dossier.",
                    )}
                  </p>
                </div>
                <CimacPill>{cimacAssetKind(asset.kind, locale)}</CimacPill>
              </li>
            ))}
          </ul>
        ) : (
          <CimacEmpty>
            {t(
              "没有可展示的档案更新时间；不以示例动态补充。",
              "Aucune date de mise à jour disponible ; aucun événement de démonstration n’est substitué.",
            )}
          </CimacEmpty>
        )}
        <p className={styles.indexNote}>
          {t(
            "仅来自当前资产索引，不是完整操作审计；更新时间不表示已交付、已开业或由某人完成。",
            "Issu de cet index uniquement, pas d’un audit complet. Une mise à jour ne prouve ni livraison, ni ouverture, ni l’identité d’un opérateur.",
          )}
        </p>
      </CimacPanel>
      <p className={styles.endnote}>
        {t(
          "交付、开业、通用工单尚无独立数据，不从合同或建设状态推断。财务沿用原币、原单与审计。",
          "Livraison, ouverture et tâches générales n’ont pas encore de données distinctes. Aucune déduction depuis les baux ou le bâti ; les finances conservent devises, reçus et audit.",
        )}
      </p>
    </div>
  );
}
