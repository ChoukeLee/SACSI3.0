"use server";

import { createClient } from "@/lib/supabase/server";
import { sortUnits } from "@/lib/utils";
import type { ExportDataType } from "./data-exchange-types";

function csvLine(fields: (string | number | null | undefined)[]): string {
  return fields.map(f => {
    const s = String(f ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(",");
}

function uniqueNonEmpty(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function fetchUnitMap(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await supabase.from("units").select("id, unit_no").in("id", ids);
  return new Map((data ?? []).map(u => [u.id, u.unit_no]));
}

async function fetchCustomerMap(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; phone?: string | null }>();
  const { data } = await supabase.from("customers").select("id, name, phone").in("id", ids);
  return new Map((data ?? []).map(c => [c.id, { name: c.name, phone: c.phone }]));
}

export async function exportData(type: ExportDataType, filters?: { dateFrom?: string; dateTo?: string; buildingId?: string }): Promise<string> {
  const supabase = await createClient();
  const rows: string[] = [];
  let header = "";

  switch (type) {
    case "units": {
      header = "房号,楼栋,楼层,类型,状态,面积,户型,家具,备注";
      let q = supabase.from("units").select("unit_no, building_id, floor_label, kind, status, area_sqm, layout, furnishing, notes").order("unit_no").limit(2000);
      const { data } = await q;
      rows.push(header);
      for (const u of sortUnits(data ?? [])) rows.push(csvLine([u.unit_no, u.building_id, u.floor_label, u.kind, u.status, u.area_sqm, u.layout, u.furnishing, u.notes]));
      break;
    }
    case "customers": {
      header = "姓名,电话,性别,证件类型,备注,黑名单,创建时间";
      const { data } = await supabase.from("customers").select("name, phone, gender, document_type, notes, is_blacklisted, created_at").order("name").limit(2000);
      rows.push(header);
      for (const c of (data ?? [])) rows.push(csvLine([c.name, c.phone, c.gender, c.document_type, c.notes, c.is_blacklisted ? "是" : "否", c.created_at?.slice(0, 10)]));
      break;
    }
    case "daily_bookings": {
      header = "房号,客户,电话,入住日期,离店日期,模式,状态,金额,备注";
      const { data } = await supabase.from("daily_bookings").select("id, unit_id, customer_id, check_in, check_out, checkout_mode, status, total_amount_xof, notes").order("check_in", { ascending: false }).limit(1000);
      if (data) {
        const [uM, cM] = await Promise.all([
          fetchUnitMap(supabase, uniqueNonEmpty(data.map(b => b.unit_id))),
          fetchCustomerMap(supabase, uniqueNonEmpty(data.map(b => b.customer_id))),
        ]);
        rows.push(header);
        for (const b of data) rows.push(csvLine([uM.get(b.unit_id) ?? "", cM.get(b.customer_id ?? "")?.name ?? "", cM.get(b.customer_id ?? "")?.phone ?? "", b.check_in, b.check_out, b.checkout_mode, b.status, b.total_amount_xof, b.notes]));
      }
      break;
    }
    case "lease_contracts": {
      header = "房号,客户,电话,合同号,开始日期,结束日期,月租,押金,状态";
      const { data } = await supabase.from("lease_contracts").select("*").order("start_date", { ascending: false }).limit(1000);
      if (data) {
        const [uM, cM] = await Promise.all([
          fetchUnitMap(supabase, uniqueNonEmpty(data.map(l => l.unit_id))),
          fetchCustomerMap(supabase, uniqueNonEmpty(data.map(l => l.customer_id))),
        ]);
        rows.push(header);
        for (const l of data) rows.push(csvLine([uM.get(l.unit_id) ?? "", cM.get(l.customer_id ?? "")?.name ?? "", cM.get(l.customer_id ?? "")?.phone ?? "", l.contract_no, l.start_date, l.expected_end_date, l.monthly_rent_xof, l.deposit_amount_xof, l.status]));
      }
      break;
    }
    case "sale_contracts": {
      header = "房号,买方,电话,合同号,总价,签约日期,状态,过户状态";
      const { data } = await supabase.from("sale_contracts").select("*").order("signed_date", { ascending: false }).limit(1000);
      if (data) {
        const [uM, cM] = await Promise.all([
          fetchUnitMap(supabase, uniqueNonEmpty(data.map(s => s.unit_id))),
          fetchCustomerMap(supabase, uniqueNonEmpty(data.map(s => s.customer_id))),
        ]);
        rows.push(header);
        for (const s of data) rows.push(csvLine([uM.get(s.unit_id) ?? "", cM.get(s.customer_id ?? "")?.name ?? "", cM.get(s.customer_id ?? "")?.phone ?? "", s.contract_no, s.total_amount_xof, s.signed_date, s.status, s.transfer_status]));
      }
      break;
    }
    case "receivables": {
      header = "业务类型,房号,客户,应收金额,实收金额,到期日,状态,标题";
      const { data } = await supabase.from("receivables").select("*").neq("status", "cancelled").order("due_date", { ascending: false }).limit(2000);
      if (data) {
        const [uM, cM] = await Promise.all([
          fetchUnitMap(supabase, uniqueNonEmpty(data.map(r => r.unit_id))),
          fetchCustomerMap(supabase, uniqueNonEmpty(data.map(r => r.customer_id))),
        ]);
        rows.push(header);
        for (const r of data) rows.push(csvLine([r.source_type, uM.get(r.unit_id ?? "") ?? "", cM.get(r.customer_id ?? "")?.name ?? "", r.amount_xof, r.paid_amount_xof, r.due_date, r.status, r.title]));
      }
      break;
    }
    case "payments": {
      header = "收款日期,房号,客户,金额,收据号,来源类型";
      const { data } = await supabase.from("payments").select("*").order("payment_date", { ascending: false }).limit(2000);
      if (data) {
        const [uM, cM] = await Promise.all([
          fetchUnitMap(supabase, uniqueNonEmpty(data.map(p => p.unit_id))),
          fetchCustomerMap(supabase, uniqueNonEmpty(data.map(p => p.customer_id))),
        ]);
        rows.push(header);
        for (const p of data) rows.push(csvLine([p.payment_date, uM.get(p.unit_id ?? "") ?? "", cM.get(p.customer_id ?? "")?.name ?? "", p.amount, p.receipt_no, p.source_type]));
      }
      break;
    }
  }

  return rows.join("\n");
}
