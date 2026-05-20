"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { sortUnits } from "@/lib/utils";
import type { SearchResult, SearchResultType, SearchResults } from "./search-types";
import type { UserRole } from "@/lib/auth";

const MAX_PER_TYPE = 6;

const PERMITTED_TYPES: Record<UserRole, SearchResultType[]> = {
  admin:       ["customer","unit","daily_booking","lease","sale","receivable","payment","document"],
  boss:        ["customer","unit","daily_booking","lease","sale","receivable","payment","document"],
  finance:     ["customer","unit","receivable","payment","document"],
  front_desk:  ["customer","unit","daily_booking","document"],
};

function result(
  type: SearchResultType, title: string, subtitle: string, desc: string,
  href: string, priority: number, sourceId: string, unitLabel = "", customerName = "",
  date = "", amount = 0, status = "",
): SearchResult {
  return { id: `${type}_${sourceId}`, type, title, subtitle, description: desc, href, priority,
    sourceId, unitLabel, customerName, date, amount, status };
}

function exactBonus(q: string, ...fields: (string | null | undefined)[]): number {
  const lower = q.toLowerCase();
  for (const f of fields) {
    if (f && f.toLowerCase() === lower) return 3;
    if (f && f.toLowerCase().includes(lower)) return 2;
  }
  return 1;
}

function matches(q: string, ...fields: (string | number | null | undefined)[]): boolean {
  const lower = q.toLowerCase();
  return fields.some((f) => String(f ?? "").toLowerCase().includes(lower));
}

function uniqueNonEmpty(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

async function fetchUnits(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; unit_no: string }>();
  const { data } = await supabase.from("units").select("id, unit_no").in("id", ids);
  return new Map((data ?? []).map((u) => [u.id, u]));
}

async function fetchCustomers(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; name: string; phone: string | null }>();
  const { data } = await supabase.from("customers").select("id, name, phone").in("id", ids);
  return new Map((data ?? []).map((c) => [c.id, c]));
}

