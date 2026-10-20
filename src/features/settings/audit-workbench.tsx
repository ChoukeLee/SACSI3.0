"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  auditActionLabel,
  auditEntityLabel,
  normalizeAuditKey,
} from "@/lib/audit-labels";
import type { AuditLogRow } from "./audit-log-enrichment";
import { AuditBusinessDetail } from "./audit-business-detail";
import {
  auditActorText,
  auditBusinessSummary,
  auditChannel,
  auditChannelLabel,
  auditIdentityLabel,
  auditIdentityStatus,
  auditText,
} from "./audit-business-summary";
import {
  auditWorkbenchSearchParams,
  decodeAuditWorkbench,
  decodeAuditWorkbenchLog,
  parseAuditWorkbenchQuery,
} from "./audit-workbench-model";
import type {
  AuditWorkbenchFilters,
  AuditWorkbenchQuery,
  AuditWorkbenchResult,
} from "./audit-workbench-types";
import styles from "./audit-workbench.module.css";

interface AuditWorkbenchProps {
  locale: Locale;
  viewerKey: string;
  canRead?: boolean;
  initialData: AuditWorkbenchResult | null;
  initialQuery?: AuditWorkbenchQuery;
  initialError?: number;
}

/** Local filter labels only: unknown/colliding display names never hide the recorded key. */
function distinctFilterOptions(options: { key: string; label: string; known: boolean }[]) {
  const counts = new Map<string, number>();
  for (const option of options) {
    const normalized = option.label.trim().toLowerCase();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return options.map((option) => ({
    key: option.key,
    label:
      !option.known || (counts.get(option.label.trim().toLowerCase()) ?? 0) > 1
        ? `${option.label} · ${option.key}`
        : option.label,
  }));
}

function errorText(status: number, zh: boolean) {
  if (status === 400)
    return zh
      ? "筛选条件无效，请检查日期范围与搜索文字。"
      : "Filtres invalides. Vérifiez les dates et le texte recherché.";
  if (status === 401 || status === 403)
    return zh
      ? "当前登录账号没有审计查看权限，请重新登录或联系管理员。"
      : "Ce compte n’a pas accès à l’audit. Reconnectez-vous ou contactez un administrateur.";
  if (status === 404)
    return zh
      ? "这条记录不可用或已不在当前权限范围内。"
      : "Cette entrée est indisponible ou hors de votre périmètre.";
  if (status === 413)
    return zh
      ? "匹配记录过多，未导出任何不完整文件。请缩小日期范围后重试。"
      : "Trop de résultats : aucun export tronqué. Réduisez la période.";
  return zh
    ? "审计记录暂时无法读取，请重试。没有修改任何业务数据。"
    : "Lecture de l’audit indisponible. Réessayez. Aucune donnée métier n’a été modifiée.";
}

function displayTime(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Africa/Abidjan",
      }).format(date)
    : "—";
}

/** A new identity/role/locale remount aborts requests and discards all prior rows. */
export function AuditWorkbench(props: AuditWorkbenchProps) {
  const snapshot = useRef({
    viewerKey: props.viewerKey,
    data: props.initialData,
    query: props.initialQuery,
    error: props.initialError,
    revision: 0,
  });
  if (
    snapshot.current.data !== props.initialData ||
    snapshot.current.query !== props.initialQuery ||
    snapshot.current.error !== props.initialError
  ) {
    snapshot.current = {
      viewerKey: props.viewerKey,
      data: props.initialData,
      query: props.initialQuery,
      error: props.initialError,
      revision: snapshot.current.revision + 1,
    };
  }
  const snapshotMatches = snapshot.current.viewerKey === props.viewerKey;
  if (props.canRead === false)
    return (
      <p role="alert" className={styles.error}>
        {errorText(403, props.locale === "zh")}
      </p>
    );
  return (
    <AuditWorkbenchContent
      key={`${props.viewerKey}:${props.locale}:${snapshot.current.revision}`}
      {...props}
      initialData={snapshotMatches ? props.initialData : null}
      initialError={snapshotMatches ? props.initialError : 503}
    />
  );
}

