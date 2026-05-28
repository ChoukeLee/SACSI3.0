"use client";

import { formatXof } from "@/lib/utils";
import type { LeaseContractRow, DailyBookingRow, UnitRow, CustomerRow } from "@/types/database";

// ── Print helper ──

function openPrintWindow(html: string) {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.onload = () => w.print();
}

const a4Styles = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 12px; color: #1e293b; padding: 20mm; max-width: 210mm; }
  @media print { body { padding: 15mm; } }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin-bottom: 12px; color: #64748b; }
  .header { text-align: center; border-bottom: 2px solid #4F5DE6; padding-bottom: 12px; margin-bottom: 16px; }
  .header .company { font-size: 20px; font-weight: 800; color: #4F5DE6; }
  .header .meta { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: #f8fafc; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .label { color: #64748b; font-size: 10px; }
  .value { font-weight: 600; }
  .total { font-size: 14px; font-weight: 700; border-top: 2px solid #1e293b; padding-top: 8px; margin-top: 12px; }
  .signature { margin-top: 40px; display: flex; justify-content: space-between; }
  .sig-line { width: 180px; border-top: 1px solid #94a3b8; padding-top: 4px; text-align: center; font-size: 10px; color: #64748b; }
  .footer { margin-top: 24px; text-align: center; font-size: 9px; color: #cbd5e1; border-top: 1px solid #e2e8f0; padding-top: 8px; }
</style>`;

// ── 1. Lease Contract ──

export interface LeaseContractPrintData {
  contract: LeaseContractRow;
  unit: UnitRow | null;
  customer: CustomerRow | null;
}

export function printLeaseContract(data: LeaseContractPrintData, locale: "zh" | "fr") {
  const labels = locale === "zh"
    ? { title: "长租合同", company: "科建地产", contractNo: "合同编号", startDate: "起租日期", endDate: "预计退租", paymentCycle: "支付周期", paymentDay: "付款日", monthlyRent: "月租金", deposit: "押金", rentFreeDays: "免租期", signer: "签约人", unit: "房源", customer: "客户", tenant: "承租方", landlord: "出租方" }
    : { title: "Contrat de location", company: "Kejian Immobilier", contractNo: "N° contrat", startDate: "Date debut", endDate: "Fin prevue", paymentCycle: "Cycle", paymentDay: "Jour paie", monthlyRent: "Loyer mensuel", deposit: "Caution", rentFreeDays: "Jours grace", signer: "Signataire", unit: "Logement", customer: "Client", tenant: "Locataire", landlord: "Bailleur" };

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${labels.title}</title>${a4Styles}</head><body>
    <div class="header"><div class="company">${labels.company}</div><div class="meta">${labels.title}</div></div>
    <h1>${labels.title}</h1>
    <div class="row"><span class="label">${labels.contractNo}</span><span class="value">${data.contract.contract_no}</span></div>
    <table>
      <tr><td class="label">${labels.unit}</td><td class="value">${data.unit?.unit_no ?? "-"} (${data.unit?.floor_label ?? ""})</td></tr>
      <tr><td class="label">${labels.customer}</td><td class="value">${data.customer?.name ?? "-"}</td></tr>
      <tr><td class="label">${labels.startDate}</td><td class="value">${data.contract.start_date}</td></tr>
      <tr><td class="label">${labels.endDate}</td><td class="value">${data.contract.expected_end_date}</td></tr>
      <tr><td class="label">${labels.paymentCycle} / ${labels.paymentDay}</td><td class="value">${data.contract.payment_cycle} / ${data.contract.payment_day}号</td></tr>
      <tr><td class="label">${labels.monthlyRent}</td><td class="value">${formatXof(Number(data.contract.monthly_rent_xof))}</td></tr>
      <tr><td class="label">${labels.deposit}</td><td class="value">${formatXof(Number(data.contract.deposit_amount_xof))} ${data.contract.deposit_received ? "✓已收" : "未收"}</td></tr>
    </table>
    <div class="signature">
      <div class="sig-line">${labels.tenant}: ${data.customer?.name ?? "___________"}</div>
      <div class="sig-line">${labels.landlord}: ${labels.company}</div>
    </div>
    <div class="footer">${labels.company} — ${new Date().toLocaleDateString()}</div>
  </body></html>`;
  openPrintWindow(html);
}

// ── 2. Daily Rental Receipt ──

export interface DailyReceiptPrintData {
  booking: DailyBookingRow;
  unit: UnitRow | null;
  customer: CustomerRow | null;
}

export function printDailyReceipt(data: DailyReceiptPrintData, locale: "zh" | "fr") {
  const labels = locale === "zh"
    ? { title: "日租收据", company: "科建地产", room: "房间", guest: "客人", checkIn: "入住日期", checkOut: "退房日期", nights: "晚数", nightlyPrice: "每晚价格", total: "总金额", prepaid: "预付金额", remaining: "待付余额" }
    : { title: "Recu journalier", company: "Kejian Immobilier", room: "Chambre", guest: "Client", checkIn: "Arrivee", checkOut: "Depart", nights: "Nuits", nightlyPrice: "Prix/nuit", total: "Total", prepaid: "Avance", remaining: "Solde" };

  const effectiveCheckOut = data.booking.check_out ?? data.booking.actual_check_out ?? new Date().toISOString().slice(0, 10);
  const nights = Math.ceil((new Date(effectiveCheckOut).getTime() - new Date(data.booking.check_in).getTime()) / (1000 * 60 * 60 * 24));
  const remaining = Number(data.booking.total_amount_xof) - Number(data.booking.prepaid_amount_xof);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${labels.title}</title>${a4Styles}</head><body>
    <div class="header"><div class="company">${labels.company}</div><div class="meta">${labels.title}</div></div>
    <h1>${labels.title}</h1>
    <table>
      <tr><td class="label">${labels.room}</td><td class="value">${data.unit?.unit_no ?? "-"}</td></tr>
      <tr><td class="label">${labels.guest}</td><td class="value">${data.customer?.name ?? "-"}</td></tr>
      <tr><td class="label">${labels.checkIn}</td><td class="value">${data.booking.check_in}</td></tr>
      <tr><td class="label">${labels.checkOut}</td><td class="value">${data.booking.check_out}</td></tr>
      <tr><td class="label">${labels.nights}</td><td class="value">${nights} 晚</td></tr>
      <tr><td class="label">${labels.nightlyPrice}</td><td class="value">${formatXof(Number(data.booking.nightly_price_xof))}</td></tr>
    </table>
    <div class="total row"><span>${labels.total}</span><span>${formatXof(Number(data.booking.total_amount_xof))}</span></div>
    <div class="row"><span class="label">${labels.prepaid}</span><span>${formatXof(Number(data.booking.prepaid_amount_xof))}</span></div>
    ${remaining > 0 ? `<div class="row"><span class="label" style="color:#dc2626">${labels.remaining}</span><span style="color:#dc2626;font-weight:700">${formatXof(remaining)}</span></div>` : ""}
    <div class="footer">${labels.company} — ${new Date().toLocaleDateString()}</div>
  </body></html>`;
  openPrintWindow(html);
}

// ── 3. Cleaning Task Sheet ──

export interface CleaningTaskPrintData {
  unit: UnitRow;
  isCompleted: boolean;
  completedAt?: string | null;
}

export function printCleaningTask(data: CleaningTaskPrintData[], locale: "zh" | "fr") {
  const labels = locale === "zh"
    ? { title: "保洁任务单", company: "科建地产", room: "房间", status: "状态", completed: "已完成", pending: "待保洁", date: "日期" }
    : { title: "Fiche de menage", company: "Kejian Immobilier", room: "Chambre", status: "Statut", completed: "Termine", pending: "En attente", date: "Date" };

  const rows = data.map(d => `<tr><td>${d.unit.unit_no}</td><td>${d.unit.floor_label}</td><td>${d.isCompleted ? labels.completed : labels.pending}</td></tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${labels.title}</title>${a4Styles}</head><body>
    <div class="header"><div class="company">${labels.company}</div><div class="meta">${labels.title}</div></div>
    <h1>${labels.title}</h1>
    <p style="color:#64748b;font-size:10px">${labels.date}: ${new Date().toLocaleDateString()}</p>
    <table><thead><tr><th>${labels.room}</th><th>楼层</th><th>${labels.status}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="footer">${labels.company}</div>
  </body></html>`;
  openPrintWindow(html);
}
