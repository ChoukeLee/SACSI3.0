"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import type { ImportDataType, ImportResult, ImportRow, ImportSubmitResult } from "./data-exchange-types";

function parseCsv(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return rows;
  const headers = parseLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = (vals[j] ?? "").trim(); });
    if (Object.values(row).some(v => v)) rows.push(row);
  }
  return rows;
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function ok(row: number, data: Record<string, string>): ImportRow {
  return { row, data, status: "ok", message: "OK" };
}
function warn(row: number, data: Record<string, string>, msg: string): ImportRow {
  return { row, data, status: "warning", message: msg };
}
function err(row: number, data: Record<string, string>, msg: string): ImportRow {
  return { row, data, status: "error", message: msg };
}

export async function previewImport(type: ImportDataType, csvText: string): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { rows: [], okCount: 0, warnCount: 0, errCount: 0, canSubmit: false };

  const supabase = await createClient();
  const validated: ImportRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    switch (type) {
      case "customers": {
        if (!row["姓名"]) { validated.push(err(rowNum, row, "姓名必填")); break; }
        if (row["电话"]) {
          const { data: existing } = await supabase.from("customers").select("id, name").eq("phone", row["电话"]).limit(1);
          if (existing && existing.length > 0) validated.push(warn(rowNum, row, `电话 ${row["电话"]} 已存在: ${existing[0].name}`));
          else validated.push(ok(rowNum, row));
        } else validated.push(ok(rowNum, row));
        break;
      }
      case "units": {
        if (!row["房号"]) { validated.push(err(rowNum, row, "房号必填")); break; }
        if (!row["类型"]) { validated.push(err(rowNum, row, "类型必填")); break; }
        const validStatuses = ["available","reserved","daily_occupied","cleaning_pending","leased","sold","maintenance","locked"];
        if (row["状态"] && !validStatuses.includes(row["状态"])) { validated.push(err(rowNum, row, `状态 ${row["状态"]} 非法`)); break; }
        const { data: existing } = await supabase.from("units").select("id").eq("unit_no", row["房号"]).limit(1);
        if (existing && existing.length > 0) validated.push(err(rowNum, row, `房号 ${row["房号"]} 已存在`));
        else validated.push(ok(rowNum, row));
        break;
      }
      case "receivables": {
        const amt = parseFloat(row["应收金额"] ?? "0");
        if (!amt || amt <= 0) { validated.push(err(rowNum, row, "金额必须 > 0")); break; }
        if (!row["到期日"] || isNaN(Date.parse(row["到期日"]))) { validated.push(err(rowNum, row, "到期日格式非法")); break; }
        const hasCustomer = !!row["客户姓名"];
        const hasUnit = !!row["房号"];
        if (!hasCustomer && !hasUnit) { validated.push(warn(rowNum, row, "客户和房号至少填一个")); }
        else validated.push(ok(rowNum, row));
        break;
      }
      case "payments": {
        const amt = parseFloat(row["金额"] ?? "0");
        if (!amt || amt <= 0) { validated.push(err(rowNum, row, "金额必须 > 0")); break; }
        if (!row["收款日期"] || isNaN(Date.parse(row["收款日期"]))) { validated.push(err(rowNum, row, "收款日期格式非法")); break; }
        if (!row["客户姓名"] && !row["房号"]) { validated.push(err(rowNum, row, "客户和房号至少填写一个")); break; }
        validated.push(ok(rowNum, row));
        break;
      }
      case "lease_contracts": {
        if (!row["客户姓名"]) { validated.push(err(rowNum, row, "客户姓名必填")); break; }
        if (!row["房号"]) { validated.push(err(rowNum, row, "房号必填")); break; }
        if (!row["开始日期"]) { validated.push(err(rowNum, row, "开始日期必填")); break; }
        if (!row["结束日期"]) { validated.push(err(rowNum, row, "结束日期必填")); break; }
        const rent = parseFloat(row["月租"] ?? "0");
        if (!rent || rent <= 0) { validated.push(err(rowNum, row, "月租必须 > 0")); break; }
        // Check unit is not sold
        const { data: unit } = await supabase.from("units").select("id, status").eq("unit_no", row["房号"]).limit(1);
        if (!unit || unit.length === 0) { validated.push(err(rowNum, row, `房源 ${row["房号"]} 不存在`)); break; }
        if (unit[0].status === "sold") { validated.push(err(rowNum, row, `房源 ${row["房号"]} 已售`)); break; }
        if (unit[0].status === "leased") { validated.push(warn(rowNum, row, `房源 ${row["房号"]} 已有长租`)); break; }
        validated.push(ok(rowNum, row));
        break;
      }
      case "sale_contracts": {
        if (!row["买方姓名"]) { validated.push(err(rowNum, row, "买方姓名必填")); break; }
        if (!row["房号"]) { validated.push(err(rowNum, row, "房号必填")); break; }
        const total = parseFloat(row["总价"] ?? "0");
        if (!total || total <= 0) { validated.push(err(rowNum, row, "总价必须 > 0")); break; }
        if (!row["签约日期"]) { validated.push(err(rowNum, row, "签约日期必填")); break; }
        const { data: unit } = await supabase.from("units").select("id, status").eq("unit_no", row["房号"]).limit(1);
        if (!unit || unit.length === 0) { validated.push(err(rowNum, row, `房源 ${row["房号"]} 不存在`)); break; }
        if (unit[0].status === "sold") { validated.push(err(rowNum, row, `房源 ${row["房号"]} 已售`)); break; }
        validated.push(ok(rowNum, row));
        break;
      }
      default:
        validated.push(ok(rowNum, row));
    }
  }

  const okCount = validated.filter(r => r.status === "ok").length;
  const warnCount = validated.filter(r => r.status === "warning").length;
  const errCount = validated.filter(r => r.status === "error").length;
  return { rows: validated, okCount, warnCount, errCount, canSubmit: errCount === 0 && validated.length > 0 };
}

