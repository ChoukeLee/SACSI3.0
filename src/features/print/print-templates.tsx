"use client";

import { formatXof } from "@/lib/utils";
import type {
  CustomerRow,
  DailyBookingRow,
  LeaseContractRow,
  SaleContractRow,
  ReceivableRow,
  UnitRow,
} from "@/types/database";

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
  h2 { font-size: 14px; margin: 16px 0 8px; color: #64748b; }
  .header { text-align: center; border-bottom: 2px solid #1f2937; padding-bottom: 12px; margin-bottom: 16px; }
  .header .company { font-size: 20px; font-weight: 800; color: #1f2937; }
  .header .meta { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th { background: #f8fafc; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .label { color: #64748b; font-size: 10px; }
  .value { font-weight: 600; }
  .total-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0 12px; }
  .total-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
  .total-box .label { display: block; margin-bottom: 3px; }
  .total-box .value { font-size: 13px; }
  .signature { margin-top: 40px; display: flex; justify-content: space-between; }
  .sig-line { width: 180px; border-top: 1px solid #94a3b8; padding-top: 4px; text-align: center; font-size: 10px; color: #64748b; }
  .footer { margin-top: 24px; text-align: center; font-size: 9px; color: #cbd5e1; border-top: 1px solid #e2e8f0; padding-top: 8px; }
</style>`;

export interface LeaseContractPrintData {
  contract: LeaseContractRow;
  unit: UnitRow | null;
  customer: CustomerRow | null;
  receivables?: ReceivableRow[];
}

export function printLeaseContract(data: LeaseContractPrintData, locale: "zh" | "fr") {
  const labels = locale === "zh"
    ? {
        title: "长租合同",
        company: "科建地产",
        contractNo: "合同编号",
        startDate: "起租日期",
        endDate: "预计退租",
        paymentCycle: "支付周期",
        paymentDay: "付款日",
        monthlyRent: "月租金",
        deposit: "押金",
        unit: "房源",
        customer: "客户",
        tenant: "承租方",
        landlord: "出租方",
        summary: "账款汇总",
        receivables: "应收账款",
        total: "应收合计",
        paidTotal: "已收合计",
        unpaidTotal: "未收合计",
        kind: "类型",
        dueDate: "应收日期",
        amount: "应收金额",
        paid: "已收金额",
        unpaid: "未收金额",
        status: "状态",
        noReceivables: "暂无应收账款记录",
        paidStatus: "已收",
        pendingStatus: "待收",
        partialStatus: "部分收款",
        overdueStatus: "逾期",
        cancelledStatus: "已取消",
        rent: "租金",
        leaseDeposit: "押金",
        other: "其他",
        depositPaid: "已收",
        depositUnpaid: "未收",
        paymentDaySuffix: "号",
      }
    : {
        title: "Contrat de location",
        company: "Kejian Immobilier",
        contractNo: "N° contrat",
        startDate: "Date debut",
        endDate: "Fin prevue",
        paymentCycle: "Cycle",
        paymentDay: "Jour paie",
        monthlyRent: "Loyer mensuel",
        deposit: "Caution",
        unit: "Logement",
        customer: "Client",
        tenant: "Locataire",
        landlord: "Bailleur",
        summary: "Synthese",
        receivables: "Creances",
        total: "Total du",
        paidTotal: "Total paye",
        unpaidTotal: "Solde total",
        kind: "Type",
        dueDate: "Date",
        amount: "Montant du",
        paid: "Paye",
        unpaid: "Solde",
        status: "Statut",
        noReceivables: "Aucune creance",
        paidStatus: "Paye",
        pendingStatus: "Attente",
        partialStatus: "Partiel",
        overdueStatus: "Retard",
        cancelledStatus: "Annule",
        rent: "Loyer",
        leaseDeposit: "Depot",
        other: "Autre",
        depositPaid: "paye",
        depositUnpaid: "non paye",
        paymentDaySuffix: "",
      };

  const receivables = (data.receivables ?? []).filter((r) => r.status !== "cancelled");
  const receivableTotal = receivables.reduce((sum, r) => sum + Number(r.amount_xof), 0);
  const receivablePaid = receivables.reduce((sum, r) => sum + Number(r.paid_amount_xof), 0);
  const receivableUnpaid = Math.max(0, receivableTotal - receivablePaid);
  const statusLabel = (status: string) => ({
    paid: labels.paidStatus,
    pending: labels.pendingStatus,
    partial: labels.partialStatus,
    overdue: labels.overdueStatus,
    cancelled: labels.cancelledStatus,
  }[status] ?? status);
  const kindLabel = (category: string) => ({
    lease_rent: labels.rent,
    lease_deposit: labels.leaseDeposit,
  }[category] ?? labels.other);
  const receivableRows = receivables.map((r) => {
    const amount = Number(r.amount_xof);
    const paid = Number(r.paid_amount_xof);
    const unpaid = Math.max(0, amount - paid);
    return `<tr>
      <td>${kindLabel(r.category)}</td>
      <td>${r.due_date}</td>
      <td>${formatXof(amount)}</td>
      <td>${formatXof(paid)}</td>
      <td>${formatXof(unpaid)}</td>
      <td>${statusLabel(r.status)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${labels.title}</title>${a4Styles}</head><body>
    <div class="header"><div class="company">${labels.company}</div><div class="meta">${labels.title}</div></div>
    <h1>${labels.title}</h1>
    <div class="row"><span class="label">${labels.contractNo}</span><span class="value">${data.contract.contract_no}</span></div>
    <table>
      <tr><td class="label">${labels.unit}</td><td class="value">${data.unit?.unit_no ?? "-"} (${data.unit?.floor_label ?? ""})</td></tr>
      <tr><td class="label">${labels.customer}</td><td class="value">${data.customer?.name ?? "-"}</td></tr>
      <tr><td class="label">${labels.startDate}</td><td class="value">${data.contract.start_date}</td></tr>
      <tr><td class="label">${labels.endDate}</td><td class="value">${data.contract.expected_end_date}</td></tr>
      <tr><td class="label">${labels.paymentCycle} / ${labels.paymentDay}</td><td class="value">${data.contract.payment_cycle} / ${data.contract.payment_day}${labels.paymentDaySuffix}</td></tr>
      <tr><td class="label">${labels.monthlyRent}</td><td class="value">${formatXof(Number(data.contract.monthly_rent_xof))}</td></tr>
      <tr><td class="label">${labels.deposit}</td><td class="value">${formatXof(Number(data.contract.deposit_amount_xof))} ${data.contract.deposit_received ? labels.depositPaid : labels.depositUnpaid}</td></tr>
    </table>
    <h2>${labels.summary}</h2>
    <div class="total-grid">
      <div class="total-box"><span class="label">${labels.total}</span><span class="value">${formatXof(receivableTotal)}</span></div>
      <div class="total-box"><span class="label">${labels.paidTotal}</span><span class="value">${formatXof(receivablePaid)}</span></div>
      <div class="total-box"><span class="label">${labels.unpaidTotal}</span><span class="value">${formatXof(receivableUnpaid)}</span></div>
    </div>
    <h2>${labels.receivables}</h2>
    ${receivables.length > 0 ? `<table>
      <thead><tr><th>${labels.kind}</th><th>${labels.dueDate}</th><th>${labels.amount}</th><th>${labels.paid}</th><th>${labels.unpaid}</th><th>${labels.status}</th></tr></thead>
      <tbody>${receivableRows}</tbody>
    </table>` : `<p class="label">${labels.noReceivables}</p>`}
    <div class="signature">
      <div class="sig-line">${labels.tenant}: ${data.customer?.name ?? "___________"}</div>
      <div class="sig-line">${labels.landlord}: ${labels.company}</div>
    </div>
    <div class="footer">${labels.company} - ${new Date().toLocaleDateString()}</div>
  </body></html>`;
  openPrintWindow(html);
}

export interface SaleContractPrintData {
  contract: SaleContractRow;
  unit: UnitRow | null;
  customer: CustomerRow | null;
  paidAmountXof: number;
}

export function printSaleContract(data: SaleContractPrintData, locale: "zh" | "fr") {
  const labels = locale === "zh"
    ? {
        title: "出售合同摘要单", company: "科建地产", contractNo: "合同编号", unit: "房源",
        customer: "客户", signedDate: "签约日期", total: "合同总额", paid: "累计已收",
        outstanding: "待回款", paymentPlan: "付款方式", transfer: "过户状态",
        buyer: "买方", seller: "卖方",
      }
    : {
        title: "Résumé du contrat de vente", company: "Kejian Immobilier", contractNo: "N° contrat", unit: "Logement",
        customer: "Client", signedDate: "Date signature", total: "Total contrat", paid: "Total reçu",
        outstanding: "Reste à recevoir", paymentPlan: "Plan de paiement", transfer: "Transfert",
        buyer: "Acheteur", seller: "Vendeur",
      };
  const paid = Math.max(0, Number(data.paidAmountXof));
  const total = Number(data.contract.total_amount_xof);
  const outstanding = Math.max(0, total - paid);
  const paymentPlan = ({
    lump_sum: locale === "zh" ? "一次性付清" : "Comptant",
    fixed_installment: locale === "zh" ? "固定分期" : "Échéancier fixe",
    flexible_installment: locale === "zh" ? "灵活分期" : "Échéancier libre",
  } as Record<string, string>)[data.contract.payment_plan_type] ?? data.contract.payment_plan_type;
  const transferStatus = ({
    not_started: locale === "zh" ? "未开始" : "Non commencé",
    in_progress: locale === "zh" ? "办理中" : "En cours",
    completed: locale === "zh" ? "已完成" : "Terminé",
  } as Record<string, string>)[data.contract.transfer_status] ?? data.contract.transfer_status;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${labels.title}</title>${a4Styles}</head><body>
    <div class="header"><div class="company">${labels.company}</div><div class="meta">${labels.title}</div></div>
    <h1>${labels.title}</h1>
    <div class="row"><span class="label">${labels.contractNo}</span><span class="value">${data.contract.contract_no}</span></div>
    <table>
      <tr><td class="label">${labels.unit}</td><td class="value">${data.unit?.unit_no ?? "-"} (${data.unit?.floor_label ?? ""})</td></tr>
      <tr><td class="label">${labels.customer}</td><td class="value">${data.customer?.name ?? "-"}</td></tr>
      <tr><td class="label">${labels.signedDate}</td><td class="value">${data.contract.signed_date}</td></tr>
      <tr><td class="label">${labels.paymentPlan}</td><td class="value">${paymentPlan}</td></tr>
      <tr><td class="label">${labels.transfer}</td><td class="value">${transferStatus}</td></tr>
    </table>
    <h2>${labels.title}</h2>
    <div class="total-grid">
      <div class="total-box"><span class="label">${labels.total}</span><span class="value">${formatXof(total)}</span></div>
      <div class="total-box"><span class="label">${labels.paid}</span><span class="value">${formatXof(paid)}</span></div>
      <div class="total-box"><span class="label">${labels.outstanding}</span><span class="value">${formatXof(outstanding)}</span></div>
    </div>
    <div class="signature">
      <div class="sig-line">${labels.buyer}: ${data.customer?.name ?? "___________"}</div>
      <div class="sig-line">${labels.seller}: ${labels.company}</div>
    </div>
    <div class="footer">${labels.company} - ${new Date().toLocaleDateString()}</div>
  </body></html>`;
  openPrintWindow(html);
}

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
      <tr><td class="label">${labels.nights}</td><td class="value">${nights} ${locale === "zh" ? "晚" : ""}</td></tr>
      <tr><td class="label">${labels.nightlyPrice}</td><td class="value">${formatXof(Number(data.booking.nightly_price_xof))}</td></tr>
    </table>
    <div class="row"><span class="value">${labels.total}</span><span class="value">${formatXof(Number(data.booking.total_amount_xof))}</span></div>
    <div class="row"><span class="label">${labels.prepaid}</span><span>${formatXof(Number(data.booking.prepaid_amount_xof))}</span></div>
    ${remaining > 0 ? `<div class="row"><span class="label" style="color:#dc2626">${labels.remaining}</span><span style="color:#dc2626;font-weight:700">${formatXof(remaining)}</span></div>` : ""}
    <div class="footer">${labels.company} - ${new Date().toLocaleDateString()}</div>
  </body></html>`;
  openPrintWindow(html);
}

export interface CleaningTaskPrintData {
  unit: UnitRow;
  isCompleted: boolean;
  completedAt?: string | null;
}

export function printCleaningTask(data: CleaningTaskPrintData[], locale: "zh" | "fr") {
  const labels = locale === "zh"
    ? { title: "保洁任务单", company: "科建地产", room: "房间", floor: "楼层", status: "状态", completed: "已完成", pending: "待保洁", date: "日期" }
    : { title: "Fiche de menage", company: "Kejian Immobilier", room: "Chambre", floor: "Etage", status: "Statut", completed: "Termine", pending: "En attente", date: "Date" };

  const rows = data.map((d) => `<tr><td>${d.unit.unit_no}</td><td>${d.unit.floor_label}</td><td>${d.isCompleted ? labels.completed : labels.pending}</td></tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${labels.title}</title>${a4Styles}</head><body>
    <div class="header"><div class="company">${labels.company}</div><div class="meta">${labels.title}</div></div>
    <h1>${labels.title}</h1>
    <p style="color:#64748b;font-size:10px">${labels.date}: ${new Date().toLocaleDateString()}</p>
    <table><thead><tr><th>${labels.room}</th><th>${labels.floor}</th><th>${labels.status}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="footer">${labels.company}</div>
  </body></html>`;
  openPrintWindow(html);
}

// ── Move-out Settlement ──

export interface MoveOutSettlementData {
  contract: LeaseContractRow;
  unit: UnitRow | null;
  customer: CustomerRow | null;
  unpaidRent: number;
  depositAmount: number;
  damageDeduction: number;
  refundAmount: number;
  utilitiesCleared: boolean;
  receivables: ReceivableRow[];
}

export function printMoveOutSettlement(data: MoveOutSettlementData, locale: "zh" | "fr") {
  const zh2 = locale === "zh";
  const labels = zh2
    ? { title: "退租结算单", company: "科建地产", contractNo: "合同编号", unit: "房源", customer: "客户", startDate: "起租", actualEnd: "实际退租", utilities: "水电结清", yes: "是", no: "否", unpaidRent: "未付租金", deposit: "押金总额", damageDeduction: "损坏赔偿", refund: "退还押金", summary: "结算汇总", tenant: "承租方", landlord: "出租方" }
    : { title: "Decompte de sortie", company: "Kejian Immobilier", contractNo: "No contrat", unit: "Logement", customer: "Client", startDate: "Debut", actualEnd: "Sortie", utilities: "Charges reglees", yes: "Oui", no: "Non", unpaidRent: "Loyer impaye", deposit: "Caution totale", damageDeduction: "Retenue degats", refund: "Caution remboursee", summary: "Recapitulatif", tenant: "Locataire", landlord: "Bailleur" };

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + labels.title + '</title>' + a4Styles + '</head><body>' +
    '<div class="header"><div class="company">' + labels.company + '</div><div class="meta">' + labels.title + '</div></div>' +
    '<h1>' + labels.title + '</h1>' +
    '<table>' +
    '<tr><td class="label">' + labels.contractNo + '</td><td class="value">' + data.contract.contract_no + '</td></tr>' +
    '<tr><td class="label">' + labels.unit + '</td><td class="value">' + (data.unit?.unit_no ?? "-") + ' (' + (data.unit?.floor_label ?? "") + ')</td></tr>' +
    '<tr><td class="label">' + labels.customer + '</td><td class="value">' + (data.customer?.name ?? "-") + '</td></tr>' +
    '<tr><td class="label">' + labels.startDate + '</td><td class="value">' + data.contract.start_date + '</td></tr>' +
    '<tr><td class="label">' + labels.actualEnd + '</td><td class="value">' + (data.contract.actual_end_date ?? new Date().toISOString().slice(0,10)) + '</td></tr>' +
    '<tr><td class="label">' + labels.utilities + '</td><td class="value">' + (data.utilitiesCleared ? labels.yes : labels.no) + '</td></tr>' +
    '</table>' +
    '<h2>' + labels.summary + '</h2>' +
    '<div class="total-grid">' +
    '<div class="total-box"><span class="label">' + labels.unpaidRent + '</span><span class="value" style="color:#dc2626">' + formatXof(data.unpaidRent) + '</span></div>' +
    '<div class="total-box"><span class="label">' + labels.deposit + '</span><span class="value">' + formatXof(data.depositAmount) + '</span></div>' +
    '<div class="total-box"><span class="label">' + labels.damageDeduction + '</span><span class="value" style="color:#dc2626">-' + formatXof(data.damageDeduction) + '</span></div>' +
    '</div>' +
    '<div class="row" style="font-size:14px;font-weight:700;margin-top:12px;padding:8px;background:#f0fdf4;border-radius:8px">' +
    '<span>' + labels.refund + '</span><span style="color:#16a34a;font-size:16px">' + formatXof(data.refundAmount) + '</span></div>' +
    '<div class="signature"><div class="sig-line">' + labels.tenant + ': ' + (data.customer?.name ?? "___________") + '</div><div class="sig-line">' + labels.landlord + ': ' + labels.company + '</div></div>' +
    '<div class="footer">' + labels.company + ' - ' + new Date().toLocaleDateString() + '</div></body></html>';
  openPrintWindow(html);
}

// ── Overdue Notice ──

export interface OverdueNoticeData {
  customer: CustomerRow | null;
  unit: UnitRow | null;
  overdueAmount: number;
  overdueDays: number;
  dueDate: string;
  contractNo: string;
  sourceType: "lease_contract" | "sale_contract" | "daily_booking";
}

export function printOverdueNotice(data: OverdueNoticeData, locale: "zh" | "fr") {
  const zh2 = locale === "zh";
  const labels = zh2
    ? { title: "欠款催交通知单", company: "科建地产", dear: "尊敬的", notice: "您承租/购买的以下房源存在逾期未付款项，请于收到本通知后7日内结清。如有疑问请联系管理处。", unit: "房源", customer: "客户", contractNo: "合同编号", dueDate: "应付款日", overdueDays: "逾期天数", overdueAmount: "欠款金额", dayUnit: "天", contact: "联系电话", address: "地址" }
    : { title: "Avis de retard de paiement", company: "Kejian Immobilier", dear: "Cher/Chere", notice: "Le paiement pour le logement suivant est en retard. Veuillez regler dans les 7 jours.", unit: "Logement", customer: "Client", contractNo: "No contrat", dueDate: "Date", overdueDays: "Jours de retard", overdueAmount: "Montant du", dayUnit: "j", contact: "Telephone", address: "Adresse" };

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + labels.title + '</title>' + a4Styles + '</head><body>' +
    '<div class="header"><div class="company">' + labels.company + '</div><div class="meta">' + labels.title + '</div></div>' +
    '<h1>' + labels.title + '</h1>' +
    '<p style="font-size:13px;margin-bottom:12px">' + labels.dear + ' ' + (data.customer?.name ?? "___________") + '</p>' +
    '<p style="font-size:12px;color:#64748b;margin-bottom:16px">' + labels.notice + '</p>' +
    '<table>' +
    '<tr><td class="label">' + labels.unit + '</td><td class="value">' + (data.unit?.unit_no ?? "-") + '</td></tr>' +
    '<tr><td class="label">' + labels.contractNo + '</td><td class="value">' + data.contractNo + '</td></tr>' +
    '<tr><td class="label">' + labels.dueDate + '</td><td class="value">' + data.dueDate + '</td></tr>' +
    '<tr><td class="label">' + labels.overdueDays + '</td><td class="value" style="color:#dc2626;font-weight:700">' + data.overdueDays + ' ' + labels.dayUnit + '</td></tr>' +
    '<tr><td class="label">' + labels.overdueAmount + '</td><td class="value" style="color:#dc2626;font-size:16px;font-weight:800">' + formatXof(data.overdueAmount) + '</td></tr>' +
    '</table>' +
    '<div style="margin-top:24px"><p style="font-size:10px;color:#94a3b8">' + labels.contact + ': ___________  ' + labels.address + ': ___________</p></div>' +
    '<div class="footer">' + labels.company + ' - ' + new Date().toLocaleDateString() + '</div></body></html>';
  openPrintWindow(html);
}