function AuditWorkbenchContent({
  locale,
  initialData,
  initialError,
  initialQuery,
}: AuditWorkbenchProps) {
  const zh = locale === "zh";
  const initial = initialQuery ?? {
    ...parseAuditWorkbenchQuery(),
    ...(initialData ? { ...initialData.filters, page: initialData.page } : {}),
  };
  const [query, setQuery] = useState<AuditWorkbenchQuery>(initial);
  const [draft, setDraft] = useState<AuditWorkbenchFilters>(initial);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(initialError ?? 0);
  const [lostAccess, setLostAccess] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(0);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState(0);
  const listRequest = useRef({ sequence: 0, controller: null as AbortController | null });
  const detailRequest = useRef({ sequence: 0, controller: null as AbortController | null });
  const exportRequest = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const detailId = useId();
  const path = `${zh ? "" : "/fr"}/settings/audit-logs`;
  const visibleData = !loading && !lostAccess && !listError ? data : null;

  function cancelDetail() {
    detailRequest.current.sequence += 1;
    detailRequest.current.controller?.abort();
    setSelectedId(null);
    setDetail(null);
    setDetailError(0);
    setDetailLoading(false);
  }

  function denyAccess() {
    listRequest.current.sequence += 1;
    listRequest.current.controller?.abort();
    setLoading(false);
    setLostAccess(true);
    setData(null);
    cancelDetail();
    exportRequest.current?.abort();
    setExportLoading(false);
  }

  async function loadPage(next: AuditWorkbenchQuery, updateUrl = true) {
    let parsed: AuditWorkbenchQuery;
    try {
      parsed = parseAuditWorkbenchQuery({ ...next });
    } catch {
      listRequest.current.controller?.abort();
      listRequest.current.sequence += 1;
      cancelDetail();
      exportRequest.current?.abort();
      setExportLoading(false);
      setExportError(0);
      setData(null);
      setLoading(false);
      setListError(400);
      return;
    }
    listRequest.current.controller?.abort();
    const sequence = ++listRequest.current.sequence;
    const controller = new AbortController();
    listRequest.current.controller = controller;
    cancelDetail();
    exportRequest.current?.abort();
    setExportLoading(false);
    setExportError(0);
    setQuery(parsed);
    setDraft(parsed);
    setLoading(true);
    setListError(0);
    if (updateUrl) {
      const params = auditWorkbenchSearchParams(parsed).toString();
      window.history.pushState(null, "", `${path}${params ? `?${params}` : ""}`);
    }
    try {
      const response = await fetch(
        `/api/settings/audit-logs?${auditWorkbenchSearchParams(parsed)}`,
        { signal: controller.signal, cache: "no-store", credentials: "same-origin" },
      );
      if (controller.signal.aborted || sequence !== listRequest.current.sequence) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) denyAccess();
        throw response.status;
      }
      const result = decodeAuditWorkbench(await response.json(), parsed);
      if (controller.signal.aborted || sequence !== listRequest.current.sequence) return;
      setData(result);
    } catch (error) {
      if (controller.signal.aborted || sequence !== listRequest.current.sequence) return;
      setData(null);
      setListError(typeof error === "number" ? error : 503);
    } finally {
      if (!controller.signal.aborted && sequence === listRequest.current.sequence)
        setLoading(false);
    }
  }

  useEffect(() => {
    function onPopState() {
      try {
        const input: Record<string, unknown> = {};
        for (const [key, value] of new URLSearchParams(window.location.search)) {
          if (Object.hasOwn(input, key)) throw new Error("duplicate audit query key");
          input[key] = value;
        }
        void loadPage(parseAuditWorkbenchQuery(input), false);
      } catch {
        listRequest.current.controller?.abort();
        listRequest.current.sequence += 1;
        cancelDetail();
        exportRequest.current?.abort();
        setExportLoading(false);
        setExportError(0);
        setData(null);
        setLoading(false);
        setListError(400);
      }
    }
    window.addEventListener("popstate", onPopState);
    const list = listRequest.current;
    const detail = detailRequest.current;
    return () => {
      window.removeEventListener("popstate", onPopState);
      list.sequence += 1;
      list.controller?.abort();
      detail.sequence += 1;
      detail.controller?.abort();
      exportRequest.current?.abort();
    };
    // The content is keyed by viewer identity and locale; callbacks read request
    // refs, not previous pages. Do not refetch the already authorized SSR result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDetail(log: AuditLogRow, button?: HTMLButtonElement) {
    detailRequest.current.controller?.abort();
    const sequence = ++detailRequest.current.sequence;
    const controller = new AbortController();
    detailRequest.current.controller = controller;
    if (button) opener.current = button;
    setSelectedId(log.id);
    setDetail(null);
    setDetailError(0);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/settings/audit-logs/${encodeURIComponent(log.id)}`, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (controller.signal.aborted || sequence !== detailRequest.current.sequence) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) denyAccess();
        throw response.status;
      }
      const body = await response.json();
      const result = decodeAuditWorkbenchLog(body.log, true);
      if (result.id !== log.id) throw new Error("audit detail mismatch");
      if (controller.signal.aborted || sequence !== detailRequest.current.sequence) return;
      setDetail(result);
      // Keyboard users reach the loaded detail, including when it sits below
      // the list on a narrow screen. Focus never moves for an obsolete response.
      queueMicrotask(() => {
        if (!controller.signal.aborted && sequence === detailRequest.current.sequence)
          detailHeading.current?.focus();
      });
    } catch (error) {
      if (controller.signal.aborted || sequence !== detailRequest.current.sequence) return;
      setDetailError(typeof error === "number" ? error : 503);
    } finally {
      if (!controller.signal.aborted && sequence === detailRequest.current.sequence)
        setDetailLoading(false);
    }
  }

  async function exportAll() {
    if (!visibleData || !visibleData.total || exportLoading) return;
    exportRequest.current?.abort();
    const controller = new AbortController();
    exportRequest.current = controller;
    setExportLoading(true);
    setExportError(0);
    try {
      const params = auditWorkbenchSearchParams(visibleData.filters);
      const response = await fetch(`/api/settings/audit-logs/export?${params}`, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) denyAccess();
        throw response.status;
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sacsi-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      if (!controller.signal.aborted) setExportError(typeof error === "number" ? error : 503);
    } finally {
      if (!controller.signal.aborted) setExportLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadPage({ ...draft, page: 1 });
  }
  function closeDetail() {
    cancelDetail();
    opener.current?.focus();
  }
  function field(key: keyof AuditWorkbenchFilters, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  const selectedRow = visibleData?.rows.find((row) => row.id === selectedId);
  const totalPages = Math.max(1, Math.ceil((visibleData?.total ?? 0) / 30));
  const activeFilterCount = Object.values(query).filter(
    (value) => typeof value === "string" && value !== "",
  ).length;
  const actionOptions = distinctFilterOptions(
    [...new Set([...(data?.options.actions ?? []), ...(draft.action ? [draft.action] : [])])].map(
      (key) => {
        const known =
          Object.hasOwn(AUDIT_ACTION_LABELS[locale], key) ||
          Object.hasOwn(AUDIT_ACTION_LABELS[locale], normalizeAuditKey(key));
        return {
          key,
          known,
          label: known
            ? auditActionLabel(key, locale)
            : zh
              ? "其他操作"
              : normalizeAuditKey(key).replace(/_/g, " "),
        };
      },
    ),
  );
  const entityOptions = distinctFilterOptions(
    [
      ...new Set([
        ...(data?.options.entityTypes ?? []),
        ...(draft.entityType ? [draft.entityType] : []),
      ]),
    ].map((key) => {
      const known =
        Object.hasOwn(AUDIT_ENTITY_LABELS[locale], key) ||
        Object.hasOwn(AUDIT_ENTITY_LABELS[locale], normalizeAuditKey(key));
      return {
        key,
        known,
        label: known
          ? auditEntityLabel(key, locale)
          : zh
            ? "其他对象"
            : normalizeAuditKey(key).replace(/_/g, " "),
      };
    }),
  );
  const actorOptions = distinctFilterOptions(
    (data?.options.actors ?? []).map((actor) => ({
      key: actor.key,
      known: true,
      label:
        actor.key === "unknown"
          ? zh
            ? "未记录账号"
            : "Compte non enregistré"
          : actor.label || actor.key,
    })),
  );

  return (
    <div className={styles.workbench}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{zh ? "SACSI · 经营监督" : "SACSI · CONTRÔLE"}</p>
          <h1>{zh ? "操作审计" : "Journal des opérations"}</h1>
          <p className={styles.subtitle}>
            {zh
              ? "查清谁用哪个账号、做了什么，追溯当时的业务事实。"
              : "Retrouvez le compte utilisé, l’opération et les faits enregistrés au moment de la saisie."}
          </p>
        </div>
        <span className={styles.readOnly}>
          <ShieldCheck size={14} aria-hidden />
          {zh ? "只读历史 · 不改账" : "Historique en lecture seule"}
        </span>
      </header>

      <section
        className={styles.summary}
        aria-label={zh ? "当前筛选统计" : "Statistiques des résultats filtrés"}
      >
        {[
          [
            zh ? "匹配操作" : "Opérations",
            visibleData?.summary.total,
            zh ? "全部匹配记录，不是当前页" : "Tous les résultats, pas seulement cette page",
          ],
          [
            zh ? "已记录登录账号" : "Compte enregistré",
            visibleData?.summary.recorded,
            zh
              ? "当时的账号记录，不等于现场操作人"
              : "Compte enregistré, pas identité de la personne présente",
          ],
          [
            zh ? "缺少登录账号" : "Sans compte enregistré",
            visibleData
              ? visibleData.summary.missingIdentity + visibleData.summary.maintenance
              : undefined,
            visibleData
              ? zh
                ? `其中维护记录（无账号）${visibleData.summary.maintenance} 条`
                : `Dont ${visibleData.summary.maintenance} maintenances sans compte`
              : zh
                ? "按记录事实统计"
                : "Selon les faits enregistrés",
          ],
        ].map(([label, value, note]) => (
          <div className={styles.stat} key={label}>
            <p>{label}</p>
            <strong>
              {typeof value === "number" ? value.toLocaleString(zh ? "zh-CN" : "fr-FR") : "—"}
            </strong>
            <span>{note}</span>
          </div>
        ))}
      </section>

      {!lostAccess && (
        <form
          className={styles.filters}
          onSubmit={submit}
          aria-label={zh ? "审计筛选" : "Filtres de l’audit"}
        >
          <div className={styles.primaryFilters}>
            <label className={styles.search}>
              <span>{zh ? "搜索历史记录" : "Rechercher dans l’historique"}</span>
              <div>
                <Search size={15} aria-hidden />
                <input
                  name="search"
                  type="search"
                  maxLength={200}
                  value={draft.search}
                  onChange={(event) => field("search", event.target.value)}
                  placeholder={
                    zh ? "房号、账号、收据或请求号" : "Logement, compte, reçu ou requête"
                  }
                />
              </div>
            </label>
            <label>
              <span>{zh ? "开始日期" : "Du"}</span>
              <input
                name="dateFrom"
                type="date"
                value={draft.dateFrom}
                onChange={(event) => field("dateFrom", event.target.value)}
              />
            </label>
            <label>
              <span>{zh ? "结束日期" : "Au"}</span>
              <input
                name="dateTo"
                type="date"
                value={draft.dateTo}
                onChange={(event) => field("dateTo", event.target.value)}
              />
            </label>
            <button type="submit" className={styles.primaryButton}>
              {zh ? "查询" : "Rechercher"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void loadPage(parseAuditWorkbenchQuery())}
            >
              <RotateCcw size={13} aria-hidden />
              {zh ? "重置" : "Réinitialiser"}
            </button>
          </div>
          <details
            className={styles.moreFilters}
            open={Boolean(
              query.action || query.entityType || query.actor || query.channel || query.identity,
            )}
          >
            <summary>
              {zh ? "操作、模块与账号筛选" : "Filtres : opération, module et compte"}
              {activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </summary>
            <div className={styles.filterGrid}>
              <label>
                <span>{zh ? "操作" : "Opération"}</span>
                <select
                  name="action"
                  value={draft.action}
                  onChange={(event) => field("action", event.target.value)}
                >
                  <option value="">{zh ? "全部操作" : "Toutes les opérations"}</option>
                  {actionOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{zh ? "业务模块" : "Module"}</span>
                <select
                  name="entityType"
                  value={draft.entityType}
                  onChange={(event) => field("entityType", event.target.value)}
                >
                  <option value="">{zh ? "全部模块" : "Tous les modules"}</option>
                  {entityOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{zh ? "登录账号" : "Compte connecté"}</span>
                <select
                  name="actor"
                  value={draft.actor}
                  onChange={(event) => field("actor", event.target.value)}
                >
                  <option value="">{zh ? "全部账号" : "Tous les comptes"}</option>
                  {actorOptions.map((actor) => (
                    <option key={actor.key} value={actor.key}>
                      {actor.label}
                    </option>
                  ))}
                  {draft.actor &&
                    !data?.options.actors.some((actor) => actor.key === draft.actor) && (
                      <option value={draft.actor}>{draft.actor}</option>
                    )}
                </select>
              </label>
              <label>
                <span>{zh ? "录入渠道" : "Canal"}</span>
                <select
                  name="channel"
                  value={draft.channel}
                  onChange={(event) => field("channel", event.target.value)}
                >
                  <option value="">{zh ? "全部渠道" : "Tous les canaux"}</option>
                  {(
                    [
                      "sacsi_web",
                      "external_codex",
                      "explicit_user_authorized_maintenance",
                      "unknown",
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {auditChannelLabel(value, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{zh ? "身份记录" : "Identité enregistrée"}</span>
                <select
                  name="identity"
                  value={draft.identity}
                  onChange={(event) => field("identity", event.target.value)}
                >
                  <option value="">{zh ? "全部记录" : "Toutes les entrées"}</option>
                  {(
                    ["account_recorded", "missing_account", "maintenance_without_account"] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {auditIdentityLabel(value, locale)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <p className={styles.filterNote}>
            {zh
              ? "日期按阿比让时间；搜索最多 200 字。修改条件后点击查询，统计与导出均使用已生效的筛选。"
              : "Dates à l’heure d’Abidjan. Recherche : 200 caractères maximum. Validez les filtres pour actualiser les statistiques et l’export."}
          </p>
        </form>
      )}

      <div className={styles.scope}>
        <span>
          {zh
            ? "审计保留当时的账号记录，不自动证明实际操作人；经办人、收款人与登录账号分别记录。"
            : "L’audit conserve le compte enregistré, sans prouver l’identité de la personne présente. Responsable, encaisseur et compte de saisie restent distincts."}
        </span>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={!visibleData?.total || exportLoading}
          onClick={() => void exportAll()}
        >
          <ArrowDownToLine size={14} aria-hidden />
          {exportLoading
            ? zh
              ? "正在导出…"
              : "Export en cours…"
            : zh
              ? `导出全部筛选结果${visibleData ? ` · ${visibleData.total} 条` : ""}`
              : `Exporter tous les résultats${visibleData ? ` · ${visibleData.total}` : ""}`}
        </button>
      </div>
      {exportError > 0 && (
        <p role="alert" className={styles.error}>
          {errorText(exportError, zh)}
        </p>
      )}

      <div className={styles.grid}>
        <section
          className={styles.panel}
          aria-label={zh ? "操作记录" : "Opérations enregistrées"}
          aria-busy={loading}
        >
          <div className={styles.panelHeading}>
            <h2>{zh ? "操作记录" : "Opérations"}</h2>
            <span>
              {visibleData
                ? zh
                  ? `共 ${visibleData.total} 条 · 每页 30 条`
                  : `${visibleData.total} résultats · 30 par page`
                : "—"}
            </span>
          </div>
          <div role="status" aria-live="polite" className={loading ? styles.empty : styles.srOnly}>
            {loading
              ? zh
                ? "正在读取匹配记录…"
                : "Lecture des résultats…"
              : visibleData
                ? zh
                  ? `查询完成，共 ${visibleData.total} 条`
                  : `${visibleData.total} résultats chargés`
                : ""}
          </div>
          {(listError > 0 || lostAccess) && (
            <div className={styles.empty}>
              <p role="alert">{errorText(lostAccess ? 403 : listError, zh)}</p>
              {!lostAccess && listError !== 400 && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadPage(query, false)}
                >
                  {zh ? "重新读取" : "Réessayer"}
                </button>
              )}
            </div>
          )}
          {visibleData && visibleData.rows.length === 0 && (
            <div className={styles.empty}>
              <Search size={22} aria-hidden />
              <h3>{zh ? "没有匹配记录" : "Aucun résultat"}</h3>
              <p>
                {visibleData.total > 0
                  ? zh
                    ? "这一页超出结果范围，请返回第一页。"
                    : "Cette page dépasse les résultats. Revenez à la première page."
                  : zh
                    ? "试试缩小搜索文字，或调整日期和账号筛选。"
                    : "Essayez un autre texte, une autre période ou un autre compte."}
              </p>
              {visibleData.total > 0 && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadPage({ ...query, page: 1 })}
                >
                  {zh ? "回到第一页" : "Première page"}
                </button>
              )}
            </div>
          )}
          {visibleData && visibleData.rows.length > 0 && (
            <ol className={styles.recordList}>
              {visibleData.rows.map((log) => {
                const info = auditBusinessSummary(log, locale);
                const identity = auditIdentityStatus(log);
                return (
                  <li key={log.id} data-selected={selectedId === log.id || undefined}>
                    <button
                      type="button"
                      className={styles.recordButton}
                      aria-controls={detailId}
                      aria-expanded={selectedId === log.id}
                      onClick={(event) => void openDetail(log, event.currentTarget)}
                    >
                      <div className={styles.recordTop}>
                        <span className={styles.action}>
                          {auditActionLabel(log.action, locale)}
                        </span>
                        <time dateTime={log.created_at}>{displayTime(log.created_at, locale)}</time>
                      </div>
                      <div className={styles.recordMiddle}>
                        <strong>
                          {auditText(log.metadata?.unit_no) ||
                            auditText(log.entity_label) ||
                            auditEntityLabel(log.entity_type, locale)}
                        </strong>
                        <span>{info.paymentAmount}</span>
                      </div>
                      <p className={styles.actor}>{auditActorText(log, locale)}</p>
                      <div className={styles.recordBottom}>
                        <span>
                          {auditEntityLabel(log.entity_type, locale)} ·{" "}
                          {auditChannelLabel(auditChannel(log), locale)}
                        </span>
                        {identity !== "account_recorded" && (
                          <span className={styles.badge}>
                            {auditIdentityLabel(identity, locale)}
                          </span>
                        )}
                        <ChevronRight size={14} aria-hidden />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {visibleData && visibleData.total > 0 && (
            <footer className={styles.pagination}>
              <span>
                {zh
                  ? `第 ${Math.min((visibleData.page - 1) * 30 + 1, visibleData.total)}–${Math.min(visibleData.page * 30, visibleData.total)} 条`
                  : `${Math.min((visibleData.page - 1) * 30 + 1, visibleData.total)}–${Math.min(visibleData.page * 30, visibleData.total)} sur ${visibleData.total}`}
              </span>
              <nav aria-label={zh ? "审计分页" : "Pagination de l’audit"}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={zh ? "上一页" : "Page précédente"}
                  disabled={query.page <= 1}
                  onClick={() => void loadPage({ ...query, page: query.page - 1 })}
                >
                  <ArrowLeft size={15} aria-hidden />
                </button>
                <span>
                  {query.page} / {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={zh ? "下一页" : "Page suivante"}
                  disabled={query.page >= totalPages}
                  onClick={() => void loadPage({ ...query, page: query.page + 1 })}
                >
                  <ArrowRight size={15} aria-hidden />
                </button>
              </nav>
            </footer>
          )}
        </section>

        <section
          id={detailId}
          className={styles.inspector}
          aria-label={zh ? "历史操作预览" : "Aperçu de l’opération historique"}
          aria-busy={detailLoading}
          onKeyDown={(event) => {
            if (event.key === "Escape" && selectedId) {
              event.preventDefault();
              closeDetail();
            }
          }}
        >
          <div className={styles.panelHeading}>
            <h2 ref={detailHeading} tabIndex={-1}>
              {zh ? "历史操作详情" : "Détail historique"}
            </h2>
            {selectedId && (
              <button
                type="button"
                className={styles.iconButton}
                aria-label={zh ? "关闭操作详情" : "Fermer le détail"}
                onClick={closeDetail}
              >
                <X size={15} aria-hidden />
              </button>
            )}
          </div>
          {!selectedId && (
            <div className={styles.detailPlaceholder}>
              <ShieldCheck size={24} aria-hidden />
              <h3>{zh ? "选一条记录，查看当时的事实" : "Sélectionnez une opération"}</h3>
              <p>
                {zh
                  ? "收款、核销、身份依据和实际变更集中展示。技术记录默认折叠，手机同样可查。"
                  : "Consultez les faits, les affectations et l’identité enregistrée. Les données techniques restent repliées."}
              </p>
            </div>
          )}
          {detailLoading && (
            <p className={styles.empty} role="status">
              {zh ? "正在读取完整历史快照…" : "Lecture de l’état historique…"}
            </p>
          )}
          {detailError > 0 && (
            <div className={styles.empty}>
              <p role="alert">{errorText(detailError, zh)}</p>
              {selectedRow && ![401, 403].includes(detailError) && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void openDetail(selectedRow)}
                >
                  {zh ? "重试详情" : "Réessayer"}
                </button>
              )}
            </div>
          )}
          {detail && (
            <div className={styles.detailBody}>
              <p className={styles.detailTime}>
                <time dateTime={detail.created_at}>{displayTime(detail.created_at, locale)}</time> ·{" "}
                {auditEntityLabel(detail.entity_type, locale)}
              </p>
              <AuditBusinessDetail log={detail} locale={locale} />
              <details className={styles.technical}>
                <summary>
                  {zh ? "技术记录 · 原始历史 JSON" : "Données techniques · JSON historique"}
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      id: detail.id,
                      actor_id: detail.actor_id,
                      actor_email: detail.actor_email,
                      actor_role: detail.actor_role,
                      action: detail.action,
                      entity_type: detail.entity_type,
                      entity_id: detail.entity_id,
                      before: detail.before_data,
                      after: detail.after_data,
                      metadata: detail.metadata,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function AuditWorkbenchSkeleton({ locale }: { locale: Locale }) {
  return (
    <div className={styles.workbench} aria-busy="true">
      <div className={styles.heading}>
        <h1>{locale === "zh" ? "操作审计" : "Journal des opérations"}</h1>
      </div>
      <div className={styles.summary}>
        {[0, 1, 2].map((key) => (
          <div key={key} className={styles.stat}>
            <div className={styles.skeletonLine} />
            <div className={styles.skeletonValue} />
          </div>
        ))}
      </div>
      <div className={`${styles.panel} ${styles.empty}`} role="status">
        {locale === "zh" ? "正在读取审计记录…" : "Lecture du journal…"}
      </div>
    </div>
  );
}
