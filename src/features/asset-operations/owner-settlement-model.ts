import { isAssetDate } from "./asset-operations-model";

export const OWNER_SETTLEMENT_MAX = 999_999_999_999;
export type OwnerSettlementPaymentMethod = "cash" | "bank_transfer" | "check" | "other";

export interface OwnerSettlementInput {
  assetId: string;
  expectedUpdatedAt: string;
  expectedEvidenceHash: string;
  ownerName: string;
  shareBps: number;
  amountNative: number;
  currency: "XOF";
  cashDate: string;
  paymentMethod: OwnerSettlementPaymentMethod;
  periodStart: string;
  periodEnd: string;
  openingWholeCredit: number;
  closingWholeCredit: number;
  sourceRef: string;
  reason: string;
}

export interface OwnerSettlement {
  requestId: string;
  entryId: string;
  ownerName: string;
  shareBps: number;
  receiptAmountNative: number;
  currency: "XOF";
  cashDate: string;
  paymentMethod: OwnerSettlementPaymentMethod;
  periodStart: string;
  periodEnd: string;
  throughDate: string;
  monthlyRentNative: number;
  monthCount: number;
  wholeEquivalent: number;
  wholeOpeningCredit: number;
  wholeRent: number;
  wholeClosingCredit: number;
  sourceRef: string;
  reason: string;
  recordedBy: string;
  recordedAt: string;
}

export interface OwnerSettlementContext {
  assetId: string;
  assetName: string;
  expectedUpdatedAt: string;
  expectedEvidenceHash: string;
  monthlyRentNative: number;
  currency: "XOF";
  previousSettlement: OwnerSettlement | null;
}

export type OwnerSettlementFailure = { ok: false; error: string; rejected: boolean };
export type OwnerSettlementContextResult =
  { ok: true; context: OwnerSettlementContext } | OwnerSettlementFailure;
