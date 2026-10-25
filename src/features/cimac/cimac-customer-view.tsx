import type { ReactNode } from "react";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import type { CustomerRelation } from "@/features/customers/customer-directory-model";
import type { CimacCustomerData } from "./cimac-workspace-types";
import { cimacWorkspaceHref } from "./cimac-workspace-query";
import {
  CimacAssetIcon,
  CimacBackLink,
  CimacEmpty,
  CimacFacts,
  CimacLink,
  CimacPageHeading,
  CimacPagination,
  CimacPanel,
  CimacPendingOperations,
  CimacPill,
  CimacTabs,
  cimacContractStatus,
  cimacDate,
  cimacText,
  type CimacViewLocale,
} from "./cimac-view-parts";
import styles from "./cimac-workspace.module.css";
import { CimacCustomerProfileOperation } from "./cimac-profile-operations";
import { CimacCustomerManagement } from "./cimac-customer-management";

export interface CimacCustomerViewProps {
  data: CimacCustomerData;
  locale: CimacViewLocale;
  accountSection?: ReactNode;
  recordSection?: ReactNode;
  canEdit?: boolean;
  canReadAccount?: boolean;
  canManage?: boolean;
}

export function CimacCustomerView({
  data,
  locale,
  accountSection,
  recordSection,
  canEdit = false,
  canReadAccount = true,
  canManage = false,
}: CimacCustomerViewProps) {
  const t = (zh: string, fr: string) => cimacText(locale, zh, fr);
  const { profile, summary, query } = data;
  const current = cimacWorkspaceHref("customers", locale, query, profile.id);
  const directory = cimacWorkspaceHref("customers", locale, {
    ...query,
    tab: "overview",
    relationPage: 1,
    returnTo: null,
  });
  const href = (tab: typeof query.tab, relationPage = query.relationPage) =>
    cimacWorkspaceHref("customers", locale, { ...query, tab, relationPage }, profile.id);
  const tabs = [
    { key: "overview", label: t("业务总览", "Vue d’ensemble"), href: href("overview") },
    { key: "contracts", label: t("合同与交付", "Contrats et livraison"), href: href("contracts") },
    ...(canReadAccount
      ? [{ key: "account", label: t("账务与收费", "Comptes et charges"), href: href("account") }]
      : []),
    { key: "records", label: t("事项与资料", "Suivi et documents"), href: href("records") },
  ];
  const byUnit = new Map<string, CustomerRelation[]>();
  for (const relation of data.relations) {
    const rows = byUnit.get(relation.unitId) ?? [];
    rows.push(relation);
    byUnit.set(relation.unitId, rows);
  }
  const relationsLabel = t(
    `本页 ${data.relations.length} 条 / 共 ${data.relationTotal} 条业务关联`,
    `${data.relations.length} relations sur cette page / ${data.relationTotal} au total`,
  );
  const assetLink = (relation: CustomerRelation) =>
    cimacWorkspaceHref("assets", locale, { returnTo: current }, relation.unitId);
  return (
    <div className={styles.view}>
      <nav className={styles.breadcrumb} aria-label={t("客户位置", "Fil d’Ariane client")}>
        <CimacLink href={cimacWorkspaceHref("home", locale)}>{t("工作首页", "Accueil")}</CimacLink>
        <span>/</span>
        <CimacLink href={directory}>{t("招商与客户", "Relations clients")}</CimacLink>
        <span>/</span>
        <span>{t("客户详情", "Fiche client")}</span>
      </nav>
      <CimacPageHeading
        overline="CUSTOMER / CIMAC"
        title={profile.name}
        avatar={Array.from(profile.name.trim())[0] || "C"}
        subtitle={t(
          "按登记业务关联查看，不从租赁关系推断产权归属。",
          "Relations issues des dossiers enregistrés, sans déduire la propriété des locations.",
        )}
        actions={
          <>
            <CimacBackLink href={query.returnTo ?? directory} locale={locale} />
            {canEdit ? <CimacCustomerProfileOperation profile={profile} locale={locale} /> : null}
          </>
        }
      >
        <div className={styles.tags}>
          {profile.membershipStatus === "archived" ? (
            <CimacPill tone="amber">
              {t("园区已归档 · 保留历史", "Archivé dans le parc · historique conservé")}
            </CimacPill>
          ) : null}
          <CimacPill tone="blue">
            {t(`${summary.roomCount} 处关联资产`, `${summary.roomCount} actifs liés`)}
          </CimacPill>
          <CimacPill>
            {t(
              `${summary.relationshipCount} 条业务关联`,
              `${summary.relationshipCount} relations métier`,
            )}
          </CimacPill>
          {summary.isBlacklisted ? (
            <CimacPill tone="amber">
              {t("黑名单标记 · 需核对", "Liste noire enregistrée · à vérifier")}
            </CimacPill>
          ) : null}
        </div>
      </CimacPageHeading>
      <CimacTabs
        label={t("客户详情分区", "Sections de la fiche client")}
        items={tabs}
        active={query.tab}
      />
      {canManage ? (
        <CimacPanel title={t("园区名册维护", "Gestion du répertoire du parc")}>
          <CimacCustomerManagement profile={profile} relations={data.relations} locale={locale} />
        </CimacPanel>
      ) : null}
      <section
        aria-label={
          tabs.find((tab) => tab.key === query.tab)?.label ?? t("客户详情", "Fiche client")
        }
      >
        {query.tab === "overview" ? (
          <>
            <div className={styles.detailGrid}>
              <CimacPanel
                title={t("关联业务资产", "Actifs liés aux dossiers")}
                aside={<span className={styles.small}>{relationsLabel}</span>}
              >
                {byUnit.size ? (
                  [...byUnit].map(([unitId, relations]) => (
                    <div className={styles.property} key={unitId}>
                      <CimacAssetIcon kind="unknown" />
                      <div>
                        <h3>{relations[0].buildingLabel}</h3>
                        <div className={styles.propertyIds}>
                          <CimacLink href={assetLink(relations[0])}>
                            {relations[0].buildingLabel} · {relations[0].unitNo}
                          </CimacLink>
                        </div>
                        <p className={styles.propertySub}>
                          {relations
                            .map(
                              (relation) =>
                                [
                                  relation.brand,
                                  relation.role === "park_link" ? null : relation.code,
                                  relation.signingState === "signed_effective"
                                    ? t("已生效合同资料", "Dossier confirmé")
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || t("铺位资料关联", "Lien documentaire du lot"),
                            )
                            .join(" · ")}
                        </p>
                      </div>
                      <CimacPill>{t("登记关联，非产权", "Relation, pas une propriété")}</CimacPill>
                    </div>
                  ))
                ) : (
                  <CimacEmpty>
                    {t(
                      "本页没有可展示的业务关联，不推断客户没有其他线下业务。",
                      "Aucune relation affichée sur cette page ; aucune absence d’activité hors système n’est déduite.",
                    )}
                  </CimacEmpty>
                )}
                <CimacLink href={href("contracts")}>
                  {t("查看合同与全部关联", "Voir les contrats et relations")}
                </CimacLink>
              </CimacPanel>
              <CimacPanel title={t("当前跟进范围", "Périmètre du suivi")}>
                <CimacPendingOperations locale={locale} />
                <div className={styles.sideItem}>
                  <h3>{t("收费依据独立核对", "Tarification à vérifier séparément")}</h3>
                  <p>
                    {t(
                      "费率参考、实际起算和账单分别核对；客户或资产状态不会自动生成应收。",
                      "Tarifs de référence, prise d’effet et créances se vérifient séparément. Un état client ou actif ne crée aucune créance.",
                    )}
                  </p>
                  {canReadAccount ? (
                    <CimacLink href={href("account")}>
                      {t("查看客户账务", "Voir le compte client")}
                    </CimacLink>
                  ) : null}
                </div>
              </CimacPanel>
            </div>
            <CimacPanel className={styles.sectionGap} title={t("客户资料", "Fiche client")}>
              <CimacFacts
                locale={locale}
                rows={[
                  { label: t("登记名称", "Nom enregistré"), value: profile.name },
                  { label: t("联系电话", "Téléphone"), value: profile.phone },
                  {
                    label: t("业务关系", "Relation métier"),
                    value: summary.roles.includes("lease")
                      ? t(
                          "租赁业务关联 · 非产权依据",
                          "Relation locative · pas une preuve de propriété",
                        )
                      : t("按原业务记录核对", "À vérifier dans les dossiers d’origine"),
                  },
                  {
                    label: t("证件资料", "Pièce d’identité"),
                    value: profile.hasDocument
                      ? t(
                          "已登记证件，不展示敏感号码",
                          "Pièce enregistrée ; numéro sensible non affiché",
                        )
                      : t(
                          "未登记，不推断已完整建档",
                          "Non renseignée ; dossier complet non présumé",
                        ),
                  },
                ]}
              />
              {profile.is_blacklisted ? (
                <div className={styles.sideItem}>
                  <h3>{t("已登记黑名单依据", "Informations de liste noire enregistrées")}</h3>
                  <p>{profile.blacklist_reason || t("原因未登记", "Motif non renseigné")}</p>
                  <p>
                    {profile.blacklist_date || t("日期待核", "Date à vérifier")} ·{" "}
                    {profile.blacklist_permanent ? t("永久", "Permanent") : t("临时", "Temporaire")}
                  </p>
                </div>
              ) : null}
            </CimacPanel>
          </>
        ) : query.tab === "contracts" ? (
          <>
            <CimacPanel
              title={t("合同与资产关联", "Contrats et actifs liés")}
              aside={<span className={styles.small}>{relationsLabel}</span>}
            >
              {data.relations.length ? (
                data.relations.map((relation) => {
                  const contractHref =
                    relation.role === "lease"
                      ? buildWorkbenchRecordHref({
                          workspace: "leases",
                          workArea: "cimac",
                          id: relation.id,
                          project: data.scope.project.id,
                          building: relation.buildingId,
                          locale,
                          returnTo: current,
                        })
                      : null;
                  return (
                    <div className={styles.contract} key={`${relation.role}:${relation.id}`}>
                      <div>
                        <div className={styles.contractTitle}>
                          <h3>
                            {relation.role === "park_link"
                              ? relation.brand || t("铺位资料关联", "Lien documentaire du lot")
                              : relation.code || t("业务编号待核", "Référence à vérifier")}
                          </h3>
                          {relation.signingState === "signed_effective" ? (
                            <CimacPill tone="blue">
                              {t("已生效合同资料", "Dossier contractuel confirmé en vigueur")}
                            </CimacPill>
                          ) : null}
                          <CimacPill tone={relation.status === "active" ? "blue" : undefined}>
                            {cimacContractStatus(relation.status, locale)}
                          </CimacPill>
                        </div>
                        <p className={styles.propertySub}>
                          {relation.buildingLabel} · {relation.unitNo}
                          {relation.brand ? ` · ${relation.brand}` : ""}
                        </p>
                        {relation.sourceReference ? (
                          <details className={styles.propertySub}>
                            <summary>{t("合同资料来源", "Pièce source du contrat")}</summary>
                            <p style={{ overflowWrap: "anywhere" }}>{relation.sourceReference}</p>
                          </details>
                        ) : null}
                        {relation.relationshipKind ? (
                          <p className={styles.propertySub}>
                            {relation.relationshipKind === "reservation"
                              ? t("预留铺位资料", "Dossier de réservation du lot")
                              : t("签约资料关联", "Lien du dossier contractuel")}
                            {" · "}
                            {t("签署日期", "Date de signature")}{" "}
                            {cimacDate(relation.signedDate, locale)}
                          </p>
                        ) : null}
                        {relation.role !== "park_link" ? (
                          <p className={styles.propertySub}>
                            {t("登记起日", "Début enregistré")}{" "}
                            {cimacDate(relation.startDate, locale)} ·{" "}
                            {relation.endDateKind === "actual"
                              ? t("实际止日", "Fin réelle")
                              : t("预计止日（非交付日）", "Fin prévue (pas une livraison)")}{" "}
                            {cimacDate(relation.endDate, locale)}
                          </p>
                        ) : null}
                        <p className={styles.propertySub}>
                          {t(
                            "交付、开业与收费起算需另行核实。",
                            "Livraison, ouverture et début de facturation à vérifier séparément.",
                          )}
                        </p>
                      </div>
                      <div className={styles.stack}>
                        <CimacLink href={assetLink(relation)}>
                          {t("查看资产", "Voir l’actif")}
                        </CimacLink>
                        {contractHref ? (
                          <CimacLink href={contractHref}>
                            {t("办理合同", "Gérer le contrat")}
                          </CimacLink>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <CimacEmpty>
                  {t("当前页没有已关联的合同记录。", "Aucun contrat lié sur cette page.")}
                </CimacEmpty>
              )}
            </CimacPanel>
            <CimacPagination
              page={data.relationPage}
              pageSize={data.pageSize}
              total={data.relationTotal}
              locale={locale}
              label={t("客户业务关联分页", "Pagination des relations client")}
              previous={
                data.relationPage > 1 ? href("contracts", data.relationPage - 1) : undefined
              }
              next={
                data.relationPage * data.pageSize < data.relationTotal
                  ? href("contracts", data.relationPage + 1)
                  : undefined
              }
            />
          </>
        ) : query.tab === "account" ? (
          canReadAccount && accountSection ? (
            accountSection
          ) : (
            <CimacPanel title={t("客户账务暂不可用", "Compte client indisponible")}>
              <CimacEmpty>
                {t(
                  "当前账号无权读取或暂时无法核对完整账务，未以零余额替代。",
                  "Accès non autorisé ou compte complet temporairement indisponible ; aucun solde nul n’est substitué.",
                )}
              </CimacEmpty>
            </CimacPanel>
          )
        ) : (
          <div className={styles.stack}>
            <div className={styles.detailGrid}>
              <CimacPanel title={t("档案与原始记录", "Fiche et enregistrements d’origine")}>
                <CimacFacts
                  locale={locale}
                  rows={[
                    { label: t("资料建立时间", "Fiche créée le"), value: profile.created_at },
                    { label: t("资料更新时间", "Fiche mise à jour le"), value: profile.updated_at },
                    { label: t("已登记备注", "Note enregistrée"), value: profile.notes },
                    {
                      label: t("证件资料", "Pièce d’identité"),
                      value: profile.hasDocument
                        ? t(
                            "已登记，敏感号码不在此展示",
                            "Enregistrée ; numéro sensible non affiché",
                          )
                        : t("未登记", "Non renseignée"),
                    },
                  ]}
                />
                <p className={styles.indexNote}>
                  {t(
                    "以上为档案保存事实，不是完整审计时间线，备注不代表已确认的收费或交付指令。",
                    "Il s’agit de faits de fiche, pas d’un audit complet. Une note n’est pas une décision tarifaire ou de livraison confirmée.",
                  )}
                </p>
              </CimacPanel>
              <CimacPanel title={t("事项与交付资料", "Suivi et pièces de livraison")}>
                <CimacPendingOperations locale={locale} />
              </CimacPanel>
            </div>
            {recordSection}
          </div>
        )}
      </section>
    </div>
  );
}
