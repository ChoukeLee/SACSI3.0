import "server-only";

import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, hasPermission, homePathForRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";
import { CimacShell } from "@/components/cimac-shell";
import { canAccessCimacWorkspace, canReadCimacAccount } from "./cimac-workspace-access";
import { parseCimacWorkspaceQuery } from "./cimac-workspace-query";
import { CimacWorkspaceReadError } from "./cimac-workspace-types";
import {
  readCimacWorkspaceScope,
  readCimacHome,
  readCimacCustomers,
  readCimacCustomer,
  readCimacAssets,
  readCimacAsset,
} from "./cimac-workspace-read";
import { CimacHomeView } from "./cimac-home-view";
import { CimacCustomerDirectoryView, CimacAssetDirectoryView } from "./cimac-directory-view";
import { CimacCustomerView } from "./cimac-customer-view";
import { CimacAssetView } from "./cimac-asset-view";
import { CimacAccountLazy } from "@/features/finance/cimac-account-lazy";
import { readCimacOperationUnit, readCimacProfileRecords } from "./cimac-profile-service";
import { CimacProfileRecordSections } from "./cimac-profile-records";

export type CimacSearchParams = Record<string, string | string[] | undefined>;
export interface CimacPageProps {
  searchParams: Promise<CimacSearchParams>;
}
export interface CimacDetailPageProps extends CimacPageProps {
  params: Promise<{ id: string }>;
}

async function scopedRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof CimacWorkspaceReadError && [400, 403, 404].includes(error.status))
      notFound();
    throw error;
  }
}

/** React request cache only. No process-wide cache may share a user's RLS result. */
export const getCimacWorkspaceContext = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessCimacWorkspace(user.role)) notFound();
  const client = await createClient();
  const scope = await scopedRead(() => readCimacWorkspaceScope(client));
  return { user, client, scope };
});

function query(params: CimacSearchParams, section: "home" | "customers" | "assets") {
  try {
    return parseCimacWorkspaceQuery(params, section);
  } catch (error) {
    if (error instanceof CimacWorkspaceReadError) notFound();
    throw error;
  }
}

export async function CimacWorkspaceLayout({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: Locale;
}) {
  const { user, scope } = await getCimacWorkspaceContext();
  return (
    <CimacShell
      locale={locale}
      projectId={scope.project.id}
      displayName={user.displayName}
      role={user.role}
      sacsiHref={homePathForRole(user.role, locale)}
    >
      {children}
    </CimacShell>
  );
}

export async function CimacHomePage({ searchParams, locale }: CimacPageProps & { locale: Locale }) {
  const params = query(await searchParams, "home");
  const { client, scope } = await getCimacWorkspaceContext();
  if (params.project !== "CIMAC" && params.project !== scope.project.id) notFound();
  if (params.building && !scope.buildings.some((b) => b.id === params.building)) notFound();
  const data = await scopedRead(() => readCimacHome(client, scope));
  return <CimacHomeView data={data} locale={locale} />;
}

export async function CimacCustomersPage({
  searchParams,
  locale,
  accounts = false,
}: CimacPageProps & { locale: Locale; accounts?: boolean }) {
  const { user, client, scope } = await getCimacWorkspaceContext();
  if (accounts && !canReadCimacAccount(user.role)) notFound();
  const params = query(await searchParams, "customers");
  const data = await scopedRead(() => readCimacCustomers(client, scope, params));
  return (
    <CimacCustomerDirectoryView
      data={data}
      locale={locale}
      accountLinks={accounts}
      canEdit={hasPermission(user, "customers:write")}
      canCreateContract={hasPermission(user, "leases:write")}
    />
  );
}

