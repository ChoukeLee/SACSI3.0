import type { ReactNode } from "react";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import type { UnitBusinessRelation } from "@/features/units/unit-workbench-model";
import type { CimacAssetData } from "./cimac-workspace-types";
import { cimacWorkspaceHref } from "./cimac-workspace-query";
import {
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
  cimacAssetKind,
  cimacCondition,
  cimacConstruction,
  cimacContractStatus,
  cimacDate,
  cimacNumber,
  cimacOccupancy,
  cimacText,
  type CimacViewLocale,
} from "./cimac-view-parts";
import { cimacAttentionLabel } from "./cimac-home-view";
import styles from "./cimac-workspace.module.css";

export interface CimacAssetViewProps {
  data: CimacAssetData;
  locale: CimacViewLocale;
  canEdit?: boolean;
  canReadAccount?: boolean;
  serviceSection?: ReactNode;
}

export function CimacAssetView({
  data,
  locale,
  canEdit = false,
  canReadAccount = true,
  serviceSection,
}: CimacAssetViewProps) {
  const t = (zh: string, fr: string) => cimacText(locale, zh, fr);
  const { asset, query } = data;
  const current = cimacWorkspaceHref("assets", locale, query, asset.id);
  const directory = cimacWorkspaceHref("assets", locale, {
    ...query,
    tab: "overview",
    relationPage: 1,
    returnTo: null,
  });
  const href = (tab: typeof query.tab, relationPage = query.relationPage) =>
    cimacWorkspaceHref("assets", locale, { ...query, tab, relationPage }, asset.id);
  const tabs = [
    { key: "overview", label: t("资产概览", "Vue de l’actif"), href: href("overview") },
    { key: "contracts", label: t("合同与客户", "Contrats et clients"), href: href("contracts") },
    { key: "service", label: t("物业与表计", "Services et compteurs"), href: href("service") },
    { key: "records", label: t("文件与记录", "Documents et historique"), href: href("records") },
  ];
  const maintenanceHref = canEdit
    ? buildWorkbenchRecordHref({
        workspace: "units",
        id: asset.id,
        project: data.scope.project.id,
        building: asset.buildingId,
        locale,
        returnTo: current,
      })
    : null;
  const customerLink = (
    relation: UnitBusinessRelation,
    tab: "overview" | "contracts" | "account" = "overview",
  ) =>
    relation.customerId
      ? cimacWorkspaceHref("customers", locale, { tab, returnTo: current }, relation.customerId)
      : null;
  const customers = new Map(
    data.relations.filter((row) => row.customerId).map((row) => [row.customerId!, row]),
  );
  const periodLabel = (relation: UnitBusinessRelation) =>
    `${t("登记起日", "Début enregistré")} ${cimacDate(relation.start, locale)} · ${relation.endDateKind === "actual" ? t("实际止日", "Fin réelle") : t("预计止日", "Fin prévue")} ${relation.endConfirmed || relation.endDateKind === "actual" ? cimacDate(relation.end, locale) : t("待确认", "À confirmer")}`;
  const reference =
    asset.kind === "storefront"
      ? t(
          "商铺物业费参考：900 XOF / ㎡ / 月。",
          "Référence des charges de boutique : 900 XOF / m² / mois.",
        )
      : asset.kind === "warehouse"
        ? t(
            "仓库物业费参考：450 XOF / ㎡ / 月。",
            "Référence des charges d’entrepôt : 450 XOF / m² / mois.",
          )
        : asset.kind === "apartment"
          ? t(
              "公寓物业费按一室、两室、三室分别为每月 30,000 / 40,000 / 50,000 XOF；本资产户型需核实，不自动选档。",
              "Charges d’appartement : 30 000 / 40 000 / 50 000 XOF par mois pour une, deux ou trois chambres. Le type de ce lot est à vérifier, sans choix automatique.",
            )
          : t(
              "本类资产未提供已确认的收费规则。",
              "Aucune règle tarifaire confirmée n’est fournie pour ce type d’actif.",
            );
  const contractRows = (
    <>
      {data.relations.length ? (
        data.relations.map((relation) => {
          const legacyHref =
            relation.type === "lease" || relation.type === "sale"
              ? buildWorkbenchRecordHref({
                  workspace: relation.type === "lease" ? "leases" : "sales",
                  id: relation.id,
                  project: data.scope.project.id,
                  building: asset.buildingId,
                  locale,
                  returnTo: current,
                })
              : null;
          const clientHref = customerLink(relation, "contracts");
          return (
            <div className={styles.contract} key={`${relation.type}:${relation.id}`}>
              <div>
                <div className={styles.contractTitle}>
                  <h3>{relation.contractNo || t("业务编号待核", "Référence à vérifier")}</h3>
                  <CimacPill tone={relation.status === "active" ? "blue" : undefined}>
                    {cimacContractStatus(relation.status, locale)}
                  </CimacPill>
                </div>
                <p className={styles.propertySub}>
                  {relation.customerName || t("关联客户姓名待核", "Nom du client lié à vérifier")} ·{" "}
                  {relation.type === "lease"
                    ? t("租赁关联，不代表产权", "Relation locative, pas une propriété")
                    : t(
                        "历史业务关联，以原记录为准",
                        "Relation historique, voir le dossier d’origine",
                      )}
                </p>
                <p className={styles.propertySub}>{periodLabel(relation)}</p>
              </div>
              <div className={styles.stack}>
                {clientHref ? (
                  <CimacLink href={clientHref}>
                    {t("客户全部关联", "Relations du client")}
                  </CimacLink>
                ) : null}
                {legacyHref ? (
                  <CimacLink href={legacyHref}>
                    {t("原业务办理", "Opérations existantes")}
                  </CimacLink>
                ) : null}
              </div>
            </div>
          );
        })
      ) : (
        <CimacEmpty>
          {t(
            "当前页没有已登记的合同关联；不据此判断资产可出租。",
            "Aucun contrat lié sur cette page ; la disponibilité locative n’est pas déduite.",
          )}
        </CimacEmpty>
      )}
    </>
  );
  return (
    <div className={styles.view}>
      <nav className={styles.breadcrumb} aria-label={t("资产位置", "Fil d’Ariane actif")}>
        <CimacLink href={cimacWorkspaceHref("home", locale)}>{t("工作首页", "Accueil")}</CimacLink>
        <span>/</span>
        <CimacLink href={directory}>{t("园区资产", "Actifs du parc")}</CimacLink>
        <span>/</span>
        <span>
          {asset.buildingName} · {asset.unitNo}
        </span>
      </nav>
      <CimacPageHeading
        overline={`ASSET / ${cimacAssetKind(asset.kind, locale)}`}
        title={`${asset.buildingName} · ${asset.unitNo}`}
        subtitle={
          <>
            {cimacAssetKind(asset.kind, locale)} ·{" "}
            {asset.floorLabel || t("楼层待核", "Étage à vérifier")} ·{" "}
            {t("登记面积", "Surface enregistrée")} {cimacNumber(asset.areaSqm, locale)} m²
          </>
        }
        actions={
          <>
            <CimacBackLink href={query.returnTo ?? directory} locale={locale} />
            {maintenanceHref ? (
              <CimacLink href={maintenanceHref} button>
                {t("原资产维护入口", "Gérer l’actif existant")}
              </CimacLink>
            ) : null}
          </>
        }
      />
      <dl
        className={styles.statusGrid}
        aria-label={t("资产独立状态", "États indépendants de l’actif")}
      >
        {[
          {
            label: t("建设条件", "État du bâti"),
            value: cimacConstruction(asset.constructionStatus, locale),
          },
          { label: t("租赁占用", "Occupation locative"), value: cimacOccupancy(asset, locale) },
          {
            label: t("交付验收", "Réception et livraison"),
            value: t("待核 · 未建立独立记录", "À vérifier · registre distinct absent"),
          },
          {
            label: t("开业 / 使用", "Ouverture / usage"),
            value: t("待核 · 不由租约推断", "À vérifier · non déduit du bail"),
          },
        ].map((row) => (
          <div className={styles.statusCell} key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <CimacTabs
        label={t("资产详情分区", "Sections de la fiche actif")}
        items={tabs}
        active={query.tab}
      />
      <section
        aria-label={
          tabs.find((tab) => tab.key === query.tab)?.label ?? t("资产详情", "Fiche actif")
        }
      >
        {query.tab === "overview" ? (
          <>
            <div className={styles.detailGrid}>
              <CimacPanel
                title={t("当前需要核对", "Points à vérifier")}
                aside={<CimacPill>{t("登记状态", "État enregistré")}</CimacPill>}
              >
                {asset.attentionReasons.length ? (
                  asset.attentionReasons.map((reason) => (
                    <div className={styles.sideItem} key={reason}>
                      <h3>{cimacAttentionLabel(reason, locale)}</h3>
                      <p>
                        {t(
                          "请核对原资产资料及现场实际情况；此处不是已分派工单。",
                          "Vérifiez la fiche d’origine et la situation sur place ; il ne s’agit pas d’une tâche affectée.",
                        )}
                      </p>
                    </div>
                  ))
                ) : (
                  <CimacEmpty>
                    {t(
                      "未发现当前规则中的状态核对项；交付和开业仍需独立依据。",
                      "Aucun point de vérification détecté ; réception et ouverture nécessitent toujours leurs propres preuves.",
                    )}
                  </CimacEmpty>
                )}
                <div className={styles.sideItem}>
                  <h3>{t("收费依据核对", "Vérification des bases tarifaires")}</h3>
                  <p>
                    {t(
                      "资产状态不直接生成账务；合同收费起算和已确认应收分别核对。",
                      "Un état d’actif ne crée aucune écriture ; début de facturation et créances confirmées se vérifient séparément.",
                    )}
                  </p>
                  <CimacLink href={href("service")}>
                    {t("查看物业与表计", "Voir services et compteurs")}
                  </CimacLink>
                </div>
              </CimacPanel>
              <CimacPanel
                title={t("关联客户", "Clients liés")}
                aside={
                  <span className={styles.small}>
                    {t(
                      `当前页 ${data.relations.length} / ${data.relationTotal} 条关联`,
                      `${data.relations.length} / ${data.relationTotal} relations sur cette page`,
                    )}
                  </span>
                }
              >
                {customers.size ? (
                  [...customers].map(([id, relation]) => (
                    <div className={styles.owner} key={id}>
                      <span className={styles.avatar} aria-hidden="true">
                        {Array.from(relation.customerName || "C")[0]}
                      </span>
                      <div>
                        <CimacLink href={customerLink(relation)!}>
                          {relation.customerName || t("客户姓名待核", "Nom du client à vérifier")}
                        </CimacLink>
                        <p className={styles.small}>
                          {t(
                            "业务关联 · 非产权结论",
                            "Relation métier · pas une conclusion de propriété",
                          )}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <CimacEmpty>
                    {t(
                      "当前页没有可核验客户，不从备注或占用状态猜测。",
                      "Aucun client vérifiable sur cette page, sans déduction depuis les notes ou l’occupation.",
                    )}
                  </CimacEmpty>
                )}
                <CimacLink href={href("contracts")}>
                  {t("查看全部合同关联", "Voir toutes les relations contractuelles")}
                </CimacLink>
              </CimacPanel>
            </div>
            <CimacPanel
              className={styles.sectionGap}
              title={t("资产档案", "Fiche actif")}
              aside={
                <span className={styles.small}>
                  {t("独立于客户与合同生命周期", "Distincte du cycle des clients et contrats")}
                </span>
              }
            >
              <CimacFacts
                locale={locale}
                rows={[
                  {
                    label: t("资产类型", "Type d’actif"),
                    value: cimacAssetKind(asset.kind, locale),
                  },
                  {
                    label: t("位置", "Emplacement"),
                    value: `${asset.buildingName} · ${asset.unitNo}`,
                  },
                  {
                    label: t("登记面积", "Surface enregistrée"),
                    value:
                      asset.areaSqm === null
                        ? t("待核", "À vérifier")
                        : `${cimacNumber(asset.areaSqm, locale)} m²`,
                  },
                  {
                    label: t("经营条件", "Condition d’exploitation"),
                    value: cimacCondition(asset, locale),
                  },
                  {
                    label: t("产权信息", "Propriété"),
                    value: t("不从客户或租赁关系推断", "Non déduite du client ou du bail"),
                  },
                  { label: t("资产编号", "Référence d’actif"), value: asset.code },
                ]}
              />
            </CimacPanel>
          </>
        ) : query.tab === "contracts" ? (
          <>
            <CimacPanel
              title={t("合同与业务关系", "Contrats et relations métier")}
              aside={
                <span className={styles.small}>
                  {t(
                    `共 ${data.relationTotal} 条已登记关联`,
                    `${data.relationTotal} relations enregistrées`,
                  )}
                </span>
              }
            >
              {contractRows}
            </CimacPanel>
            <CimacPagination
              page={data.relationPage}
              pageSize={data.pageSize}
              total={data.relationTotal}
              locale={locale}
              label={t("资产业务关联分页", "Pagination des relations de l’actif")}
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
        ) : query.tab === "service" ? (
          <div className={styles.stack}>
            {serviceSection ?? (
              <CimacPanel title={t("物业与表计记录", "Services et relevés de compteurs")}>
                <CimacEmpty>
                  {t(
                    "此页未加载表计读数；没有展示不代表用量为零。请通过对应客户账务的水电抄表分区核对已有记录。",
                    "Les relevés ne sont pas chargés ici ; leur absence à l’écran ne signifie pas une consommation nulle. Consultez les relevés existants du client concerné.",
                  )}
                </CimacEmpty>
                {canReadAccount
                  ? [...customers].map(([id, relation]) => (
                      <div className={styles.sideItem} key={id}>
                        <CimacLink href={customerLink(relation, "account")!}>
                          {relation.customerName || t("关联客户", "Client lié")} ·{" "}
                          {t("客户账务与抄表", "Compte et relevés")}
                        </CimacLink>
                      </div>
                    ))
                  : null}
              </CimacPanel>
            )}
            <CimacPanel
              title={t("收费计价参考", "Références tarifaires")}
              aside={
                <CimacPill tone="amber">
                  {t("合同适用条件待核", "Application au bail à vérifier")}
                </CimacPill>
              }
            >
              <div className={styles.sideItem}>
                <h3>{t("物业费", "Charges immobilières")}</h3>
                <p>{reference}</p>
              </div>
              <div className={styles.sideItem}>
                <h3>{t("起算、减免与水电单价", "Prise d’effet, remises et tarifs des fluides")}</h3>
                <p>
                  {t(
                    "合同起算日、减免和期间独立核对；水电单价及管理费适用待核，不自动计算金额或生成账单。",
                    "La prise d’effet, les remises et périodes se vérifient par bail. Tarifs eau/électricité et frais de gestion à confirmer ; aucun montant ni facture n’est généré automatiquement.",
                  )}
                </p>
              </div>
            </CimacPanel>
          </div>
        ) : (
          <div className={styles.detailGrid}>
            <CimacPanel title={t("资产原始记录", "Enregistrements de l’actif")}>
              <CimacFacts
                locale={locale}
                rows={[
                  { label: t("资产编号", "Référence d’actif"), value: asset.code },
                  { label: t("档案更新时间", "Fiche mise à jour le"), value: asset.updatedAt },
                  {
                    label: t("建设资料", "État du bâti"),
                    value: cimacConstruction(asset.constructionStatus, locale),
                  },
                  {
                    label: t("占用核验", "Occupation vérifiée"),
                    value:
                      asset.occupancyVerified === true
                        ? t("已登记核验标记", "Indicateur de vérification enregistré")
                        : t("待核", "À vérifier"),
                  },
                ]}
              />
              <p className={styles.indexNote}>
                {t(
                  "这是当前档案事实，不是完整变更历史；未从更新时间推断操作人或变更内容。",
                  "Il s’agit de faits actuels, pas d’un historique complet. Ni opérateur ni contenu de modification n’est déduit de la date.",
                )}
              </p>
            </CimacPanel>
            <CimacPanel title={t("交付与服务资料", "Pièces de livraison et de service")}>
              <CimacPendingOperations locale={locale} />
            </CimacPanel>
          </div>
        )}
      </section>
    </div>
  );
}
