"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Building2, Search } from "lucide-react";
import type { CimacCustomerAccount } from "./cimac-billing-types";
import { billingNumber } from "./cimac-billing-display";
import { CimacAccountContent } from "./cimac-account-content";
import {
  cimacBillingHref,
  type CimacBillingQuery,
  type CimacBillingTab,
} from "./cimac-billing-query";
import styles from "./cimac-customer-workbench.module.css";

export type { CimacBillingTab } from "./cimac-billing-query";
export interface CimacCustomerWorkbenchProps {
  data: CimacCustomerAccount;
  locale: "zh" | "fr";
  canWrite: boolean;
  today: string;
  viewerId: string;
  query?: CimacBillingQuery;
}

export function CimacCustomerWorkbench(props: CimacCustomerWorkbenchProps) {
  return (
    <CustomerAccountContent
      key={`${props.viewerId}:${props.data.selectedCustomerId ?? "none"}`}
      {...props}
    />
  );
}

function CustomerAccountContent({
  data,
  locale,
  canWrite,
  today,
  viewerId,
  query,
}: CimacCustomerWorkbenchProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const base = locale === "fr" ? "/fr" : "";
  const [tab, setTab] = useState<CimacBillingTab>(query?.tab ?? "bills");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const customer = data.customer;
  const writable = canWrite && data.canWrite;
  const href = (patch: Partial<CimacBillingQuery> = {}) =>
    cimacBillingHref(
      {
        customerId: data.selectedCustomerId ?? undefined,
        search: query?.search ?? "",
        customerPage: data.customerPage.page,
        tab,
      },
      locale,
      patch,
    );
  const balances = customer?.balances ?? [];
  const mainBalance = balances.find((balance) => balance.currency === "XOF");
  const nativeBalances = balances.filter((balance) => balance.currency !== "XOF");
  const totalPages = Math.max(1, Math.ceil(data.customerPage.total / data.customerPage.pageSize));
  const oldLedger = `${base}/finance?kind=ledger&projectId=${encodeURIComponent(data.project.id)}`;
  return (
    <div className={styles.workbench}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>CIMAC · CUSTOMER ACCOUNTS</p>
          <h1>{text("建材城 · 客户总账", "CIMAC · Comptes clients")}</h1>
          <p className={styles.subtitle}>
            {text(
              "客户统一看，合同分别管，费用逐项算，收款明确分配。",
              "Un client, plusieurs biens ; des contrats distincts et des affectations explicites.",
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <Link href={oldLedger} className={styles.button}>
            {text("收支流水", "Écritures")}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          {writable && customer ? (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={collectionOpen}
              onClick={() => setCollectionOpen(true)}
            >
              {text("登记收款与分账", "Encaisser et affecter")}
            </button>
          ) : null}
        </div>
      </header>
      <form method="get" action={`${base}/finance`} className={styles.toolbar}>
        <input type="hidden" name="view" value="customers" />
        <input type="hidden" name="projectId" value={data.project.id} />
        <input type="hidden" name="tab" value={tab} />
        <label className={styles.search}>
          <Search aria-hidden="true" size={15} />
          <span className={styles.srOnly}>
            {text("搜索客户、房号或合同", "Rechercher un client, lot ou contrat")}
          </span>
          <input
            type="search"
            name="search"
            defaultValue={query?.search ?? ""}
            maxLength={120}
            placeholder={text("搜索客户、房号或合同", "Client, lot ou contrat")}
          />
        </label>
        <button type="submit" className={styles.button}>
          {text("查询", "Rechercher")}
        </button>
        <span className={styles.note}>
          {text("当前账号授权范围 · 原币独立核算", "Périmètre autorisé · devises séparées")}
        </span>
      </form>
      <div className={styles.layout}>
        <aside
          className={`${styles.panel} ${styles.customerList}`}
          aria-label={text("客户总账列表", "Liste des comptes clients")}
        >
          <div className={styles.listHead}>
            <span>{text("客户总账", "Comptes clients")}</span>
            <span>{data.customerPage.total}</span>
          </div>
          {data.customerPage.rows.map((item) => (
            <Link
              key={item.id}
              href={href({ customerId: item.id })}
              prefetch={false}
              className={styles.customer}
              aria-current={customer?.id === item.id ? "page" : undefined}
            >
              <strong>{item.name}</strong>
              <small>
                {item.unitCount} {text("处物业", "biens")} · {item.contractCount}{" "}
                {text("份合同", "contrats")}
              </small>
              {item.pendingCount > 0 ? (
                <small>
                  {item.pendingCount} {text("项待核", "à vérifier")}
                </small>
              ) : null}
            </Link>
          ))}
          {!data.customerPage.rows.length ? (
            <p className={styles.empty}>
              {text("没有匹配的客户。", "Aucun client correspondant.")}
            </p>
          ) : null}
          {totalPages > 1 ? (
            <nav
              className={styles.pagination}
              aria-label={text("客户分页", "Pagination des clients")}
            >
              {data.customerPage.page > 1 ? (
                <Link
                  prefetch={false}
                  href={href({ customerPage: data.customerPage.page - 1, customerId: undefined })}
                >
                  {text("上一页", "Précédent")}
                </Link>
              ) : (
                <span />
              )}
              <span>
                {data.customerPage.page} / {totalPages}
              </span>
              {data.customerPage.page < totalPages ? (
                <Link
                  prefetch={false}
                  href={href({ customerPage: data.customerPage.page + 1, customerId: undefined })}
                >
                  {text("下一页", "Suivant")}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
          <p className={styles.customerNote}>
            {text(
              "同一客户统一查看，各份合同独立核算。历史关联不自动更改。",
              "Un compte client, des contrats distincts. Les liens historiques ne sont pas modifiés automatiquement.",
            )}
          </p>
        </aside>
        <div className={styles.body}>
          {!customer ? (
            <section className={styles.panel}>
              <p className={styles.empty}>
                {text(
                  "请选择一个有权查看的客户。未读取到客户，不显示虚构余额。",
                  "Sélectionnez un client autorisé. Aucun solde fictif n’est affiché sans données.",
                )}
              </p>
            </section>
          ) : (
            <>
              <section
                className={`${styles.panel} ${styles.profile}`}
                aria-label={text("客户账户汇总", "Synthèse du compte client")}
              >
                <div className={styles.profileTop}>
                  <div className={styles.identity}>
                    <span className={styles.avatar}>
                      <Building2 size={19} aria-hidden="true" />
                    </span>
                    <div>
                      <h2>{customer.name}</h2>
                      <p className={styles.meta}>
                        {customer.phone || text("联系方式待补充", "Coordonnées non renseignées")} ·{" "}
                        {customer.contractCount} {text("份合同", "contrats")}
                      </p>
                    </div>
                  </div>
                  <Link
                    className={styles.quietButton}
                    href={`${base}/customers?customer=${encodeURIComponent(customer.id)}`}
                  >
                    {text("客户档案", "Fiche client")}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                </div>
                <div className={styles.stats}>
                  {(
                    [
                      ["receivable", text("有效应收", "Créances gérées")],
                      ["paid", text("应收已核销", "Créances imputées")],
                      ["outstanding", text("当前未收", "Solde à recevoir")],
                    ] as const
                  ).map(([key, label]) => (
                    <div className={styles.stat} key={key}>
                      <span>{label}</span>
                      <p className={styles.statValue}>
                        {billingNumber(mainBalance?.[key], locale)}
                        <small>XOF</small>
                      </p>
                      <span>
                        {key === "paid"
                          ? text("不等于现金实收", "Distinct des sommes encaissées")
                          : key === "receivable"
                            ? text(
                                "历史待核及取消项不纳入",
                                "Hors historiques à vérifier et annulations",
                              )
                            : text("不含待核收费约定", "Hors conventions à vérifier")}
                      </span>
                    </div>
                  ))}
                </div>
                {nativeBalances.length ? (
                  <details className={styles.nativeSummary}>
                    <summary>
                      {text("其他币种", "Autres devises")} ·{" "}
                      {nativeBalances.map((balance) => balance.currency).join(" / ")} ·{" "}
                      {text("不并入 XOF", "hors total XOF")}
                    </summary>
                    {nativeBalances.map((balance) => (
                      <div className={styles.nativeRow} key={balance.currency}>
                        <strong>{balance.currency}</strong>
                        <span>
                          {text("应收", "Créances")} {billingNumber(balance.receivable, locale)}
                        </span>
                        <span>
                          {text("已核销", "Imputées")} {billingNumber(balance.paid, locale)}
                        </span>
                        <span>
                          {text("未收", "Solde")} {billingNumber(balance.outstanding, locale)}
                        </span>
                      </div>
                    ))}
                  </details>
                ) : null}
              </section>
              <CimacAccountContent
                data={data}
                locale={locale}
                viewerId={viewerId}
                canWrite={canWrite}
                today={today}
                query={query}
                tab={tab}
                onTabChange={setTab}
                collectionOpen={collectionOpen}
                onCollectionOpenChange={setCollectionOpen}
                showCollectionTrigger={false}
              />
            </>
          )}
        </div>
      </div>
      <footer className={styles.actions}>
        <Link
          className={styles.quietButton}
          href={`${base}/finance?kind=receivables&projectId=${encodeURIComponent(data.project.id)}`}
        >
          {text("全部应收账", "Toutes les créances")} ↗
        </Link>
        <Link className={styles.quietButton} href={`${base}/finance?view=reconciliation`}>
          {text("关联核对", "Rapprochement")} ↗
        </Link>
        <Link className={styles.quietButton} href={`${base}/finance?kind=ledger`}>
          {text("其他项目与通用财务", "Autres projets et finance générale")} ↗
        </Link>
        <Link className={styles.quietButton} href={`${base}/reports`}>
          {text("经营报表", "Rapports")} ↗
        </Link>
      </footer>
    </div>
  );
}
