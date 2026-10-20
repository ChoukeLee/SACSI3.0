import type { Locale } from "@/lib/i18n";
import type { AuditLogRow } from "./audit-log-enrichment";

export function auditText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function auditActorKey(log: AuditLogRow) {
  return auditText(log.actor_id) || auditText(log.actor_email) || "unknown";
}

export function auditActorText(log: AuditLogRow, locale: Locale) {
  // A name embedded in an instruction/metadata is not authentication evidence.
  // A current profile name is supplementary and is only shown when the immutable
  // audit row contains an authenticated account id/email.
  const account = auditText(log.actor_email) || auditText(log.actor_id);
  if (!account) return locale === "zh" ? "未记录登录账号" : "Compte connecté non enregistré";
  const name = auditText(log.resolved_actor_display_name);
  return name ? `${name} · ${account}` : account;
}

export function auditChannel(
  log: AuditLogRow,
): "external_codex" | "sacsi_web" | "explicit_user_authorized_maintenance" | "unknown" {
  const channel = auditText(log.metadata?.channel);
  return channel === "external_codex" ||
    channel === "sacsi_web" ||
    channel === "explicit_user_authorized_maintenance"
    ? channel
    : "unknown";
}

export function auditChannelLabel(channel: ReturnType<typeof auditChannel>, locale: Locale) {
  if (channel === "external_codex") return locale === "zh" ? "外部 Codex" : "Codex externe";
  if (channel === "sacsi_web") return locale === "zh" ? "SACSI 网页" : "Site SACSI";
  if (channel === "explicit_user_authorized_maintenance")
    return locale === "zh" ? "授权维护（记录值）" : "Maintenance autorisée (valeur enregistrée)";
  return locale === "zh" ? "未记录渠道" : "Canal non enregistré";
}

export function auditIdentityStatus(
  log: AuditLogRow,
): "account_recorded" | "maintenance_without_account" | "missing_account" {
  // Classify recorded evidence, never infer the person or verify a maintenance
  // authorization from metadata alone. Directory labels are not identity proof.
  if (auditText(log.actor_id) || auditText(log.actor_email)) return "account_recorded";
  return auditChannel(log) === "explicit_user_authorized_maintenance"
    ? "maintenance_without_account"
    : "missing_account";
}

export function auditIdentityLabel(status: ReturnType<typeof auditIdentityStatus>, locale: Locale) {
  if (status === "account_recorded")
    return locale === "zh" ? "已记录登录账号" : "Compte enregistré";
  if (status === "maintenance_without_account")
    return locale === "zh" ? "维护记录：无登录账号" : "Maintenance : sans compte enregistré";
  return locale === "zh" ? "缺少登录账号" : "Compte non enregistré";
}

function amount(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value)))
    return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function auditMoney(value: unknown, locale: Locale) {
  const n = amount(value);
  return n === null ? "—" : `${n.toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR")} XOF`;
}

function auditObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Only recorded currencies and exact minor units; never infer XOF or an FX value. */
export function auditNativeMoney(value: unknown, currency: unknown, locale: Locale) {
  if (currency !== "XOF" && currency !== "USD" && currency !== "CNY") return "—";
  if (typeof value !== "number" && typeof value !== "string") return "—";
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return "—";
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > 99999999999999) return "—";
  return `${(minor / 100).toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR", { maximumFractionDigits: 2 })} ${currency}`;
}

function auditStrings(value: unknown) {
  return Array.isArray(value) ? value.map(auditText).filter(Boolean) : [];
}

function auditDateValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  const text = auditText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text) return text;
  }
  return undefined;
}

function auditDate(value: unknown, locale: Locale) {
  const date = auditDateValue(value);
  if (date === null) return locale === "zh" ? "未设置" : "Non définie";
  return date ?? (locale === "zh" ? "未记录" : "Non enregistrée");
}