export async function submitImport(type: ImportDataType, csvText: string): Promise<ImportSubmitResult> {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const rows = parseCsv(csvText);
  const messages: string[] = [];
  let inserted = 0, errors = 0;

  const validation = await previewImport(type, csvText);
  if (!validation.canSubmit) {
    return {
      success: false,
      inserted: 0,
      errors: validation.errCount || 1,
      messages: validation.errCount > 0
        ? validation.rows.filter((row) => row.status === "error").map((row) => `行${row.row}: ${row.message}`)
        : ["导入内容未通过预览校验，已阻止写入。"],
    };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      switch (type) {
        case "customers": {
          const { error } = await supabase.from("customers").insert({
            name: row["姓名"], phone: row["电话"] || null, gender: row["性别"] || null,
            document_type: row["证件类型"] || null, notes: row["备注"] || null,
          });
          if (error) { errors++; messages.push(`行${i + 2}: ${error.message}`); } else inserted++;
          break;
        }
        case "units": {
          const { data: bldg } = await supabase.from("buildings").select("id").eq("code", "SASCI11").single();
          if (!bldg?.id) {
            errors++;
            messages.push(`行${i + 2}: 未找到楼栋 SASCI11，无法导入房源`);
            break;
          }
          const { error } = await supabase.from("units").insert({
            building_id: bldg.id, unit_no: row["房号"],
            floor_label: row["楼层"] || "1", kind: row["类型"] || "apartment",
            status: row["状态"] || "available", area_sqm: row["面积"] ? parseFloat(row["面积"]) : null,
            layout: row["户型"] || null, furnishing: row["家具"] as "none"|"basic"|"full"|null || null,
            notes: row["备注"] || null, code: `U-${row["房号"]}`,
          });
          if (error) { errors++; messages.push(`行${i + 2}: ${error.message}`); } else inserted++;
          break;
        }
        case "receivables": {
          let customerId = null, unitId = null;
          if (row["客户姓名"]) {
            const { data: c } = await supabase.from("customers").select("id").eq("name", row["客户姓名"]).limit(1);
            customerId = c?.[0]?.id ?? null;
          }
          if (row["房号"]) {
            const { data: u } = await supabase.from("units").select("id, building_id").eq("unit_no", row["房号"]).limit(1);
            unitId = u?.[0]?.id ?? null;
          }
          const { error } = await supabase.from("receivables").insert({
            building_id: null, unit_id: unitId, customer_id: customerId,
            source_type: row["业务类型"] || "manual", source_id: null,
            category: "other", title: row["标题"] || "导入应收",
            due_date: row["到期日"], amount_xof: parseFloat(row["应收金额"]),
            paid_amount_xof: parseFloat(row["实收金额"] ?? "0"), status: "pending", currency: "XOF",
          });
          if (error) { errors++; messages.push(`行${i + 2}: ${error.message}`); } else inserted++;
          break;
        }
        case "payments": {
          let unitId = null, customerId = null;
          if (row["房号"]) {
            const { data: u } = await supabase.from("units").select("id").eq("unit_no", row["房号"]).limit(1);
            unitId = u?.[0]?.id ?? null;
          }
          if (row["客户姓名"]) {
            const { data: c } = await supabase.from("customers").select("id").eq("name", row["客户姓名"]).limit(1);
            customerId = c?.[0]?.id ?? null;
          }
          const amt = parseFloat(row["金额"]);
          const { error } = await supabase.from("payments").insert({
            customer_id: customerId, unit_id: unitId, source_type: row["来源类型"] || "manual",
            source_id: null, payment_date: row["收款日期"], amount: amt,
            currency: "XOF", exchange_rate_to_xof: 1, receipt_no: row["收据号"] || null,
          });
          if (error) { errors++; messages.push(`行${i + 2}: ${error.message}`); } else inserted++;
          break;
        }
        case "lease_contracts": {
          let unitId = null, customerId = null;
          const { data: u } = await supabase.from("units").select("id").eq("unit_no", row["房号"]).limit(1);
          unitId = u?.[0]?.id;
          const { data: c } = await supabase.from("customers").select("id").eq("name", row["客户姓名"]).limit(1);
          if (!c || c.length === 0) {
            const { data: nc } = await supabase.from("customers").insert({ name: row["客户姓名"] }).select("id").single();
            customerId = nc?.id;
          } else customerId = c[0].id;
          if (!unitId) { errors++; messages.push(`行${i + 2}: 房源不存在`); break; }
          const { error } = await supabase.from("lease_contracts").insert({
            unit_id: unitId, customer_id: customerId!, contract_no: row["合同号"] || `IMP-${Date.now()}-${i}`,
            start_date: row["开始日期"], expected_end_date: row["结束日期"],
            payment_cycle: row["支付周期"] || "monthly", payment_day: parseInt(row["付款日"] ?? "5"),
            monthly_rent_xof: parseFloat(row["月租"]), deposit_amount_xof: parseFloat(row["押金"] ?? "0"),
            status: "draft",
          });
          if (error) { errors++; messages.push(`行${i + 2}: ${error.message}`); } else inserted++;
          break;
        }
        case "sale_contracts": {
          let unitId = null, customerId = null;
          const { data: u } = await supabase.from("units").select("id").eq("unit_no", row["房号"]).limit(1);
          unitId = u?.[0]?.id;
          const { data: c } = await supabase.from("customers").select("id").eq("name", row["买方姓名"]).limit(1);
          if (!c || c.length === 0) {
            const { data: nc } = await supabase.from("customers").insert({ name: row["买方姓名"] }).select("id").single();
            customerId = nc?.id;
          } else customerId = c[0].id;
          if (!unitId) { errors++; messages.push(`行${i + 2}: 房源不存在`); break; }
          const { error } = await supabase.from("sale_contracts").insert({
            unit_id: unitId, customer_id: customerId!, contract_no: row["合同号"] || `IMP-S-${Date.now()}-${i}`,
            signed_date: row["签约日期"], total_amount_xof: parseFloat(row["总价"]),
            payment_plan_type: row["付款方式"] || "lump_sum", status: "draft",
          });
          if (error) { errors++; messages.push(`行${i + 2}: ${error.message}`); } else inserted++;
          break;
        }
      }
    } catch (e: unknown) {
      errors++;
      messages.push(`行${i + 2}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await writeAuditLog({
    action: "import", entityType: type, entityId: null,
    entityLabel: `${type} 导入`,
    metadata: { inserted, errors, total: rows.length, actor: user?.email },
  });

  const success = errors === 0;
  return { success, inserted, errors, messages };
}

export async function getImportTemplate(type: ImportDataType): Promise<string> {
  switch (type) {
    case "customers": return "姓名,电话,性别,证件类型,备注\n张三,0100000001,男,id_card,示例客户";
    case "units": return "房号,楼层,类型,状态,面积,户型,家具,备注\n101,1,apartment,available,35,1B1B,full,示例房源";
    case "receivables": return "业务类型,房号,客户姓名,应收金额,实收金额,到期日,标题\nmanual,101,张三,50000,0,2026-06-01,示例应收";
    case "payments": return "收款日期,房号,客户姓名,金额,收据号,来源类型\n2026-05-20,101,张三,50000,RCP001,manual";
    case "lease_contracts": return "房号,客户姓名,合同号,开始日期,结束日期,月租,押金,支付周期,付款日\n101,张三,LC001,2026-06-01,2027-05-31,120000,240000,monthly,5";
    case "sale_contracts": return "房号,买方姓名,合同号,总价,签约日期,付款方式\n101,张三,SC001,50000000,2026-06-01,lump_sum";
    default: return "";
  }
}
