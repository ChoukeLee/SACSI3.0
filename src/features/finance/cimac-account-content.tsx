"use client";

import { useId, useState } from "react";
import { House, Store, Warehouse } from "lucide-react";
import type { CimacCustomerAccount } from "./cimac-billing-types";
import { CimacBillingRuleReference } from "./cimac-billing-rule-reference";
import { CimacCollectionPanel } from "./cimac-collection-panel";
import { CimacMeterPanel, CimacFeeTermsPanel } from "./cimac-pending-panels";
import { billingKind } from "./cimac-billing-display";
import { CimacCustomerBills } from "./cimac-customer-bills";
import { CimacCustomerReceipts } from "./cimac-customer-receipts";
import {
  cimacBillingHref,
  type CimacBillingQuery,
  type CimacBillingTab,
} from "./cimac-billing-query";
import styles from "./cimac-customer-workbench.module.css";

export interface CimacAccountContentProps {
  data: CimacCustomerAccount;
  locale: "zh" | "fr";
  viewerId: string;
  canWrite: boolean;
  /** Server-supplied business day is preferred; this is not a payment-date default. */
  today?: string;
  tab?: CimacBillingTab;
  query?: Partial<CimacBillingQuery>;
  /** Fixed customer workspace path. Omission preserves the legacy finance URLs. */
  baseHref?: string;
  returnTo?: string | null;
  building?: string | null;
  /** The legacy finance header owns its existing collection trigger. */
  collectionOpen?: boolean;
  onCollectionOpenChange?: (open: boolean) => void;
  showCollectionTrigger?: boolean;
  onTabChange?: (tab: CimacBillingTab) => void;
}

/** Shared account sections only: no duplicated page heading, directory or customer profile. */
export function CimacAccountContent(props: CimacAccountContentProps) {
  return (
    <AccountSections
      key={`${props.viewerId}:${props.data.selectedCustomerId ?? "none"}:${props.baseHref ? (props.tab ?? props.query?.tab ?? "bills") : "finance"}`}
      {...props}
    />
  );
}

