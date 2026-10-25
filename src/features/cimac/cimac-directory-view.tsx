import Link from "next/link";
import type { CimacAssetDirectoryData, CimacCustomerDirectoryData } from "./cimac-workspace-types";
import { cimacWorkspaceHref } from "./cimac-workspace-query";
import {
  CimacEmpty,
  CimacLink,
  CimacPageHeading,
  CimacPagination,
  CimacPanel,
  CimacPill,
  cimacAssetKind,
  cimacConstruction,
  cimacDate,
  cimacOccupancy,
  cimacText,
  type CimacViewLocale,
} from "./cimac-view-parts";
import styles from "./cimac-workspace.module.css";
import { CimacCustomerCreateOperation } from "./cimac-profile-operations";

interface DirectoryPresentation {
  locale: CimacViewLocale;
  title?: string;
  description?: string;
}
export interface CimacCustomerDirectoryViewProps extends DirectoryPresentation {
  data: CimacCustomerDirectoryData;
  accountLinks?: boolean;
  canEdit?: boolean;
  canCreateContract?: boolean;
}
export interface CimacAssetDirectoryViewProps extends DirectoryPresentation {
  data: CimacAssetDirectoryData;
}

export function CimacCustomerDirectoryView({
  data,
  locale,
  accountLinks = false,
  canEdit = false,
  canCreateContract = false,
  title,
  description,
}: CimacCustomerDirectoryViewProps) {
  const t = (zh: string, fr: string) => cimacText(locale, zh, fr);
  const href = (patch: Partial<typeof data.query> = {}) => {
    const target = cimacWorkspaceHref("customers", locale, {
      ...data.query,
      tab: "overview",
      relationPage: 1,
      ...patch,
    });
    return accountLinks ? target.replace("/cimac/customers", "/cimac/finance") : target;
  };
  const current = href();
  const filters = [
    { key: "all", label: t("全部关联", "Toutes les relations") },
    { key: "contract", label: t("有关联合同", "Contrats liés") },
    { key: "contact", label: t("业务联系人", "Contacts métier") },
    { key: "unknown", label: t("关系待核", "Relations à vérifier") },
    { key: "blacklisted", label: t("已标记黑名单", "Liste noire enregistrée") },
    { key: "guest", label: t("历史住客关联", "Clients de séjour historiques") },
  ];
  return (
    <div className={styles.view}>
      <CimacPageHeading
        overline={accountLinks ? "CUSTOMER ACCOUNTS" : "CUSTOMER DIRECTORY"}
        title={
          title ??
          (accountLinks
            ? t("收费与资金", "Encaissements et trésorerie")
            : t("招商与客户", "Relations clients"))
        }
        subtitle={
          description ??
          (accountLinks
            ? t(
                "选择客户，核对各资产的合同、收费约定和原币账务。",
                "Choisissez un client pour consulter contrats, conventions tarifaires et comptes en devise.",
              )
            : t(
                "一位客户关联多类资产；关系来自已登记业务，不代表产权归属。",
                "Un client peut être lié à plusieurs catégories d’actifs. Les relations enregistrées ne prouvent pas la propriété.",
              ))
        }
        actions={
          !accountLinks ? (
            <>
              <CimacLink href={`${locale === "fr" ? "/fr" : ""}/cimac/contracts`} button>
                {canCreateContract
                  ? t("办理合同", "Gérer les contrats")
                  : t("查看合同", "Consulter les contrats")}
              </CimacLink>
              {canEdit ? (
                <CimacCustomerCreateOperation
                  locale={locale}
                  canCreateContract={canCreateContract}
                />
              ) : null}
            </>
          ) : undefined
        }
      />
      <form
        className={styles.filters}
        method="get"
        action={
          accountLinks
            ? `${locale === "fr" ? "/fr" : ""}/cimac/finance`
            : cimacWorkspaceHref("customers", locale)
        }
        aria-label={t("筛选建材城客户", "Filtrer les clients CIMAC")}
      >
        <label className={`${styles.field} ${styles.fieldGrow}`}>
          <span>{t("客户名称或联系电话", "Nom du client ou téléphone")}</span>
          <input
            className={styles.input}
            type="search"
            name="q"
            defaultValue={data.query.q}
            maxLength={200}
            placeholder={t("搜索当前项目客户", "Rechercher dans ce projet")}
          />
        </label>
        <label className={styles.field}>
          <span>{t("关联楼栋", "Bâtiment lié")}</span>
          <select className={styles.input} name="building" defaultValue={data.query.building}>
            <option value="">{t("全部授权楼栋", "Tous les bâtiments autorisés")}</option>
            {data.scope.buildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("关联筛选", "Relations")}</span>
          <select className={styles.input} name="filter" defaultValue={data.query.filter}>
            {filters.map((filter) => (
              <option key={filter.key} value={filter.key}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.button}>
          {t("查询", "Rechercher")}
        </button>
      </form>
      <CimacPanel
        title={t("当前项目客户", "Clients du projet")}
        aside={
          <span className={styles.small}>
            {t(`${data.total} 位匹配客户`, `${data.total} clients correspondants`)}
          </span>
        }
      >
        {data.rows.length ? (
          <ul className={styles.directoryList}>
            {data.rows.map((row) => (
              <li className={styles.directoryRow} key={row.id}>
                <div>
                  <CimacLink
                    href={cimacWorkspaceHref(
                      "customers",
                      locale,
                      { tab: accountLinks ? "account" : "overview", returnTo: current },
                      row.id,
                    )}
                  >
                    {row.name}
                  </CimacLink>
                  <p className={styles.small}>
                    {row.phone || t("联系电话未登记", "Téléphone non renseigné")}
                  </p>
                </div>
                <div className={styles.directoryMeta}>
                  <p>
                    {t(
                      `${row.roomCount} 处关联资产 · ${row.relationshipCount} 条业务关联`,
                      `${row.roomCount} actifs liés · ${row.relationshipCount} relations métier`,
                    )}
                  </p>
                  <p className={styles.small}>
                    {t("最近业务登记日", "Dernière date métier enregistrée")} ·{" "}
                    {cimacDate(row.lastBusinessDate, locale)}
                  </p>
                </div>
                <CimacPill
                  tone={
                    row.isBlacklisted ? "amber" : row.roles.includes("lease") ? "blue" : undefined
                  }
                >
                  {row.isBlacklisted
                    ? t("黑名单标记", "Liste noire")
                    : row.roles.includes("lease")
                      ? t("租赁关联", "Relation locative")
                      : t("按登记关系核对", "Relation à vérifier")}
                </CimacPill>
              </li>
            ))}
          </ul>
        ) : (
          <CimacEmpty>
            {t(
              "当前筛选没有匹配客户；不表示整个园区没有客户。",
              "Aucun client ne correspond aux filtres ; cela ne signifie pas que le parc est sans clients.",
            )}
          </CimacEmpty>
        )}
      </CimacPanel>
      <CimacPagination
        {...data}
        locale={locale}
        label={t("客户名册分页", "Pagination du répertoire clients")}
        previous={data.page > 1 ? href({ page: data.page - 1 }) : undefined}
        next={data.page * data.pageSize < data.total ? href({ page: data.page + 1 }) : undefined}
      />
      <p className={styles.endnote}>
        {t(
          "客户档案与租约、资产和账务分别保存；此处不复制合同、不创建财务记录。",
          "Les fiches clients, baux, actifs et comptes restent distincts. Aucun contrat dupliqué ni écriture créée ici.",
        )}
      </p>
    </div>
  );
}

export function CimacAssetDirectoryView({
  data,
  locale,
  title,
  description,
}: CimacAssetDirectoryViewProps) {
  const t = (zh: string, fr: string) => cimacText(locale, zh, fr);
  const href = (patch: Partial<typeof data.query> = {}) =>
    cimacWorkspaceHref("assets", locale, {
      ...data.query,
      tab: "overview",
      relationPage: 1,
      ...patch,
    });
  const current = href();
  const filters = [
    { key: "all", label: t("全部资产", "Tous les actifs") },
    { key: "attention", label: t("状态需核对", "États à vérifier") },
    { key: "occupied", label: t("当前占用", "Occupation actuelle") },
    { key: "unoccupied", label: t("无当前占用（已核）", "Sans occupation (vérifié)") },
    { key: "construction_pending", label: t("建设准备待跟进", "Préparation du bâti") },
    { key: "construction_unverified", label: t("建设资料待核", "Bâti à vérifier") },
    { key: "occupancy_unverified", label: t("占用资料待核", "Occupation à vérifier") },
    { key: "maintenance", label: t("维修中", "En maintenance") },
    { key: "locked", label: t("锁定", "Bloqué") },
  ];
  return (
    <div className={styles.view}>
      <CimacPageHeading
        overline="ASSET DIRECTORY"
        title={title ?? t("园区资产", "Actifs du parc")}
        subtitle={
          description ??
          t(
            "商铺、公寓和仓库统一索引；建设、占用与履约独立核对。",
            "Index commun des boutiques, appartements et entrepôts. Bâti, occupation et exécution restent distincts.",
          )
        }
      />
      <div
        className={styles.summary}
        aria-label={t("授权资产概况", "Synthèse des actifs autorisés")}
      >
        <span>
          <strong>{data.summary.total}</strong>
          {t("项登记资产", "actifs enregistrés")}
        </span>
        <span>
          <strong>{data.summary.occupancyUnknown}</strong>
          {t("项占用待核", "occupations à vérifier")}
        </span>
        <span>
          <strong>{data.summary.constructionUnknown}</strong>
          {t("项建设待核", "états du bâti à vérifier")}
        </span>
      </div>
      <form
        className={styles.filters}
        method="get"
        action={cimacWorkspaceHref("assets", locale)}
        aria-label={t("筛选建材城资产", "Filtrer les actifs CIMAC")}
      >
        <label className={`${styles.field} ${styles.fieldGrow}`}>
          <span>{t("资产编号或房号", "Référence ou numéro du lot")}</span>
          <input
            className={styles.input}
            type="search"
            name="q"
            defaultValue={data.query.q}
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          <span>{t("楼栋", "Bâtiment")}</span>
          <select className={styles.input} name="building" defaultValue={data.query.building}>
            <option value="">{t("全部授权楼栋", "Tous les bâtiments autorisés")}</option>
            {data.scope.buildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("资产类型", "Type d’actif")}</span>
          <select className={styles.input} name="kind" defaultValue={data.query.kind}>
            <option value="">{t("全部类型", "Tous les types")}</option>
            {["storefront", "apartment", "warehouse", "parking", "office"].map((kind) => (
              <option key={kind} value={kind}>
                {cimacAssetKind(kind, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("状态筛选", "État")}</span>
          <select className={styles.input} name="filter" defaultValue={data.query.filter}>
            {filters.map((filter) => (
              <option key={filter.key} value={filter.key}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.button}>
          {t("查询", "Rechercher")}
        </button>
      </form>
      <CimacPanel
        title={t("已登记资产", "Actifs enregistrés")}
        aside={
          <span className={styles.small}>
            {t(`${data.total} 项匹配结果`, `${data.total} résultats`)}
          </span>
        }
      >
        {data.rows.length ? (
          <ul className={styles.directoryList}>
            {data.rows.map((asset) => (
              <li className={styles.directoryRow} key={asset.id}>
                <div>
                  <Link
                    prefetch={false}
                    className={styles.link}
                    href={cimacWorkspaceHref("assets", locale, { returnTo: current }, asset.id)}
                  >
                    {asset.buildingName} · {asset.unitNo} ↗
                  </Link>
                  <p className={styles.small}>
                    {cimacAssetKind(asset.kind, locale)} · {asset.code}
                  </p>
                </div>
                <div className={styles.directoryMeta}>
                  <p>{cimacConstruction(asset.constructionStatus, locale)}</p>
                  <p className={styles.small}>{cimacOccupancy(asset, locale)}</p>
                </div>
                <CimacPill tone={asset.attentionReasons.length ? "amber" : undefined}>
                  {asset.attentionReasons.length
                    ? t("资料或状态需核", "Informations ou état à vérifier")
                    : t("按登记状态展示", "État enregistré")}
                </CimacPill>
              </li>
            ))}
          </ul>
        ) : (
          <CimacEmpty>
            {t(
              "当前筛选没有匹配资产。未将待核占用当作空置可租。",
              "Aucun actif ne correspond. Une occupation inconnue n’est pas considérée comme un lot libre à louer.",
            )}
          </CimacEmpty>
        )}
      </CimacPanel>
      <CimacPagination
        {...data}
        locale={locale}
        label={t("资产目录分页", "Pagination des actifs")}
        previous={data.page > 1 ? href({ page: data.page - 1 }) : undefined}
        next={data.page * data.pageSize < data.total ? href({ page: data.page + 1 }) : undefined}
      />
      <p className={styles.endnote}>
        {t(
          "无当前占用不等于具备出租或交付条件；未建立的交付、开业信息继续待核。",
          "L’absence d’occupation ne prouve ni la disponibilité locative ni la livraison. Les informations de réception et d’ouverture restent à vérifier.",
        )}
      </p>
    </div>
  );
}

export function CimacDirectoryView(
  props:
    | ({ section: "customers" } & CimacCustomerDirectoryViewProps)
    | ({ section: "assets" } & CimacAssetDirectoryViewProps),
) {
  return props.section === "customers" ? (
    <CimacCustomerDirectoryView {...props} />
  ) : (
    <CimacAssetDirectoryView {...props} />
  );
}
