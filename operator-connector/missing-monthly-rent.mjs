/** Dedicated v1 workflow; no generic RPC name, SQL, currency conversion or coverage mutation. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = [
  "requestId",
  "contractId",
  "periodStart",
  "periodEnd",
  "amountXof",
  "paymentDate",
  "paymentMethod",
  "reason",
  "inputSource",
  "externalReceiptNo",
];
function date(v) {
  return (
    typeof v === "string" &&
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
    new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v
  );
}
export function parseMissingMonthlyRent(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    !uuid.test(value.requestId ?? "") ||
    !uuid.test(value.contractId ?? "") ||
    !date(value.periodStart) ||
    !date(value.periodEnd) ||
    !date(value.paymentDate) ||
    !value.periodStart.endsWith("-01") ||
    value.periodEnd !==
      new Date(
        Date.UTC(Number(value.periodStart.slice(0, 4)), Number(value.periodStart.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10) ||
    !Number.isSafeInteger(value.amountXof) ||
    value.amountXof <= 0 ||
    value.amountXof > 999999999999 ||
    !["cash", "check", "bank_transfer", "other"].includes(value.paymentMethod) ||
    !["natural_language", "excel_screenshot"].includes(value.inputSource) ||
    typeof value.reason !== "string" ||
    value.reason.trim().length < 10 ||
    value.reason.length > 1000 ||
    ("externalReceiptNo" in value &&
      (typeof value.externalReceiptNo !== "string" ||
        !value.externalReceiptNo.trim() ||
        value.externalReceiptNo.length > 200))
  )
    throw new Error("invalid_missing_monthly_rent");
  return structuredClone(value);
}
function canonical(v) {
  return Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
}
function same(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function verifyMissingMonthlyRent(result, request, preparedInput, actorId) {
  const r = parseMissingMonthlyRent(request),
    c = result?.currentContract,
    bill = result?.currentReceivable;
  const payments = result?.currentPayments,
    ids = result?.collection?.paymentIds;
  if (
    result?.status !== "completed" ||
    result.requestId !== r.requestId ||
    result.actorId !== actorId ||
    result.contractId !== r.contractId ||
    result.periodStart !== r.periodStart ||
    result.periodEnd !== r.periodEnd ||
    result.amountXof !== r.amountXof ||
    result.paymentDate !== r.paymentDate ||
    result.paymentMethod !== r.paymentMethod ||
    !same(result.input, preparedInput) ||
    !uuid.test(result.receivableId ?? "") ||
    c?.id !== r.contractId ||
    c.paid_through_date !== result.paidThroughDate ||
    bill?.id !== result.receivableId ||
    bill.source_id !== r.contractId ||
    bill.source_type !== "lease_contract" ||
    bill.unit_id !== c.unit_id ||
    bill.customer_id !== c.customer_id ||
    bill.category !== "lease_rent" ||
    bill.currency !== "XOF" ||
    bill.status !== "paid" ||
    Number(bill.amount_xof) !== r.amountXof ||
    Number(bill.paid_amount_xof) !== r.amountXof ||
    bill.service_period_start !== r.periodStart ||
    bill.service_period_end !== r.periodEnd ||
    bill.service_period_confirmed_by !== actorId ||
    bill.service_period_source !== r.reason.trim() ||
    !Array.isArray(payments) ||
    payments.length !== 1 ||
    !Array.isArray(ids) ||
    ids.length !== 1 ||
    ids[0] !== payments[0].id ||
    payments[0].source_id !== r.contractId ||
    payments[0].unit_id !== c.unit_id ||
    payments[0].customer_id !== c.customer_id ||
    payments[0].source_type !== "lease_rent" ||
    Number(payments[0].amount) !== r.amountXof ||
    payments[0].currency !== "XOF" ||
    Number(payments[0].exchange_rate_to_xof) !== 1 ||
    payments[0].payment_date !== r.paymentDate ||
    payments[0].payment_method !== r.paymentMethod ||
    payments[0].recorded_by !== actorId ||
    payments[0].reversal_of_payment_id !== null ||
    (payments[0].external_receipt_no ?? null) !== (r.externalReceiptNo ?? null)
  )
    throw new Error("missing_rent_readback_requires_review");
  return {
    status: "completed",
    verified: true,
    requestId: r.requestId,
    contractId: r.contractId,
    receivableId: bill.id,
    paymentId: payments[0].id,
    amountXof: r.amountXof,
    paymentDate: r.paymentDate,
    paymentMethod: r.paymentMethod,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    paidThroughDate: c.paid_through_date,
    referenceNos: result.collection.referenceNos,
  };
}
export class MissingMonthlyRentClient {
  constructor(operator, transport = fetch) {
    this.operator = operator;
    this.fetch = transport;
  }
  async identity() {
    const c = await this.operator.capabilities();
    if (c.identity?.role !== "admin") throw new Error("missing_rent_permission_denied");
    return c.identity.userId;
  }
  async rpc(name, body) {
    if (
      ![
        "missing_rent_collection_review_rpc",
        "missing_rent_collection_status_rpc",
        "collect_missing_monthly_rent_rpc",
      ].includes(name)
    )
      throw new Error("unsupported_missing_rent_operation");
    const token = await this.operator.token(),
      config = this.operator.config;
    let response;
    try {
      response = await this.fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("missing_rent_outcome_unknown_keep_original_request_id");
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("missing_rent_outcome_unknown_keep_original_request_id");
    }
    if (!response.ok)
      throw new Error(
        /^(missingRent|invalidMissingRent|requestIdConflict)[A-Za-z]*$/.test(data?.message ?? "")
          ? data.message
          : "missing_rent_server_result_requires_review",
      );
    return data;
  }
  async prepare(request) {
    const r = parseMissingMonthlyRent(request),
      actorId = await this.identity();
    const prior = await this.rpc("missing_rent_collection_status_rpc", {
      p_request_id: r.requestId,
    });
    if (prior?.status !== "not_found" || prior.requestId !== r.requestId)
      throw new Error("missing_rent_original_request_requires_review");
    const review = await this.rpc("missing_rent_collection_review_rpc", {
      p_contract_id: r.contractId,
    });
    if (
      review?.protocolVersion !== 1 ||
      review.actorId !== actorId ||
      review.contractId !== r.contractId ||
      !/^[0-9a-f]{32}$/.test(review.token ?? "")
    )
      throw new Error("missing_rent_protocol_not_available");
    const { requestId, contractId, ...input } = r;
    return { request: r, actorId, input: { ...input, expectedToken: review.token }, review };
  }
  async status(prepared) {
    const r = parseMissingMonthlyRent(prepared.request),
      actorId = await this.identity();
    if (actorId !== prepared.actorId) throw new Error("session_identity_changed");
    const s = await this.rpc("missing_rent_collection_status_rpc", { p_request_id: r.requestId });
    return s?.status === "not_found" ? s : verifyMissingMonthlyRent(s, r, prepared.input, actorId);
  }
  async execute(prepared) {
    const r = parseMissingMonthlyRent(prepared.request),
      actorId = await this.identity();
    const { requestId, contractId, ...input } = r;
    if (
      actorId !== prepared.actorId ||
      !same({ ...input, expectedToken: prepared.input?.expectedToken }, prepared.input)
    )
      throw new Error("missing_rent_prepared_request_changed");
    const prior = await this.status(prepared);
    if (prior?.status !== "not_found") return { ...prior, status: "completed_previously" };
    const result = await this.rpc("collect_missing_monthly_rent_rpc", {
      p_contract_id: r.contractId,
      p_input: prepared.input,
      p_request_id: r.requestId,
    });
    if (
      result?.status !== "completed" ||
      result.requestId !== r.requestId ||
      result.actorId !== actorId
    )
      throw new Error("missing_rent_outcome_unknown_keep_original_request_id");
    return this.status(prepared);
  }
}