export type OwnerSettlementResult =
  { ok: true; settlement: OwnerSettlement; idempotent: boolean } | OwnerSettlementFailure;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isOwnerSettlementId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function record(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
    throw new Error("invalidOwnerSettlement");
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value
  );
}
function amount(value: unknown, positive = false): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= (positive ? 1 : 0) &&
    value <= OWNER_SETTLEMENT_MAX
  );
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function method(value: unknown): value is OwnerSettlementPaymentMethod {
  return typeof value === "string" && ["cash", "bank_transfer", "check", "other"].includes(value);
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function ownerSettlementMonthCount(start: unknown, end: unknown): number {
  if (!isAssetDate(start) || !isAssetDate(end) || start > end || !start.endsWith("-01"))
    throw new Error("invalidOwnerSettlementPeriod");
  const afterEnd = new Date(`${end}T00:00:00Z`);
  afterEnd.setUTCDate(afterEnd.getUTCDate() + 1);
  if (afterEnd.getUTCDate() !== 1) throw new Error("invalidOwnerSettlementPeriod");
  const months =
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(end.slice(5, 7)) -
    Number(start.slice(5, 7)) +
    1;
  if (months > 120) throw new Error("invalidOwnerSettlementPeriod");
  return months;
}

export function parseOwnerSettlementInput(value: unknown, today: string): OwnerSettlementInput {
  const row = record(value, [
    "assetId",
    "expectedUpdatedAt",
    "expectedEvidenceHash",
    "ownerName",
    "shareBps",
    "amountNative",
    "currency",
    "cashDate",
    "paymentMethod",
    "periodStart",
    "periodEnd",
    "openingWholeCredit",
    "closingWholeCredit",
    "sourceRef",
    "reason",
  ]);
  if (
    !isOwnerSettlementId(row.assetId) ||
    !timestamp(row.expectedUpdatedAt) ||
    !hash(row.expectedEvidenceHash) ||
    !text(row.ownerName, 200) ||
    !Number.isInteger(row.shareBps) ||
    (row.shareBps as number) < 1 ||
    (row.shareBps as number) > 10_000 ||
    !amount(row.amountNative, true) ||
    row.currency !== "XOF" ||
    !isAssetDate(row.cashDate) ||
    !isAssetDate(today) ||
    row.cashDate > today ||
    !method(row.paymentMethod) ||
    !amount(row.openingWholeCredit) ||
    !amount(row.closingWholeCredit) ||
    !text(row.sourceRef, 500) ||
    !text(row.reason, 2000)
  )
    throw new Error("invalidOwnerSettlement");
  ownerSettlementMonthCount(row.periodStart, row.periodEnd);
  const numerator = BigInt(row.amountNative) * BigInt(10_000);
  if (
    numerator % BigInt(row.shareBps as number) !== BigInt(0) ||
    numerator / BigInt(row.shareBps as number) > BigInt(OWNER_SETTLEMENT_MAX)
  )
    throw new Error("ownerSettlementEquationMismatch");
  return row as unknown as OwnerSettlementInput;
}

/** All operands are whole XOF; never round a share conversion or a credit. */
export function ownerSettlementPreview(input: OwnerSettlementInput, monthlyRentNative: number) {
  if (!amount(monthlyRentNative, true)) throw new Error("ownerSettlementRentRequired");
  const monthCount = ownerSettlementMonthCount(input.periodStart, input.periodEnd);
  const numerator = BigInt(input.amountNative) * BigInt(10_000);
  if (numerator % BigInt(input.shareBps) !== BigInt(0))
    throw new Error("ownerSettlementEquationMismatch");
  const wholeEquivalent = numerator / BigInt(input.shareBps);
  const wholeRent = BigInt(monthlyRentNative) * BigInt(monthCount);
  if (wholeEquivalent > BigInt(OWNER_SETTLEMENT_MAX) || wholeRent > BigInt(OWNER_SETTLEMENT_MAX))
    throw new Error("invalidOwnerSettlement");
  return {
    monthCount,
    wholeEquivalent: Number(wholeEquivalent),
    wholeRent: Number(wholeRent),
    balanced:
      BigInt(input.openingWholeCredit) + wholeEquivalent ===
      wholeRent + BigInt(input.closingWholeCredit),
  };
}

export function readOwnerSettlement(value: unknown): OwnerSettlement {
  const row = record(value, [
    "requestId",
    "entryId",
    "ownerName",
    "shareBps",
    "receiptAmountNative",
    "currency",
    "cashDate",
    "paymentMethod",
    "periodStart",
    "periodEnd",
    "throughDate",
    "monthlyRentNative",
    "monthCount",
    "wholeEquivalent",
    "wholeOpeningCredit",
    "wholeRent",
    "wholeClosingCredit",
    "sourceRef",
    "reason",
    "recordedBy",
    "recordedAt",
  ]);
  if (
    !isOwnerSettlementId(row.requestId) ||
    !isOwnerSettlementId(row.entryId) ||
    !isOwnerSettlementId(row.recordedBy) ||
    !timestamp(row.recordedAt) ||
    row.throughDate !== row.periodEnd
  )
    throw new Error("invalidOwnerSettlement");
  const input = parseOwnerSettlementInput(
    {
      assetId: row.entryId,
      expectedUpdatedAt: row.recordedAt,
      expectedEvidenceHash: "0".repeat(32),
      ownerName: row.ownerName,
      shareBps: row.shareBps,
      amountNative: row.receiptAmountNative,
      currency: row.currency,
      cashDate: row.cashDate,
      paymentMethod: row.paymentMethod,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      openingWholeCredit: row.wholeOpeningCredit,
      closingWholeCredit: row.wholeClosingCredit,
      sourceRef: row.sourceRef,
      reason: row.reason,
    },
    "9999-12-31",
  );
  const preview = ownerSettlementPreview(input, row.monthlyRentNative as number);
  if (
    !preview.balanced ||
    preview.monthCount !== row.monthCount ||
    preview.wholeEquivalent !== row.wholeEquivalent ||
    preview.wholeRent !== row.wholeRent
  )
    throw new Error("ownerSettlementEquationMismatch");
  return row as unknown as OwnerSettlement;
}

export function readOwnerSettlementContext(
  value: unknown,
  assetId: string,
): OwnerSettlementContext {
  const row = record(value, [
    "assetId",
    "assetName",
    "expectedUpdatedAt",
    "expectedEvidenceHash",
    "monthlyRentNative",
    "currency",
    "previousSettlement",
  ]);
  if (
    row.assetId !== assetId ||
    !isOwnerSettlementId(row.assetId) ||
    !text(row.assetName, 500) ||
    !timestamp(row.expectedUpdatedAt) ||
    !hash(row.expectedEvidenceHash) ||
    !amount(row.monthlyRentNative, true) ||
    row.currency !== "XOF"
  )
    throw new Error("invalidOwnerSettlement");
  return {
    ...row,
    previousSettlement:
      row.previousSettlement === null ? null : readOwnerSettlement(row.previousSettlement),
  } as OwnerSettlementContext;
}

export function verifyOwnerSettlementResult(
  value: unknown,
  input: OwnerSettlementInput,
  requestId: string,
  actorId: string,
): { settlement: OwnerSettlement; idempotent: boolean } {
  const result = record(value, ["success", "data", "idempotent"]);
  const data = record(result.data, ["assetId", "entryId", "ownerSettlement"]);
  const settlement = readOwnerSettlement(data.ownerSettlement);
  if (
    result.success !== true ||
    typeof result.idempotent !== "boolean" ||
    data.assetId !== input.assetId ||
    data.entryId !== settlement.entryId ||
    settlement.requestId !== requestId ||
    settlement.recordedBy !== actorId
  )
    throw new Error("assetOperationResultUnknown");
  const expected = {
    ownerName: input.ownerName,
    shareBps: input.shareBps,
    receiptAmountNative: input.amountNative,
    currency: input.currency,
    cashDate: input.cashDate,
    paymentMethod: input.paymentMethod,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    wholeOpeningCredit: input.openingWholeCredit,
    wholeClosingCredit: input.closingWholeCredit,
    sourceRef: input.sourceRef,
    reason: input.reason,
  };
  if (
    !Object.entries(expected).every(
      ([key, entry]) => settlement[key as keyof OwnerSettlement] === entry,
    )
  )
    throw new Error("assetOperationResultUnknown");
  return { settlement, idempotent: result.idempotent };
}

const messages: Record<string, [string, string]> = {
  ownerSettlementContextUnavailable: [
    "暂时无法读取结算依据，请稍后重新读取。",
    "Impossible de charger les données du règlement. Réessayez.",
  ],
  invalidOwnerSettlement: [
    "请填写完整信息；金额为西法元整数，股比最多两位小数。",
    "Renseignez tous les champs ; montants XOF entiers et quote-part à deux décimales maximum.",
  ],
  invalidOwnerSettlementPeriod: [
    "结算期须从每月 1 日起，至月末止，按完整自然月登记。",
    "La période doit couvrir des mois civils entiers, du premier au dernier jour.",
  ],
  ownerSettlementEquationMismatch: [
    "结算等式不平或股比换算不是西法整数，请核对金额、股比和结余。",
    "L’équation ne concorde pas ou la conversion n’est pas un entier XOF.",
  ],
  ownerSettlementCreditConflict: [
    "期初整厂结余与上次结算不符，请重新核对。",
    "Le crédit d’ouverture diffère du dernier règlement.",
  ],
  ownerSettlementPeriodConflict: [
    "结算期与已登记期间重复或冲突，请核对。",
    "Cette période chevauche un règlement enregistré.",
  ],
  ownerSettlementHistoryConflict: [
    "业主、股比或历史结算信息冲突，请核对原记录。",
    "Le propriétaire, la quote-part ou l’historique ne concorde pas.",
  ],
  ownerSettlementEvidenceRequired: [
    "缺少已核实的租赁依据，暂不能登记。",
    "Une pièce locative vérifiée est requise.",
  ],
  ownerSettlementRentRequired: [
    "须先核实整厂月租为西法金额。",
    "Le loyer mensuel global en XOF doit être confirmé.",
  ],
  ownerSettlementReceiptLinked: [
    "这笔收款已用于业主分账结算，请先核对分账更正，不能单独作废。",
    "Cette recette est liée à un règlement du propriétaire ; vérifiez d’abord la correction du règlement, elle ne peut pas être annulée seule.",
  ],
  assetOperationRecordChanged: [
    "资产资料已更新，请关闭表单后重新读取。",
    "L’actif a changé ; fermez puis rouvrez le formulaire.",
  ],
  assetSourceAlreadyRecorded: [
    "该凭据来源已登记，请核对原记录。",
    "Cette source est déjà enregistrée.",
  ],
  assetOperationPermissionDenied: [
    "当前账号没有登记权限。",
    "Ce compte ne peut pas enregistrer ce règlement.",
  ],
  assetOperationAccessDenied: [
    "当前账号无权访问该资产。",
    "Ce compte ne peut pas accéder à cet actif.",
  ],
  assetOperationNotFound: ["未找到该资产。", "Actif introuvable."],
};
export function ownerSettlementError(error: string, zh: boolean) {
  return (
    messages[error]?.[zh ? 0 : 1] ??
    (zh
      ? "结果未确认，请保留原请求并按原请求重试；不要重复登记。"
      : "Résultat non confirmé. Réessayez la même requête sans créer un nouveau règlement.")
  );
}
export const ownerSettlementBusinessErrors = Object.keys(messages);