export function auditLeaseCollectionEvidence(log: AuditLogRow, locale: Locale) {
  if (log.action !== "record_lease_collection") return null;
  const zh = locale === "zh";
  const meta = log.metadata ?? {};
  // The paged read RPC replaces these projection keys from the saved result;
  // it never trusts same-named keys in the original user metadata.
  const input = auditObject(log.after_data === null ? meta.collection_input : meta.input);
  const after = log.after_data ?? auditObject(meta.collection_result);
  const confirmed = after.success === true;
  const currency = confirmed ? auditText(after.currency) : "";
  const formattedAmount = confirmed ? auditNativeMoney(after.totalAmount, currency, locale) : "—";
  const originals = Array.isArray(log.before_data?.receivables)
    ? log.before_data.receivables.map(auditObject)
    : [];
  const allocations =
    confirmed && Array.isArray(after.allocations)
      ? after.allocations.map((value) => {
          const row = auditObject(value);
          const receivableId = auditText(row.receivableId);
          const original = originals.find((bill) => auditText(bill.id) === receivableId);
          const rowCurrency = auditText(row.currency);
          return {
            receivableId,
            paymentId: auditText(row.paymentId),
            currency: rowCurrency,
            amount: auditNativeMoney(row.amount, rowCurrency, locale),
            title: original ? auditText(original.title) : "",
            category: original ? auditText(original.category) : "",
            servicePeriodStart: original ? auditText(original.service_period_start) : "",
            servicePeriodEnd: original ? auditText(original.service_period_end) : "",
          };
        })
      : [];
  const before = Object.hasOwn(after, "paidThroughBefore")
    ? after.paidThroughBefore
    : log.before_data?.paidThroughDate;
  const beforeDate = auditDateValue(before);
  const afterDate = auditDateValue(after.paidThroughAfter);
  const coverage = auditObject(after.coverage);
  return {
    confirmed,
    amount: formattedAmount === "—" ? "" : formattedAmount,
    currency,
    requestId: confirmed ? auditText(after.requestId) : "",
    paymentDate: auditText(input.paymentDate),
    paymentMethod: auditText(input.paymentMethod),
    actualCollector: auditText(input.actualCollector),
    collectorBasis: auditText(input.collectorBasis),
    externalReceiptNo: auditText(input.externalReceiptNo),
    notes: auditText(input.notes),
    paymentIds: confirmed ? auditStrings(after.paymentIds) : [],
    referenceNos: confirmed ? auditStrings(after.referenceNos) : [],
    paidThroughBefore: auditDate(before, locale),
    paidThroughAfter: auditDate(after.paidThroughAfter, locale),
    coverageStatus:
      confirmed &&
      meta.coverage_explicitly_confirmed === true &&
      beforeDate !== undefined &&
      typeof afterDate === "string" &&
      coverage.throughDate === afterDate
        ? zh
          ? "明确确认后同步（见实际前后值）"
          : "Synchronisée après confirmation explicite (voir les valeurs réelles)"
        : confirmed &&
            meta.paid_through_unchanged === true &&
            beforeDate !== undefined &&
            afterDate !== undefined &&
            beforeDate === afterDate
          ? zh
            ? "保持不变"
            : "Inchangée"
          : zh
            ? "未记录同步结论"
            : "Conclusion non enregistrée",
    allocations,
  };
}

