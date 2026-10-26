"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import { statusDisplayLabel } from "@/lib/display-labels";
import { isFutureLease, leaseStatusLabel } from "@/lib/lease-timing";
import { conditionLabel } from "./operational-position";
import { getUnitAuditLogs, type UnitAuditLogEntry } from "./actions";
import {
  decodeUnitBusinessContext,
  type UnitBusinessContext,
  type UnitWorkbenchBuilding,
  type UnitWorkbenchRecord,
} from "./unit-workbench-model";
import styles from "./unit-workbench.module.css";

export function UnitBusinessRelations({
  record,
  building,
  locale,
  returnTo,
}: {
  record: UnitWorkbenchRecord;
  building: UnitWorkbenchBuilding;
  locale: Locale;
  returnTo: string;
}) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: UnitBusinessContext | null;
    error: boolean;
  } | null>(null);
  const zh = locale === "zh";
  const today = new Date().toISOString().slice(0, 10);
  const key = `${record.unit.id}:${building.id}:${page}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      unit: record.unit.id,
      building: building.id,
      project: building.project_id,
      page: String(page),
    });
    let active = true;
    fetch(`/api/units/business-context?${params}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("AssetBusinessUnavailable");
        const data = decodeUnitBusinessContext(await response.json(), record.unit.id, page);
        if (data.buildingId !== building.id || data.projectId !== building.project_id)
          throw new Error("AssetBusinessScopeMismatch");
        if (active) setResult({ key, data, error: false });
      })
      .catch(() => {
        if (active) setResult({ key, data: null, error: true });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [record.unit.id, building.id, building.project_id, page, retry, key]);
  const current = result?.key === key ? result : null;
  if (!current)
    return (
      <p className={styles.note} aria-live="polite">
        {zh
          ? "正在读取这项资产的明确业务关联…"
          : "Chargement des relations explicites de cet actif…"}
      </p>
    );
  if (current.error || !current.data)
    return (
      <div role="alert">
        <p className={styles.note}>
          {zh
            ? "业务关联读取失败，不能视为没有合同或住客。"
            : "Relations indisponibles ; cela ne signifie pas absence de contrat ou de client."}
        </p>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => setRetry((value) => value + 1)}
        >
          {zh ? "重试" : "Réessayer"}
        </button>
      </div>
    );
  const data = current.data;
  return (
    <section className={styles.section}>
      <h3>
        {zh ? "合同与入住关系" : "Contrats et séjours"} · {data.total}
      </h3>
      <p className={styles.note}>
        {zh
          ? "按长租、出售、日租分组，各组内最新记录优先；承租人、买方、实际住客、代订经办人分别标注，不用当前住户代替历史关系。"
          : "Groupés par bail, vente et séjour, du plus récent au plus ancien dans chaque groupe. Locataire, acquéreur, client réel et intermédiaire restent distincts."}
      </p>
      {!data.relations.length ? (
        <p className={styles.callout}>
          {zh
            ? "当前权限下未读取到明确业务关系。无关联记录不证明资产可出租。"
            : "Aucune relation explicite visible. Cela ne prouve pas que le bien est disponible à louer."}
        </p>
      ) : (
        data.relations.map((row) => {
          const contractLink =
            row.type === "lease" || row.type === "sale"
              ? buildWorkbenchRecordHref({
                  workspace: row.type === "lease" ? "leases" : "sales",
                  id: row.id,
                  locale,
                  project: building.project_id,
                  building: building.id,
                  returnTo,
                })
              : null;
          const customerLink = row.customerId
            ? buildWorkbenchRecordHref({
                workspace: "customers",
                id: row.customerId,
                locale,
                project: building.project_id,
                returnTo,
              })
            : null;
          const agentLink = row.agentId
            ? buildWorkbenchRecordHref({
                workspace: "customers",
                id: row.agentId,
                locale,
                project: building.project_id,
                returnTo,
              })
            : null;
          const partyLabel =
            row.type === "lease"
              ? zh
                ? "承租人"
                : "Locataire"
              : row.type === "sale"
                ? zh
                  ? "合同买方"
                  : "Acquéreur"
                : zh
                  ? "实际住客"
                  : "Client réel";
          return (
            <article key={`${row.type}-${row.id}`} className={styles.relation}>
              <div className={styles.relationTop}>
                <span>
                  {row.type === "lease"
                    ? zh
                      ? "长租合同"
                      : "Bail"
                    : row.type === "sale"
                      ? zh
                        ? "出售合同"
                        : "Vente"
                      : zh
                        ? "日租订单"
                        : "Séjour"}
                </span>
                <span>
                  {row.type === "lease"
                    ? `${leaseStatusLabel({ status: row.status, start_date: row.start }, today, locale, statusDisplayLabel(row.status, locale))}${isFutureLease({ status: row.status, start_date: row.start }, today) ? ` · ${row.start}` : ""}`
                    : statusDisplayLabel(row.status, locale)}
                </span>
              </div>
              <span className={styles.sub}>{row.contractNo ?? (zh ? "订单" : "Réservation")}</span>
              <span className={styles.sub}>
                {row.start ?? "—"}
                {row.type !== "sale"
                  ? ` → ${row.end ? `${row.endDateKind === "actual" ? (zh ? "实际 " : "effectif ") : zh ? "预计 " : "prévu "}${row.end}` : zh ? "结束日期未定" : "Fin non précisée"}`
                  : ""}
              </span>
              <p className={styles.note}>
                {partyLabel} ·{" "}
                {row.customerName ||
                  (zh ? "身份待补或不可见" : "Identité manquante ou non visible")}
              </p>
              {row.type === "daily" ? (
                <p className={styles.note}>
                  {zh ? "代订 / 经办" : "Intermédiaire"} ·{" "}
                  {row.agentName || (zh ? "身份待补或不可见" : "Identité manquante ou non visible")}
                </p>
              ) : null}
              <div className={styles.actions}>
                {contractLink ? (
                  <Link className={styles.inlineLink} href={contractLink} prefetch={false}>
                    {zh ? "打开合同" : "Ouvrir le contrat"}
                    <ArrowUpRight size={11} />
                  </Link>
                ) : null}
                {customerLink && row.customerName ? (
                  <Link className={styles.inlineLink} href={customerLink} prefetch={false}>
                    {partyLabel}
                    {zh ? "档案" : " · dossier"}
                    <ArrowUpRight size={11} />
                  </Link>
                ) : null}
                {agentLink && row.agentName ? (
                  <Link className={styles.inlineLink} href={agentLink} prefetch={false}>
                    {zh ? "经办人档案" : "Dossier de l’intermédiaire"}
                    <ArrowUpRight size={11} />
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })
      )}
      {data.total > 30 ? (
        <div className={styles.footer}>
          <span>
            {(page - 1) * 30 + 1}–{Math.min(page * 30, data.total)} / {data.total}
          </span>
          <div className={styles.pages}>
            <button
              className={styles.secondary}
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {zh ? "上一页" : "Précédent"}
            </button>
            <button
              className={styles.secondary}
              disabled={page * 30 >= data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              {zh ? "下一页" : "Suivant"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function UnitStatusHistory({ id, locale }: { id: string; locale: Locale }) {
  const [state, setState] = useState<{ rows: UnitAuditLogEntry[]; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const zh = locale === "zh";
  useEffect(() => {
    let active = true;
    setState(null);
    getUnitAuditLogs(id)
      .then((rows) => {
        if (active)
          setState({
            rows: rows.filter(
              (row) =>
                row.metadata.previous_status !== row.metadata.new_status ||
                row.metadata.previous_condition !== row.metadata.new_condition,
            ),
            error: false,
          });
      })
      .catch(() => {
        if (active) setState({ rows: [], error: true });
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  if (!state)
    return (
      <p className={styles.note} aria-live="polite">
        {zh ? "正在读取状态历史…" : "Chargement de l’historique…"}
      </p>
    );
  if (state.error)
    return (
      <div role="alert">
        <p className={styles.note}>
          {zh
            ? "状态历史读取失败，不能确认是否存在记录。"
            : "Historique indisponible ; l’absence d’enregistrements n’est pas confirmée."}
        </p>
        <button
          className={styles.secondary}
          type="button"
          onClick={() => setRetry((value) => value + 1)}
        >
          {zh ? "重试" : "Réessayer"}
        </button>
      </div>
    );
  return (
    <section className={styles.section}>
      <h3>{zh ? "运行条件变更" : "Évolution de l’état opérationnel"}</h3>
      <p className={styles.note}>
        {zh
          ? "这里只显示该资产的状态变更记录，非完整合同、产权或财务历史。"
          : "Uniquement les changements d’état de cet actif, pas l’historique contractuel, foncier ou financier complet."}
      </p>
      {!state.rows.length ? (
        <p className={styles.callout}>
          {zh ? "暂无可见的状态变更记录。" : "Aucun changement d’état visible."}
        </p>
      ) : (
        <ol className={styles.history}>
          {state.rows.slice((page - 1) * 25, page * 25).map((row) => {
            const conditionChanged =
              typeof row.metadata.previous_condition === "string" &&
              typeof row.metadata.new_condition === "string";
            return (
              <li key={row.id}>
                <time dateTime={row.created_at}>
                  {new Date(row.created_at).toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR", {
                    timeZone: "Africa/Abidjan",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {conditionChanged
                  ? `${conditionLabel(row.metadata.previous_condition as string, locale)} → ${conditionLabel(row.metadata.new_condition as string, locale)}`
                  : `${statusDisplayLabel(String(row.metadata.previous_status ?? ""), locale)} → ${statusDisplayLabel(String(row.metadata.new_status ?? ""), locale)}`}
              </li>
            );
          })}
        </ol>
      )}
      {state.rows.length > 25 ? (
        <div className={styles.footer}>
          <span>
            {page} / {Math.ceil(state.rows.length / 25)}
          </span>
          <div className={styles.pages}>
            <button
              className={styles.secondary}
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {zh ? "上一页" : "Précédent"}
            </button>
            <button
              className={styles.secondary}
              disabled={page * 25 >= state.rows.length}
              onClick={() => setPage((value) => value + 1)}
            >
              {zh ? "下一页" : "Suivant"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
