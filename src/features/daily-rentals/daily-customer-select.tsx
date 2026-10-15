"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { decodeCustomerSearch } from "./calendar-context-model";
import type { CustomerSummary } from "./customer-summary";
import { dailyBookingAgentSortValue, isDailyBookingAgentName } from "./daily-booking-agents";
import { controlClass } from "@/components/ui/operational";

/** This remains the existing booking-agent choice, not an unrestricted guest picker. */
export function DailyCustomerSelect({
  buildingId,
  value,
  onChange,
  locale,
  placeholder,
}: {
  buildingId: string | null;
  value: string;
  onChange: (id: string) => void;
  locale: Locale;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [selected, setSelected] = useState<CustomerSummary>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setRows([]);
    setSelected(undefined);
    setPage(1);
    onChange("");
  }, [buildingId, onChange]);
  useEffect(() => {
    setRows([]);
    setHasMore(false);
    setFailed(false);
    if (!buildingId) {
      setPending(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setPending(true);
    const expected = { buildingId, query: query.trim().normalize("NFC"), page };
    const timer = window.setTimeout(
      () => {
        fetch(
          `/api/daily-rentals/calendar/customers?${new URLSearchParams({ ...expected, page: String(page) })}`,
          { signal: controller.signal, cache: "no-store" },
        )
          .then(async (response) => {
            if (!response.ok) throw new Error("DailyCustomersUnavailable");
            return decodeCustomerSearch(await response.json(), expected);
          })
          .then((result) => {
            if (!active) return;
            setRows(
              result.rows
                .filter((customer) => isDailyBookingAgentName(customer.name))
                .sort(
                  (a, b) => dailyBookingAgentSortValue(a.name) - dailyBookingAgentSortValue(b.name),
                ),
            );
            setHasMore(result.hasMore);
            setPending(false);
          })
          .catch(() => {
            if (active) {
              setSelected(undefined);
              onChange("");
              setFailed(true);
              setPending(false);
            }
          });
      },
      query ? 200 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [buildingId, query, page, retry, onChange]);
  const options =
    selected && !rows.some((row) => row.id === selected.id) ? [selected, ...rows] : rows;
  return (
    <div className="space-y-2">
      <input
        className={controlClass}
        aria-label={locale === "zh" ? "搜索日租经办人" : "Rechercher un responsable"}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
        maxLength={80}
        placeholder={locale === "zh" ? "搜索姓名或电话" : "Nom ou téléphone"}
        disabled={!buildingId}
      />
      <select
        className={controlClass}
        aria-label={placeholder}
        value={value}
        disabled={!buildingId || pending || failed}
        onChange={(event) => {
          onChange(event.target.value);
          setSelected(options.find((row) => row.id === event.target.value));
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((customer) => (
          <option key={customer.id} value={customer.id} disabled={customer.is_blacklisted}>
            {customer.name}
            {customer.phone ? ` (${customer.phone})` : ""}
            {customer.is_blacklisted ? (locale === "zh" ? " · 黑名单" : " · Liste noire") : ""}
            {customer.has_active_lease_contract
              ? locale === "zh"
                ? " · 有长租合同"
                : " · Bail actif"
              : ""}
            {customer.has_active_sale_contract
              ? locale === "zh"
                ? " · 有出售合同"
                : " · Vente active"
              : ""}
          </option>
        ))}
      </select>
      {pending && (
        <p role="status" className="text-xs text-muted-foreground">
          {locale === "zh" ? "正在核验可选经办人…" : "Vérification des responsables…"}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {locale === "zh" ? "经办人读取失败，不能视为没有候选。" : "Responsables indisponibles."}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            {locale === "zh" ? "重试" : "Réessayer"}
          </button>
        </p>
      )}
      {(page > 1 || hasMore) && (
        <div className="flex gap-3 text-xs">
          <button
            type="button"
            disabled={pending || page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {locale === "zh" ? "上一页" : "Précédent"}
          </button>
          <span>{page}</span>
          <button
            type="button"
            disabled={pending || !hasMore}
            onClick={() => setPage((value) => value + 1)}
          >
            {locale === "zh" ? "下一页" : "Suivant"}
          </button>
        </div>
      )}
    </div>
  );
}
