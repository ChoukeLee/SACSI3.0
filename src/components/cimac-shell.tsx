"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  ChevronLeft,
  FileSignature,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelsTopLeft,
  ShieldCheck,
  UsersRound,
  WalletCards,
  Wrench,
  ChartNoAxesCombined,
} from "lucide-react";
import type { UserRole } from "@/lib/auth";
import { routeFor, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { canReadCimacAccount } from "@/features/cimac/cimac-workspace-access";
import { LocaleContextLink } from "./locale-context-link";
import styles from "./cimac-shell.module.css";

export function CimacShell({
  children,
  locale,
  projectId,
  displayName,
  role,
  sacsiHref,
}: {
  children: React.ReactNode;
  locale: Locale;
  projectId: string;
  displayName: string;
  role: UserRole;
  sacsiHref: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const zh = locale === "zh";
  const base = routeFor(locale, "/cimac");
  const contractHref = `${routeFor(locale, "/leases")}?${new URLSearchParams({ project: projectId, returnTo: base })}`;
  const nav = [
    { href: base, label: zh ? "工作首页" : "Vue d’ensemble", icon: LayoutDashboard, exact: true },
    { href: `${base}/customers`, label: zh ? "招商与客户" : "Clients", icon: UsersRound },
    {
      href: contractHref,
      label: zh ? "合同与履约" : "Contrats",
      icon: FileSignature,
      external: true,
    },
    { href: `${base}/assets`, label: zh ? "园区资产" : "Patrimoine", icon: Building2 },
    ...(canReadCimacAccount(role)
      ? [
          {
            href: `${base}/finance`,
            label: zh ? "收费与资金" : "Comptes clients",
            icon: WalletCards,
          },
        ]
      : []),
  ];
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "fr";
    document.body.setAttribute("data-sacis-route", pathname);
    document.body.setAttribute("data-sacis-daily-route", "false");
  }, [pathname, zh]);
  async function logout() {
    setSigningOut(true);
    setLogoutError(false);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setLogoutError(true);
      setSigningOut(false);
      return;
    }
    window.location.href = "/login";
  }
  return (
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""}`} data-cimac-shell>
      <a className={styles.skip} href="#cimac-main">
        {zh ? "跳至正文" : "Aller au contenu"}
      </a>
      <aside className={`${styles.sidebar} ${menuOpen ? styles.mobileOpen : ""}`}>
        <div className={styles.brand}>
          <button
            className={styles.mark}
            type="button"
            title={zh ? "展开或收起导航" : "Réduire ou développer"}
            aria-label={zh ? "展开或收起导航" : "Réduire ou développer"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            C
          </button>
          <Link
            className={styles.brandName}
            href={base}
            prefetch={false}
            onNavigate={() => setMenuOpen(false)}
          >
            <strong>CIMAC</strong>
            <small>{zh ? "科建建材城" : "Parc commercial"}</small>
          </Link>
          <button
            type="button"
            className={styles.collapseButton}
            aria-label={zh ? "收起导航" : "Réduire le menu"}
            onClick={() => setCollapsed(true)}
          >
            <ChevronLeft size={15} />
          </button>
        </div>
        <nav
          id="cimac-navigation"
          aria-label={zh ? "建材城导航" : "Navigation CIMAC"}
          className={styles.navigation}
        >
          <p className={styles.groupLabel}>{zh ? "园区工作区" : "ESPACE DU PARC"}</p>
          {nav.map(({ href, label, icon: Icon, exact, external }) => {
            const active = exact
              ? pathname === href
              : !external && (pathname === href || pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                title={label}
                aria-current={active ? "page" : undefined}
                className={`${styles.navLink} ${active ? styles.active : ""}`}
                onNavigate={() => setMenuOpen(false)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                {external && (
                  <ArrowUpRight size={12} className={styles.external} aria-hidden="true" />
                )}
              </Link>
            );
          })}
          <p className={styles.groupLabel}>{zh ? "后续流程" : "À STRUCTURER"}</p>
          <div
            className={styles.planned}
            title={
              zh
                ? "物业工单流程待建设；现有抄表与规则仍在客户总账中"
                : "Processus de services à définir"
            }
          >
            <Wrench size={17} />
            <span>{zh ? "物业与服务" : "Services"}</span>
            <small>{zh ? "规划" : "Prévu"}</small>
          </div>
          <div
            className={styles.planned}
            title={zh ? "园区专属经营分析待建设" : "Analyse dédiée à définir"}
          >
            <ChartNoAxesCombined size={17} />
            <span>{zh ? "经营分析" : "Analyse"}</span>
            <small>{zh ? "规划" : "Prévu"}</small>
          </div>
        </nav>
        <div className={styles.sidebarFooter}>
          {(role === "admin" || role === "boss") && (
            <Link
              className={styles.navLink}
              href={routeFor(locale, "/settings/audit-logs")}
              title={zh ? "查看审计日志" : "Journal d’audit"}
              prefetch={false}
            >
              <ShieldCheck size={17} />
              <span>{zh ? "审计日志" : "Journal d’audit"}</span>
              <ArrowUpRight size={12} className={styles.external} />
            </Link>
          )}
          <Link
            className={styles.workspaceSwitch}
            href={sacsiHref}
            title={zh ? "返回 SACSI 工作区" : "Espace SACSI"}
            prefetch={false}
          >
            <PanelsTopLeft size={17} />
            <span>{zh ? "SACSI 工作区" : "Espace SACSI"}</span>
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </aside>
      <div className={styles.body}>
        <header className={styles.header}>
          <button
            className={styles.mobileMenu}
            type="button"
            aria-controls="cimac-navigation"
            aria-expanded={menuOpen}
            aria-label={zh ? "展开或收起菜单" : "Afficher le menu"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={19} />
          </button>
          <span className={styles.workspaceLabel}>
            {zh ? "园区运营" : "Opérations du parc"}
            <small>CIMAC</small>
          </span>
          <div className={styles.headerActions}>
            <Suspense fallback={null}>
              <LocaleContextLink locale={zh ? "fr" : "zh"} label={zh ? "FR" : "中文"} />
            </Suspense>
            <span className={styles.userName}>{displayName}</span>
            <button
              type="button"
              onClick={logout}
              disabled={signingOut}
              title={zh ? "退出登录" : "Déconnexion"}
              aria-label={zh ? "退出登录" : "Déconnexion"}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        {logoutError && (
          <p role="alert" className={styles.logoutError}>
            {zh ? "退出失败，请重试。" : "Déconnexion impossible. Réessayez."}
          </p>
        )}
        <main id="cimac-main" className={styles.main} tabIndex={-1} data-app-main data-cimac-main>
          {/* The shared route-isolation CSS only exposes the current route root. */}
          <div
            key={pathname}
            data-route-root={pathname}
            data-current-route-root
            className="min-w-0"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