export function auditBusinessSummary(log: AuditLogRow, locale: Locale) {
  const zh = locale === "zh";
  const meta = log.metadata ?? {};
  const leaseCollection = auditLeaseCollectionEvidence(log, locale);
  const requestId = leaseCollection?.requestId || auditText(meta.request_id);
  const agentId = auditText(meta.booking_agent_id);
  // Current directory lookup is supplementary, not a historical name snapshot.
  const agentName = auditText(log.resolved_booking_agent_name);
  const inputSources: Record<string, string> = zh
    ? {
        natural_language: "自然语言",
        manual_form: "手工表单",
        excel_screenshot: "Excel 截图",
        structured_batch: "批量清单",
      }
    : {
        natural_language: "Langage naturel",
        manual_form: "Formulaire",
        excel_screenshot: "Capture Excel",
        structured_batch: "Lot structuré",
      };
  const dailyPayment =
    log.entity_type === "daily_booking" && log.action === "supplementary_payment";
  const collectionPayment = log.action === "operator_collection_item";
  const bookingPlan =
    meta.plan && typeof meta.plan === "object" && !Array.isArray(meta.plan)
      ? (meta.plan as Record<string, unknown>)
      : {};
  const operationMoney = ["operator_booking_reverse", "operator_booking_refund"].includes(
    log.action,
  );
  const paymentAmount =
    dailyPayment || collectionPayment
      ? amount(meta.amount)
      : operationMoney
        ? amount(bookingPlan.amountXof)
        : null;
  const bookingOperationNames: Record<string, string> = zh
    ? {
        create: "新建日租预订",
        check_in: "办理入住（不收款）",
        cancel: "取消未入住预订",
        change_stay: "调整住期或房价",
        transfer: "转移未入住预订",
        correct_room: "纠正录错房号",
        reverse: "冲正错误收款（非实际退款）",
        refund: "登记实际退款",
        void_checkin: "撤销误入住",
      }
    : {
        create: "Réservation",
        check_in: "Arrivée sans paiement",
        cancel: "Annulation",
        change_stay: "Dates ou tarif",
        transfer: "Transfert de réservation",
        correct_room: "Correction du logement",
        reverse: "Contrepassation (sans remboursement)",
        refund: "Remboursement réel",
        void_checkin: "Correction arrivée erronée",
      };
  const bookingOperation = log.action.startsWith("operator_booking_")
    ? log.action.slice("operator_booking_".length)
    : "";
  const operationSummary = bookingOperationNames[bookingOperation]
    ? `${bookingOperationNames[bookingOperation]}${paymentAmount !== null ? ` ${auditMoney(paymentAmount, locale)}` : ""}${bookingOperation === "correct_room" ? ` ${auditText(bookingPlan.unitCode)} → ${auditText(bookingPlan.targetUnitCode)}` : ""}`
    : "";
  const summary = leaseCollection
    ? `${zh ? "登记长租实收并核销" : "Encaissement locatif affecté"}${leaseCollection.amount ? ` ${leaseCollection.amount}` : zh ? "（结果金额未记录）" : " (montant confirmé non enregistré)"}`
    : operationSummary ||
      (paymentAmount !== null
        ? `${collectionPayment ? (zh ? "截图分账收款" : "Encaissement ventilé") : zh ? "登记日租收款" : "Paiement journalier enregistré"} ${auditMoney(paymentAmount, locale)}`
        : "");
  return {
    actor: auditActorText(log, locale),
    actorId: log.actor_id || "",
    identityStatus: auditIdentityLabel(auditIdentityStatus(log), locale),
    channel: auditChannelLabel(auditChannel(log), locale),
    requestId,
    agent: agentName
      ? `${agentName}（${zh ? "当前名称" : "nom actuel"}）`
      : agentId || (zh ? "未记录" : "Non enregistré"),
    agentId,
    summary,
    paymentAmount:
      leaseCollection?.amount || (paymentAmount === null ? "" : auditMoney(paymentAmount, locale)),
    paymentDate: leaseCollection?.paymentDate || auditText(meta.payment_date),
    receiptNo: leaseCollection
      ? leaseCollection.referenceNos.join(" · ")
      : auditText(meta.receipt_no),
    beforePaid:
      dailyPayment || bookingOperation
        ? auditMoney(log.before_data?.prepaid_amount_xof, locale)
        : collectionPayment
          ? auditMoney(log.before_data?.paid_amount_xof, locale)
          : "",
    afterPaid:
      dailyPayment || bookingOperation
        ? auditMoney(log.after_data?.prepaid_amount_xof, locale)
        : collectionPayment
          ? auditMoney(log.after_data?.paid_amount_xof, locale)
          : "",
    sourceText: auditText(meta.source_text),
    lineId: auditText(meta.line_id),
    childRequestId: auditText(meta.child_request_id),
    instruction: auditText(meta.original_instruction),
    source:
      inputSources[auditText(meta.input_source)] ||
      (zh ? "未记录 / 未识别" : "Non enregistré / inconnu"),
    connectorVersion: auditText(meta.connector_version),
    protocolVersion: auditText(meta.protocol_version),
    leaseCollection,
  };
}

export function auditSearchText(log: AuditLogRow, locale: Locale) {
  const info = auditBusinessSummary(log, locale);
  return [
    info.actor,
    info.actorId,
    info.agent,
    info.agentId,
    info.channel,
    info.requestId,
    info.receiptNo,
    info.instruction,
    info.summary,
    info.identityStatus,
    info.leaseCollection?.actualCollector,
    info.leaseCollection?.externalReceiptNo,
    ...(info.leaseCollection?.paymentIds ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

/** Export text, never spreadsheet formulas. Applied to every audit export cell. */
export function auditExportCell(value: string | number) {
  // The shared CSV encoder quotes LF; normalize CR so multiline instructions
  // cannot become an unquoted extra spreadsheet row.
  const text = String(value).replace(/\r\n?/g, "\n");
  return /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
}
