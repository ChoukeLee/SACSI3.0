"use client";

import { formatXof } from "@/lib/utils";
import type { DocumentRecord, Locale } from "../types";

// ── Print infrastructure ──

const PRINT_STYLES = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 12px; color: #1e293b; padding: 18mm 20mm;
    max-width: 210mm;
  }
  @media print {
    body { padding: 14mm 18mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  .header { text-align: center; border-bottom: 2px solid #F77F00; padding-bottom: 10px; margin-bottom: 14px; }
  .header .company { font-size: 22px; font-weight: 800; color: #F77F00; letter-spacing: 0.04em; }
  .header .sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .header .doc-type { font-size: 14px; font-weight: 700; color: #1e293b; margin-top: 6px; }
  h1 { font-size: 15px; margin-bottom: 10px; }
  table.info { width: 100%; border-collapse: collapse; margin: 10px 0; }
  table.info td { padding: 4px 0; font-size: 11px; vertical-align: top; }
  table.info .lbl { color: #64748b; width: 90px; font-size: 10px; }
  table.info .val { font-weight: 600; }
  table.data { width: 100%; border-collapse: collapse; margin: 12px 0; }
  table.data th { background: #f8fafc; text-align: left; padding: 5px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  table.data td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
  .total-row { border-top: 2px solid #1e293b; padding-top: 6px; margin-top: 8px; }
  .total-row .lbl { font-size: 13px; font-weight: 700; }
  .total-row .val { font-size: 14px; font-weight: 700; color: #F77F00; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
  .st-paid { background: #dcfce7; color: #16a34a; }
  .st-pending { background: #fef3c7; color: #d97706; }
  .st-overdue { background: #fee2e2; color: #dc2626; }
  .st-active { background: #dbeafe; color: #2563eb; }
  .signatures { margin-top: 36px; display: flex; justify-content: space-between; gap: 40px; }
  .sig { flex: 1; }
  .sig .line { border-top: 1px solid #94a3b8; margin-top: 28px; padding-top: 4px; text-align: center; font-size: 10px; color: #64748b; }
  .footer { margin-top: 24px; text-align: center; font-size: 9px; color: #cbd5e1; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .reminder-warn { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 10px 14px; margin: 12px 0; color: #b91c1c; font-size: 11px; font-weight: 600; }
</style>`;

function openPrintWindow(html: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function printDoc(title: string, bodyHtml: string) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${PRINT_STYLES}</head><body>${bodyHtml}</body></html>`;
  openPrintWindow(html);
}

// ── Helpers ──

function headerHtml(company: string, docType: string, sub?: string) {
  return `
    <div class="header">
      <div class="company">${company}</div>
      <div class="sub">SACIS 3.0${sub ? ` · ${sub}` : ""}</div>
      <div class="doc-type">${docType}</div>
    </div>`;
}

function infoTable(rows: [string, string][]) {
  return `<table class="info">${rows.map(([l, v]) => `<tr><td class="lbl">${l}</td><td class="val">${v}</td></tr>`).join("")}</table>`;
}

function statusBadge(status: string, labels: Record<string, string>) {
  const cls = status === "paid" || status === "checked_out" ? "st-paid"
    : status === "overdue" ? "st-overdue"
    : status === "pending" || status === "pending_review" ? "st-pending"
    : "st-active";
  return `<span class="status-badge ${cls}">${labels[status] ?? status}</span>`;
}

function sigBlock(tenant: string, staff: string) {
  return `<div class="signatures"><div class="sig"><div class="line">${tenant}</div></div><div class="sig"><div class="line">${staff}</div></div></div>`;
}

// ── Labels ──

function zh() {
  return {
    company: "科建地产", building: "SASCI11 · 11#",
    contractNo: "合同编号", unit: "房源", customer: "客户", phone: "电话",
    startDate: "起租日期", endDate: "预计退租", paymentCycle: "支付周期",
    monthlyRent: "月租金", deposit: "押金", totalPrice: "合同总价",
    paymentDate: "收款日期", amount: "金额", paid: "已收", outstanding: "未收",
    receiptNo: "收据编号", dueDate: "应收日期",
    checkIn: "入住日期", checkOut: "退房日期", nights: "晚数",
    nightlyPrice: "每晚价格", prepaid: "预付", billingStatus: "计费状态",
    signTenant: "客户签字", signStaff: "经办人", signDate: "日期",
    statusLabels: {
      draft: "草稿", active: "生效中", terminated: "已终止", expired: "已过期",
      pending: "待收", partial: "部分", paid: "已收", overdue: "逾期",
      pending_review: "待审核", confirmed: "已确认", checked_in: "已入住", checked_out: "已退房",
      cancelled: "已取消", not_started: "未过户", in_progress: "过户中", completed: "已完成",
    },
    reminderTitle: "催款通知",
    reminderBody: (name: string, unitNo: string, amount: string, due: string) =>
      `尊敬的 ${name}：您位于 ${unitNo} 的租金 ${amount}（截止 ${due}）已逾期，请在3日内缴纳。如有疑问请联系管理处。`,
  };
}

function fr() {
  return {
    company: "Kejian Immobilier", building: "SASCI11 · Phase 1",
    contractNo: "N° contrat", unit: "Logement", customer: "Client", phone: "Tel",
    startDate: "Date debut", endDate: "Fin prevue", paymentCycle: "Cycle",
    monthlyRent: "Loyer mensuel", deposit: "Caution", totalPrice: "Prix total",
    paymentDate: "Date paiement", amount: "Montant", paid: "Paye", outstanding: "Du",
    receiptNo: "N° recu", dueDate: "Echeance",
    checkIn: "Arrivee", checkOut: "Depart", nights: "Nuits",
    nightlyPrice: "Prix/nuit", prepaid: "Avance", billingStatus: "Facturation",
    signTenant: "Signature client", signStaff: "Agent", signDate: "Date",
    statusLabels: {
      draft: "Brouillon", active: "Actif", terminated: "Resilie", expired: "Expire",
      pending: "Attente", partial: "Partiel", paid: "Paye", overdue: "Retard",
      pending_review: "A valider", confirmed: "Confirme", checked_in: "Arrive", checked_out: "Parti",
      cancelled: "Annule", not_started: "Non commence", in_progress: "En cours", completed: "Termine",
    },
    reminderTitle: "Avis de retard",
    reminderBody: (name: string, unitNo: string, amount: string, due: string) =>
      `${name}, votre loyer pour ${unitNo} de ${amount} (echeance ${due}) est en retard. Veuillez regler sous 3 jours.`,
  };
}

// ── Template functions ──

export function printLeaseContractDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const c = data.raw as Record<string, unknown>;
  const cycleLabels: Record<string, string> = locale === "zh"
    ? { monthly: "月付", quarterly: "季付", semiannual: "半年付", annual: "年付" }
    : { monthly: "Mensuel", quarterly: "Trimestriel", semiannual: "Semestriel", annual: "Annuel" };

  const body = `
    ${headerHtml(L.company, data.title)}
    ${infoTable([
      [L.contractNo, String(c.contract_no ?? data.contractNo ?? "-")],
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.phone, data.customerPhone ?? "-"],
      [L.startDate, String(c.start_date ?? "-")],
      [L.endDate, String(c.expected_end_date ?? "-")],
      [L.paymentCycle, `${cycleLabels[String(c.payment_cycle ?? "")] ?? c.payment_cycle} / ${c.payment_day ?? "-"}号`],
      [L.monthlyRent, formatXof(Number(c.monthly_rent_xof ?? 0))],
      [L.deposit, `${formatXof(Number(c.deposit_amount_xof ?? 0))} ${c.deposit_received ? (locale === "zh" ? "✓已收" : "✓Recu") : (locale === "zh" ? "未收" : "Non recu")}`],
      [(locale === "zh" ? "合同状态" : "Statut"), statusBadge(data.status, L.statusLabels)],
    ])}
    ${sigBlock(L.signTenant, L.signStaff)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(data.title, body);
}

export function printLeaseReceiptDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const c = data.raw as Record<string, unknown>;
  const unpaid = data.amountXof - data.paidAmountXof;

  const body = `
    ${headerHtml(L.company, data.title)}
    ${infoTable([
      [L.contractNo, String(c.contract_no ?? data.contractNo ?? "-")],
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.receiptNo, String(c.receipt_no ?? "-")],
      [L.paymentDate, data.date],
    ])}
    <table class="data">
      <tr><td class="lbl">${L.amount}</td><td class="val">${formatXof(data.amountXof)}</td></tr>
      <tr><td class="lbl">${L.paid}</td><td class="val" style="color:#16a34a">${formatXof(data.paidAmountXof)}</td></tr>
      ${unpaid > 0 ? `<tr><td class="lbl" style="color:#dc2626">${L.outstanding}</td><td class="val" style="color:#dc2626;font-weight:700">${formatXof(unpaid)}</td></tr>` : ""}
    </table>
    <div class="total-row"><span class="lbl">${L.amount}</span><span class="val">${formatXof(data.amountXof)} XOF</span></div>
    <p style="font-size:10px;color:#64748b;margin-top:8px">${statusBadge(data.status, L.statusLabels)}</p>
    ${sigBlock(L.signTenant, L.signStaff)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(data.title, body);
}

export function printLeaseReminderDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const unpaid = data.amountXof - data.paidAmountXof;
  const body = `
    ${headerHtml(L.company, L.reminderTitle)}
    <div class="reminder-warn">${L.reminderBody(data.customerName, data.unitNo, formatXof(unpaid > 0 ? unpaid : data.amountXof), data.date)}</div>
    ${infoTable([
      [L.contractNo, String(data.contractNo ?? "-")],
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.phone, data.customerPhone ?? "-"],
      [L.dueDate, data.date],
      [L.amount, formatXof(data.amountXof)],
      [L.paid, formatXof(data.paidAmountXof)],
      [L.outstanding, `<span style="color:#dc2626;font-weight:700">${formatXof(unpaid > 0 ? unpaid : 0)}</span>`],
      [(locale === "zh" ? "状态" : "Statut"), statusBadge(data.status, L.statusLabels)],
    ])}
    ${sigBlock(L.signStaff, L.signDate)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(L.reminderTitle, body);
}

export function printDailyBookingDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const c = data.raw as Record<string, unknown>;
  const nights = c.nights ?? Math.ceil((new Date(String(c.check_out ?? c.actual_check_out ?? new Date())).getTime() - new Date(String(c.check_in ?? "")).getTime()) / 86400000);

  const body = `
    ${headerHtml(L.company, data.title)}
    ${infoTable([
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.phone, data.customerPhone ?? "-"],
      [L.checkIn, String(c.check_in ?? "-")],
      [L.checkOut, String(c.check_out ?? c.actual_check_out ?? "-")],
      [L.nights, `${nights} ${locale === "zh" ? "晚" : "nuits"}`],
      [L.nightlyPrice, formatXof(Number(c.nightly_price_xof ?? 0))],
    ])}
    <table class="data">
      <tr><td class="lbl">${locale === "zh" ? "总金额" : "Total"}</td><td class="val">${formatXof(data.amountXof)}</td></tr>
      <tr><td class="lbl">${L.prepaid}</td><td class="val" style="color:#16a34a">${formatXof(data.paidAmountXof)}</td></tr>
      ${(data.amountXof - data.paidAmountXof) > 0 ? `<tr><td class="lbl" style="color:#dc2626">${L.outstanding}</td><td class="val" style="color:#dc2626;font-weight:700">${formatXof(data.amountXof - data.paidAmountXof)}</td></tr>` : ""}
    </table>
    <p style="font-size:10px;color:#64748b;margin-top:6px">${statusBadge(data.status, L.statusLabels)} · ${L.billingStatus}: ${String(c.billing_status ?? "-")}</p>
    ${sigBlock(L.signTenant, L.signStaff)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(data.title, body);
}

export function printDailyReceiptDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const c = data.raw as Record<string, unknown>;
  const unpaid = data.amountXof - data.paidAmountXof;

  const body = `
    ${headerHtml(L.company, data.title)}
    ${infoTable([
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.receiptNo, String(c.receipt_no ?? "-")],
      [L.paymentDate, data.date],
    ])}
    <table class="data">
      <tr><td class="lbl">${L.amount}</td><td class="val">${formatXof(data.amountXof)}</td></tr>
      <tr><td class="lbl">${L.paid}</td><td class="val" style="color:#16a34a">${formatXof(data.paidAmountXof)}</td></tr>
      ${unpaid > 0 ? `<tr><td class="lbl" style="color:#dc2626">${L.outstanding}</td><td class="val" style="color:#dc2626;font-weight:700">${formatXof(unpaid)}</td></tr>` : ""}
    </table>
    <p style="font-size:10px;color:#64748b;margin-top:6px">${statusBadge(data.status, L.statusLabels)}</p>
    ${sigBlock(L.signTenant, L.signStaff)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(data.title, body);
}

export function printDailyCheckoutDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const c = data.raw as Record<string, unknown>;
  const unpaid = data.amountXof - data.paidAmountXof;
  const nights = c.nights ?? Math.ceil((new Date(String(c.check_out ?? c.actual_check_out ?? new Date())).getTime() - new Date(String(c.check_in ?? "")).getTime()) / 86400000);

  const body = `
    ${headerHtml(L.company, data.title)}
    ${infoTable([
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.checkIn, String(c.check_in ?? "-")],
      [L.checkOut, String(c.actual_check_out ?? c.check_out ?? "-")],
      [L.nights, `${nights} ${locale === "zh" ? "晚" : "nuits"}`],
    ])}
    <table class="data">
      <tr><td class="lbl">${L.amount}</td><td class="val">${formatXof(data.amountXof)}</td></tr>
      <tr><td class="lbl">${L.prepaid}</td><td class="val" style="color:#16a34a">${formatXof(data.paidAmountXof)}</td></tr>
      ${unpaid > 0 ? `<tr><td class="lbl" style="color:#dc2626">${L.outstanding}</td><td class="val" style="color:#dc2626;font-weight:700">${formatXof(unpaid)}</td></tr>` : ""}
    </table>
    <p style="font-size:10px;color:#64748b;margin-top:6px">${statusBadge(data.status, L.statusLabels)}</p>
    ${sigBlock(L.signTenant, L.signStaff)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(data.title, body);
}

export function printSaleContractDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const c = data.raw as Record<string, unknown>;
  const planLabels: Record<string, string> = locale === "zh"
    ? { lump_sum: "一次性付清", fixed_installment: "固定分期", flexible_installment: "灵活分期" }
    : { lump_sum: "Comptant", fixed_installment: "Echeancier fixe", flexible_installment: "Libre" };

  const body = `
    ${headerHtml(L.company, data.title)}
    ${infoTable([
      [L.contractNo, String(c.contract_no ?? data.contractNo ?? "-")],
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.phone, data.customerPhone ?? "-"],
      [(locale === "zh" ? "签约日期" : "Date signature"), String(c.signed_date ?? "-")],
      [L.totalPrice, formatXof(data.amountXof)],
      [(locale === "zh" ? "付款方式" : "Plan"), planLabels[String(c.payment_plan_type ?? "")] ?? String(c.payment_plan_type ?? "-")],
    ])}
    <table class="data">
      <tr><td class="lbl">${L.amount}</td><td class="val">${formatXof(data.amountXof)}</td></tr>
      <tr><td class="lbl">${L.paid}</td><td class="val" style="color:#16a34a">${formatXof(data.paidAmountXof)}</td></tr>
      ${(data.amountXof - data.paidAmountXof) > 0 ? `<tr><td class="lbl" style="color:#dc2626">${L.outstanding}</td><td class="val" style="color:#dc2626;font-weight:700">${formatXof(data.amountXof - data.paidAmountXof)}</td></tr>` : ""}
    </table>
    <p style="font-size:10px;color:#64748b;margin-top:6px">
      ${statusBadge(data.status, L.statusLabels)} ·
      ${(locale === "zh" ? "过户" : "Transfert")}: ${(L.statusLabels as Record<string, string>)[String(c.transfer_status ?? "")] ?? String(c.transfer_status ?? "-")}
    </p>
    ${sigBlock(L.signTenant, L.signStaff)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(data.title, body);
}

export function printSaleReceiptDoc(data: DocumentRecord, locale: Locale) {
  const L = locale === "zh" ? zh() : fr();
  const c = data.raw as Record<string, unknown>;
  const unpaid = data.amountXof - data.paidAmountXof;

  const body = `
    ${headerHtml(L.company, data.title)}
    ${infoTable([
      [L.contractNo, String(c.contract_no ?? data.contractNo ?? "-")],
      [L.unit, data.unitNo],
      [L.customer, data.customerName],
      [L.receiptNo, String(c.receipt_no ?? "-")],
      [L.paymentDate, data.date],
    ])}
    <table class="data">
      <tr><td class="lbl">${L.amount}</td><td class="val">${formatXof(data.amountXof)}</td></tr>
      <tr><td class="lbl">${L.paid}</td><td class="val" style="color:#16a34a">${formatXof(data.paidAmountXof)}</td></tr>
      ${unpaid > 0 ? `<tr><td class="lbl" style="color:#dc2626">${L.outstanding}</td><td class="val" style="color:#dc2626;font-weight:700">${formatXof(unpaid)}</td></tr>` : ""}
    </table>
    <p style="font-size:10px;color:#64748b;margin-top:6px">${statusBadge(data.status, L.statusLabels)}</p>
    ${sigBlock(L.signTenant, L.signStaff)}
    <div class="footer">${L.company} · ${L.building} · ${new Date().toLocaleDateString()}</div>`;
  printDoc(data.title, body);
}

export function printDocumentRecord(data: DocumentRecord, locale: Locale) {
  switch (data.docType) {
    case "lease_contract": return printLeaseContractDoc(data, locale);
    case "lease_receipt": return printLeaseReceiptDoc(data, locale);
    case "lease_reminder": return printLeaseReminderDoc(data, locale);
    case "daily_booking": return printDailyBookingDoc(data, locale);
    case "daily_receipt": return printDailyReceiptDoc(data, locale);
    case "daily_checkout": return printDailyCheckoutDoc(data, locale);
    case "sale_contract": return printSaleContractDoc(data, locale);
    case "sale_receipt": return printSaleReceiptDoc(data, locale);
  }
}