export async function globalSearch(query: string): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < 2) return { query: q, results: [], totalCount: 0 };

  const user = await getCurrentUser();
  const role = (user?.role ?? "front_desk") as UserRole;
  const permitted = PERMITTED_TYPES[role] ?? [];

  const supabase = await createClient();
  const results: SearchResult[] = [];
  const like = `%${q}%`;

  // ── Customers ──
  if (permitted.includes("customer")) {
    const { data } = await supabase.from("customers").select("id, name, phone").or(`name.ilike.${like},phone.ilike.${like}`).order("name").limit(MAX_PER_TYPE);
    for (const c of (data ?? [])) {
      results.push(result("customer", c.name, c.phone ?? "", `客户 · ${c.phone ?? "无电话"}`, `/customers/${c.id}`, exactBonus(q, c.name, c.phone), c.id, "", c.name));
    }
  }

  // ── Units ──
  if (permitted.includes("unit")) {
    const { data } = await supabase.from("units").select("id, unit_no, floor_label, kind, status").or(`unit_no.ilike.${like},floor_label.ilike.${like}`).limit(200);
    for (const u of sortUnits(data ?? []).slice(0, MAX_PER_TYPE)) {
      results.push(result("unit", u.unit_no, `${u.floor_label}F · ${u.kind}`, `房源 · ${u.status}`, `/units/${u.id}`, exactBonus(q, u.unit_no), u.id, u.unit_no));
    }
  }

  // ── Daily bookings ──
  if (permitted.includes("daily_booking")) {
    const { data } = await supabase.from("daily_bookings").select("id, unit_id, customer_id, check_in, status, total_amount_xof").order("check_in", { ascending: false }).limit(300);
    if (data) {
      const [uMap, cMap] = await Promise.all([
        fetchUnits(supabase, uniqueNonEmpty(data.map(b => b.unit_id))),
        fetchCustomers(supabase, uniqueNonEmpty(data.map(b => b.customer_id))),
      ]);
      for (const b of data) {
        const unitNo = uMap.get(b.unit_id)?.unit_no ?? "";
        const customer = cMap.get(b.customer_id ?? "");
        const cName = customer?.name ?? "";
        if (!matches(q, unitNo, cName, customer?.phone, b.check_in, b.status, b.total_amount_xof)) continue;
        results.push(result("daily_booking", `日租 ${unitNo} ${b.check_in}`, cName || b.customer_id?.slice(0, 8) || "", `日租 · ${b.status}`, "/daily-rentals", exactBonus(q, unitNo, cName), b.id, unitNo, cName, b.check_in, Number(b.total_amount_xof), b.status));
        if (results.filter(r => r.type === "daily_booking").length >= MAX_PER_TYPE) break;
      }
    }
  }

  // ── Lease contracts ──
  if (permitted.includes("lease")) {
    const { data } = await supabase.from("lease_contracts").select("id, unit_id, customer_id, contract_no, start_date, expected_end_date, status, monthly_rent_xof").order("start_date", { ascending: false }).limit(300);
    if (data) {
      const [uMap, cMap] = await Promise.all([
        fetchUnits(supabase, uniqueNonEmpty(data.map(l => l.unit_id))),
        fetchCustomers(supabase, uniqueNonEmpty(data.map(l => l.customer_id))),
      ]);
      for (const l of data) {
        const unitNo = uMap.get(l.unit_id)?.unit_no ?? "";
        const customer = cMap.get(l.customer_id ?? "");
        const cName = customer?.name ?? "";
        if (!matches(q, l.contract_no, unitNo, cName, customer?.phone, l.start_date, l.expected_end_date, l.status, l.monthly_rent_xof)) continue;
        results.push(result("lease", `长租 ${l.contract_no}`, `${unitNo} · ${cName}`, `长租 · ${l.status}`, "/leases", exactBonus(q, l.contract_no, unitNo, cName), l.id, unitNo, cName, l.start_date, Number(l.monthly_rent_xof), l.status));
        if (results.filter(r => r.type === "lease").length >= MAX_PER_TYPE) break;
      }
    }
  }

  // ── Sale contracts ──
  if (permitted.includes("sale")) {
    const { data } = await supabase.from("sale_contracts").select("id, unit_id, customer_id, contract_no, signed_date, status, total_amount_xof").order("signed_date", { ascending: false }).limit(300);
    if (data) {
      const [uMap, cMap] = await Promise.all([
        fetchUnits(supabase, uniqueNonEmpty(data.map(s => s.unit_id))),
        fetchCustomers(supabase, uniqueNonEmpty(data.map(s => s.customer_id))),
      ]);
      for (const s of data) {
        const unitNo = uMap.get(s.unit_id)?.unit_no ?? "";
        const customer = cMap.get(s.customer_id ?? "");
        const cName = customer?.name ?? "";
        if (!matches(q, s.contract_no, unitNo, cName, customer?.phone, s.signed_date, s.status, s.total_amount_xof)) continue;
        results.push(result("sale", `出售 ${s.contract_no}`, `${unitNo} · ${cName}`, `出售 · ${s.status}`, "/sales", exactBonus(q, s.contract_no, unitNo, cName), s.id, unitNo, cName, s.signed_date, Number(s.total_amount_xof), s.status));
        if (results.filter(r => r.type === "sale").length >= MAX_PER_TYPE) break;
      }
    }
  }

  // ── Receivables ──
  if (permitted.includes("receivable")) {
    const { data } = await supabase.from("receivables").select("id, unit_id, customer_id, title, due_date, status, amount_xof, paid_amount_xof, source_type").neq("status", "cancelled").order("due_date", { ascending: false }).limit(500);
    if (data) {
      const [uMap, cMap] = await Promise.all([
        fetchUnits(supabase, uniqueNonEmpty(data.map(r => r.unit_id))),
        fetchCustomers(supabase, uniqueNonEmpty(data.map(r => r.customer_id))),
      ]);
      for (const r of data) {
        const unitNo = uMap.get(r.unit_id ?? "")?.unit_no ?? "";
        const customer = cMap.get(r.customer_id ?? "");
        const cName = customer?.name ?? "";
        if (!matches(q, r.title, unitNo, cName, customer?.phone, r.due_date, r.status, r.amount_xof, r.source_type)) continue;
        results.push(result("receivable", `应收 ${r.title}`, `${unitNo} · ${cName}`, `${r.status} · ${r.source_type}`, "/finance", exactBonus(q, r.title, unitNo, cName), r.id, unitNo, cName, r.due_date, Number(r.amount_xof), r.status));
        if (results.filter(item => item.type === "receivable").length >= MAX_PER_TYPE) break;
      }
    }
  }

  // ── Payments ──
  if (permitted.includes("payment")) {
    const { data } = await supabase.from("payments").select("id, unit_id, customer_id, amount, payment_date, receipt_no, source_type").order("payment_date", { ascending: false }).limit(500);
    if (data) {
      const [uMap, cMap] = await Promise.all([
        fetchUnits(supabase, uniqueNonEmpty(data.map(p => p.unit_id))),
        fetchCustomers(supabase, uniqueNonEmpty(data.map(p => p.customer_id))),
      ]);
      for (const p of data) {
        const unitNo = uMap.get(p.unit_id ?? "")?.unit_no ?? "";
        const customer = cMap.get(p.customer_id ?? "");
        const cName = customer?.name ?? "";
        if (!matches(q, p.receipt_no, unitNo, cName, customer?.phone, p.payment_date, p.amount, p.source_type)) continue;
        results.push(result("payment", `收款 ${p.payment_date}`, `${unitNo} · ${cName}`, `收款 · ${p.receipt_no ?? ""}`, "/finance", exactBonus(q, p.receipt_no), p.id, unitNo, cName, p.payment_date, Number(p.amount), "paid"));
        if (results.filter(item => item.type === "payment").length >= MAX_PER_TYPE) break;
      }
    }
  }

  // Sort: priority desc, then date desc
  results.sort((a, b) => b.priority - a.priority || b.date.localeCompare(a.date));
  return { query: q, results, totalCount: results.length };
}