function AccountSections({
  data,
  locale,
  viewerId,
  canWrite,
  today: serverToday,
  tab: initialTab,
  query,
  baseHref,
  returnTo,
  building,
  collectionOpen: controlledCollectionOpen,
  onCollectionOpenChange,
  showCollectionTrigger = true,
  onTabChange,
}: CimacAccountContentProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [fallbackToday] = useState(() => new Date().toISOString().slice(0, 10));
  const today = serverToday ?? fallbackToday;
  const [tab, setTab] = useState<CimacBillingTab>(initialTab ?? query?.tab ?? "bills");
  const [kind, setKind] = useState("all");
  const [localCollectionOpen, setLocalCollectionOpen] = useState(false);
  const collectionOpen = controlledCollectionOpen ?? localCollectionOpen;
  const setCollectionOpen = onCollectionOpenChange ?? setLocalCollectionOpen;
  const tabsId = useId();
  const writable = canWrite && data.canWrite;
  const href = (nextTab = tab) =>
    cimacBillingHref(
      {
        customerId: data.selectedCustomerId ?? undefined,
        search: query?.search ?? "",
        customerPage: query?.customerPage ?? data.customerPage.page,
        tab: nextTab,
      },
      locale,
      {},
      baseHref,
      { returnTo, building },
    );
  const changeTab = (value: CimacBillingTab) => {
    setTab(value);
    onTabChange?.(value);
    // Preserve Next's history metadata. The fixed path contains this customer's
    // immutable ID, so a refresh or a legacy-operation return cannot select another.
    if (baseHref) window.history.replaceState(window.history.state, "", href(value));
  };
  const categories = [
    "storefront",
    "apartment",
    "warehouse",
    ...Array.from(new Set(data.units.map((unit) => unit.kind))).filter(
      (value) => !["storefront", "apartment", "warehouse"].includes(value),
    ),
  ];
  if (!data.customer || data.customer.id !== data.selectedCustomerId)
    return (
      <section className={`${styles.workbench} ${styles.panel}`}>
        <p className={styles.empty}>
          {text(
            "请选择一个有权查看的客户。未读取到客户，不显示虚构余额。",
            "Sélectionnez un client autorisé. Aucun solde fictif n’est affiché sans données.",
          )}
        </p>
      </section>
    );
  return (
    <div className={styles.workbench}>
      {showCollectionTrigger && writable ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={collectionOpen}
            onClick={() => setCollectionOpen(true)}
          >
            {text("登记收款与分账", "Encaisser et affecter")}
          </button>
        </div>
      ) : null}
      <div
        className={styles.assets}
        aria-label={text("客户关联物业类型", "Types de biens du client")}
      >
        {categories.map((value) => {
          const matching = data.units.filter((unit) => unit.kind === value);
          const Icon = value === "storefront" ? Store : value === "warehouse" ? Warehouse : House;
          return (
            <button
              type="button"
              key={value}
              className={styles.asset}
              aria-pressed={kind === value}
              onClick={() => setKind(kind === value ? "all" : value)}
            >
              <span className={styles.assetTitle}>
                <Icon size={15} aria-hidden="true" />
                {billingKind(value, locale)}
                <strong>{matching.length}</strong>
              </span>
              <span className={styles.assetRooms}>
                {matching.length
                  ? matching.map((unit) => unit.unit_no).join(" / ")
                  : text("无关联物业", "Aucun bien associé")}
              </span>
            </button>
          );
        })}
      </div>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={text("客户收费工作视图", "Vues de facturation client")}
      >
        {(
          [
            ["bills", text("收费账单", "Créances")],
            ["receipts", text("收款核销", "Encaissements")],
            ["meters", text("水电抄表", "Relevés")],
            ["rules", text("规则与约定", "Conventions")],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="tab"
            id={`${tabsId}-${value}`}
            aria-selected={tab === value}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === value ? 0 : -1}
            className={styles.tab}
            onClick={() => changeTab(value)}
            onKeyDown={(event) => {
              const order: CimacBillingTab[] = ["bills", "receipts", "meters", "rules"];
              let index = order.indexOf(value);
              if (event.key === "ArrowRight") index = (index + 1) % order.length;
              else if (event.key === "ArrowLeft") index = (index + order.length - 1) % order.length;
              else if (event.key === "Home") index = 0;
              else if (event.key === "End") index = order.length - 1;
              else return;
              event.preventDefault();
              changeTab(order[index]);
              document.getElementById(`${tabsId}-${order[index]}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {collectionOpen ? (
        <CimacCollectionPanel
          data={data}
          locale={locale}
          viewerId={viewerId}
          today={today}
          canWrite={writable}
          onClose={() => setCollectionOpen(false)}
        />
      ) : null}
      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${tab}`}
        className={styles.tabPanel}
      >
        {tab === "bills" ? (
          <CimacCustomerBills
            key={kind}
            data={data}
            locale={locale}
            today={today}
            kind={kind}
            onClearKind={() => setKind("all")}
            onShowRules={() => changeTab("rules")}
            returnHref={baseHref ? href() : undefined}
          />
        ) : null}
        {tab === "receipts" ? (
          <CimacCustomerReceipts
            data={data}
            locale={locale}
            returnHref={href()}
            viewerId={viewerId}
            today={today}
            canWrite={writable}
          />
        ) : null}
        {tab === "meters" ? (
          <CimacMeterPanel
            data={data}
            locale={locale}
            today={today}
            viewerId={viewerId}
            canWrite={writable}
          />
        ) : null}
        {tab === "rules" ? (
          <>
            <CimacBillingRuleReference locale={locale} />
            <CimacFeeTermsPanel
              data={data}
              locale={locale}
              today={today}
              viewerId={viewerId}
              canWrite={writable}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