export async function CimacCustomerPage({
  params,
  searchParams,
  locale,
}: CimacDetailPageProps & { locale: Locale }) {
  const { user, client, scope } = await getCimacWorkspaceContext();
  const [{ id }, rawQuery] = await Promise.all([params, searchParams]);
  const parsed = query(rawQuery, "customers");
  const canReadAccount = canReadCimacAccount(user.role);
  if (parsed.tab === "account" && !canReadAccount) notFound();
  // Resolve the customer in this project before any account read, not globally by UUID.
  const data = await scopedRead(() => readCimacCustomer(client, scope, id, parsed));
  let accountSection: React.ReactNode;
  if (parsed.tab === "account") {
    const { readCimacCustomerAccount } = await import("@/features/finance/cimac-billing-read");
    const accountQuery = {
      customerId: data.profile.id,
      search: "",
      customerPage: 1,
      tab: parsed.accountTab ?? "bills",
    } as const;
    try {
      const account = await readCimacCustomerAccount(client, accountQuery);
      if (account.project.id !== scope.project.id || account.selectedCustomerId !== data.profile.id)
        throw new Error("CimacAccountUnavailable");
      accountSection = (
        <CimacAccountLazy
          data={account}
          locale={locale}
          viewerId={user.id}
          canWrite={hasPermission(user, "finance:write")}
          today={new Date().toISOString().slice(0, 10)}
          tab={accountQuery.tab}
          query={accountQuery}
          baseHref={`${locale === "fr" ? "/fr" : ""}/cimac/customers/${data.profile.id}`}
          returnTo={parsed.returnTo}
          building={parsed.building}
        />
      );
    } catch {
      const ledgerParams = new URLSearchParams({ kind: "ledger", projectId: scope.project.id });
      accountSection = (
        <section role="alert" className="rounded-xl border bg-card p-5 text-sm">
          <h2 className="font-semibold">
            {locale === "zh" ? "客户总账暂时不可用" : "Compte client indisponible"}
          </h2>
          <p className="my-3 text-muted-foreground">
            {locale === "zh"
              ? "未将读取失败显示为零余额。历史账务未被修改，请刷新重试或核对原有流水。"
              : "Une erreur de lecture n’est pas un solde nul. Aucun historique n’a été modifié."}
          </p>
          <Link
            className="text-blue-700 underline"
            href={`${locale === "fr" ? "/fr" : ""}/cimac/finance?${ledgerParams}`}
          >
            {locale === "zh" ? "查看原有收支流水" : "Consulter les écritures"}
          </Link>
        </section>
      );
    }
  }
  return (
    <CimacCustomerView
      data={data}
      locale={locale}
      canEdit={hasPermission(user, "customers:write")}
      canReadAccount={canReadAccount}
      accountSection={accountSection}
      recordSection={
        parsed.tab === "records" ? (
          <CimacProfileRecordSections
            data={await readCimacProfileRecords(client, scope, {
              type: "customer",
              id: data.profile.id,
            })}
            locale={locale}
            sharedIdentity
          />
        ) : undefined
      }
    />
  );
}

export async function CimacAssetsPage({
  searchParams,
  locale,
}: CimacPageProps & { locale: Locale }) {
  const { client, scope } = await getCimacWorkspaceContext();
  const params = query(await searchParams, "assets");
  const data = await scopedRead(() => readCimacAssets(client, scope, params));
  return <CimacAssetDirectoryView data={data} locale={locale} />;
}

export async function CimacAssetPage({
  params,
  searchParams,
  locale,
}: CimacDetailPageProps & { locale: Locale }) {
  const { user, client, scope } = await getCimacWorkspaceContext();
  const [{ id }, rawQuery] = await Promise.all([params, searchParams]);
  const parsed = query(rawQuery, "assets");
  const [data, operationUnit] = await Promise.all([
    scopedRead(() => readCimacAsset(client, scope, id, parsed)),
    scopedRead(() => readCimacOperationUnit(client, scope, id)),
  ]);
  return (
    <CimacAssetView
      data={data}
      locale={locale}
      canEdit={hasPermission(user, "units:write")}
      canReadAccount={canReadCimacAccount(user.role)}
      operationUnit={operationUnit}
      recordSection={
        parsed.tab === "records" ? (
          <CimacProfileRecordSections
            data={await readCimacProfileRecords(client, scope, { type: "unit", id: data.asset.id })}
            locale={locale}
          />
        ) : undefined
      }
    />
  );
}
