// Standalone mirror of the controlled HTTP contract/verifier. No generic SQL or table patches.
import { isDeepStrictEqual } from "node:util";
export class CimacMaintenanceFailure extends Error {
    code;
    status;
    constructor(code, status = 400) {
        super(code);
        this.code = code;
        this.status = status;
    }
}
const invalid = () => new CimacMaintenanceFailure("invalidCimacMaintenance");
export function cimacObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function cimacOnlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
}
export function cimacUuid(value) {
    return (typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
function id(value) {
    if (!cimacUuid(value))
        throw invalid();
    return value.toLowerCase();
}
function text(value, maximum) {
    if (typeof value !== "string" ||
        !value.trim() ||
        value.length > maximum ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
        throw invalid();
    return value.trim();
}
export function cimacDate(value) {
    return (typeof value === "string" &&
        /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value);
}
/** Decimal strings only: prevent IEEE rounding and accidental ten-thousand units. */
export function cimacMoney(value, currency, allowZero = false) {
    if (typeof value !== "string" ||
        !(currency === "XOF" ? /^(0|[1-9]\d{0,11})$/ : /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).test(value))
        throw invalid();
    const [whole, fraction = ""] = value.split(".");
    if (!allowZero && BigInt(whole) === BigInt(0) && !/[1-9]/.test(fraction))
        throw invalid();
    return currency === "XOF" ? whole : `${whole}.${fraction.padEnd(2, "0")}`;
}
function ids(value, allowEmpty = false) {
    if (!Array.isArray(value) || value.length > 30 || (!allowEmpty && !value.length))
        throw invalid();
    const result = value.map(id);
    if (new Set(result).size !== result.length)
        throw invalid();
    return result;
}
function strings(value) {
    if (!Array.isArray(value) || !value.length || value.length > 30)
        throw invalid();
    const result = value.map(unitNo);
    if (new Set(result).size !== result.length)
        throw invalid();
    return result;
}
function unitNo(value) {
    const result = text(value, 20);
    if (!/^\d{3,4}$/.test(result))
        throw invalid();
    return result;
}
function area(value) {
    const result = cimacMoney(value, "CNY");
    if (BigInt(result.replace(".", "")) > BigInt("9999999999"))
        throw invalid();
    return result;
}
function record(value, keys) {
    if (!cimacObject(value) || !cimacOnlyKeys(value, keys))
        throw invalid();
    return value;
}
function receipt(value, currency, today, extra = []) {
    const row = record(value, ["amount", "currency", "paymentDate", "paymentMethod", ...extra]);
    if (row.currency !== currency ||
        !cimacDate(row.paymentDate) ||
        row.paymentDate > today ||
        row.paymentMethod !== (currency === "XOF" ? "cash" : "bank_transfer"))
        throw invalid();
    return {
        amount: cimacMoney(row.amount, currency),
        currency,
        paymentDate: row.paymentDate,
        paymentMethod: row.paymentMethod,
    };
}
function noteReceipt(value, today) {
    const base = receipt(value, "CNY", today, ["contractId", "noteMarker"]);
    const row = value;
    return { ...base, contractId: id(row.contractId), noteMarker: text(row.noteMarker, 1000) };
}
function refund(value, today) {
    const base = receipt(value, "CNY", today, ["originalPaymentIds"]);
    return {
        ...base,
        originalPaymentIds: ids(value.originalPaymentIds, true),
    };
}
function reservationTerms(row) {
    const result = {
        monthlyRentXof: cimacMoney(row.monthlyRentXof, "XOF"),
        depositXof: cimacMoney(row.depositXof, "XOF"),
    };
    if (BigInt(result.depositXof) !== BigInt(result.monthlyRentXof) * BigInt(3))
        throw invalid();
    return result;
}
function operation(value, today) {
    if (!cimacObject(value))
        throw invalid();
    const common = ["type", "customerName", "annotation"];
    const base = () => ({
        customerName: text(value.customerName, 200),
        annotation: text(value.annotation, 2000),
    });
    const contracts = () => ({ ...base(), contractIds: ids(value.contractIds) });
    const terms = ["monthlyRentXof", "depositXof"];
    const rate = () => {
        const result = cimacMoney(value.propertyRateXofPerSqm, "XOF");
        if (result !== "900")
            throw invalid();
        return result;
    };
    switch (value.type) {
        case "terms": {
            record(value, [
                ...common,
                "contractIds",
                ...terms,
                "freeMonths",
                "rentFreeStart",
                "rentFreeEnd",
                "propertyRateXofPerSqm",
            ]);
            if (value.freeMonths !== 12 ||
                value.rentFreeStart !== "2027-04-01" ||
                value.rentFreeEnd !== "2028-03-31")
                throw invalid();
            return {
                type: "terms",
                ...contracts(),
                ...reservationTerms(value),
                freeMonths: Number(value.freeMonths),
                rentFreeStart: value.rentFreeStart,
                rentFreeEnd: value.rentFreeEnd,
                propertyRateXofPerSqm: rate(),
            };
        }
        case "close": {
            record(value, [...common, "contractIds", "correctedCustomerName", "refund", "noteReceipt"]);
            const result = {
                type: "close",
                ...contracts(),
                refund: refund(value.refund, today),
            };
            if (value.correctedCustomerName !== undefined)
                result.correctedCustomerName = text(value.correctedCustomerName, 200);
            if (value.noteReceipt !== undefined) {
                result.noteReceipt = noteReceipt(value.noteReceipt, today);
                if (!result.contractIds.includes(result.noteReceipt.contractId) ||
                    result.noteReceipt.paymentDate > result.refund.paymentDate ||
                    result.noteReceipt.amount !== result.refund.amount ||
                    result.refund.originalPaymentIds.length !== 0)
                    throw invalid();
            }
            else if (!result.refund.originalPaymentIds.length)
                throw invalid();
            return result;
        }
        case "replace": {
            record(value, [...common, "contractIds", ...terms, "refund", "newCustomerName", "receipt"]);
            const result = {
                type: "replace",
                ...contracts(),
                ...reservationTerms(value),
                refund: refund(value.refund, today),
                newCustomerName: text(value.newCustomerName, 200),
                receipt: receipt(value.receipt, "XOF", today),
            };
            if (result.contractIds.length !== 1 ||
                !result.refund.originalPaymentIds.length ||
                result.newCustomerName === result.customerName ||
                result.receipt.amount !== result.depositXof)
                throw invalid();
            return result;
        }
        case "reserve": {
            record(value, [...common, "unitNos", "groupMonthlyRentXof", "groupDepositXof"]);
            const result = {
                type: "reserve",
                ...base(),
                unitNos: strings(value.unitNos),
                groupMonthlyRentXof: cimacMoney(value.groupMonthlyRentXof, "XOF"),
                groupDepositXof: cimacMoney(value.groupDepositXof, "XOF"),
            };
            if (BigInt(result.groupDepositXof) !== BigInt(result.groupMonthlyRentXof) * BigInt(3))
                throw invalid();
            return result;
        }
        case "area":
            record(value, [...common, "unitNo", "areaSqm", "propertyRateXofPerSqm"]);
            return {
                type: "area",
                ...base(),
                unitNo: unitNo(value.unitNo),
                areaSqm: area(value.areaSqm),
                propertyRateXofPerSqm: rate(),
            };
        case "create_reservation": {
            record(value, [
                ...common,
                ...terms,
                "buildingCode",
                "unitNo",
                "areaSqm",
                "propertyRateXofPerSqm",
            ]);
            const number = unitNo(value.unitNo);
            const buildingCode = text(value.buildingCode, 80);
            if (buildingCode !== `CIMAC-B${number.slice(0, -2).padStart(2, "0")}`)
                throw invalid();
            return {
                type: "create_reservation",
                ...base(),
                ...reservationTerms(value),
                buildingCode,
                unitNo: number,
                areaSqm: area(value.areaSqm),
                propertyRateXofPerSqm: rate(),
            };
        }
        case "note_receipt": {
            record(value, [...common, "contractIds", "receipt"]);
            const result = {
                type: "note_receipt",
                ...contracts(),
                receipt: noteReceipt(value.receipt, today),
            };
            if (result.contractIds.length !== 1 || result.receipt.contractId !== result.contractIds[0])
                throw invalid();
            return result;
        }
        default:
            throw invalid();
    }
}
export function parseCimacMaintenance(value, today = new Date().toISOString().slice(0, 10)) {
    const row = record(value, [
        "protocolVersion",
        "connectorVersion",
        "requestId",
        "originalInstruction",
        "inputSource",
        "operations",
    ]);
    if (row.protocolVersion !== "1.0" ||
        row.connectorVersion !== "0.8.0" ||
        !["natural_language", "excel_screenshot"].includes(String(row.inputSource)) ||
        !Array.isArray(row.operations) ||
        !row.operations.length ||
        row.operations.length > 30)
        throw invalid();
    const operations = row.operations.map((item) => operation(item, today));
    const seen = new Set();
    for (const op of operations) {
        const targets = "contractIds" in op
            ? op.contractIds.map((id) => `contract:${id}`)
            : (op.type === "reserve" ? op.unitNos : [op.unitNo]).map((number) => `unit:${number}`);
        for (const target of targets) {
            if (seen.has(target))
                throw invalid();
            seen.add(target);
        }
    }
    return {
        protocolVersion: "1.0",
        connectorVersion: "0.8.0",
        requestId: id(row.requestId),
        originalInstruction: text(row.originalInstruction, 4000),
        inputSource: row.inputSource,
        operations,
    };
}
function identifiers(value, allowEmpty = false) {
    return (Array.isArray(value) &&
        (allowEmpty || value.length > 0) &&
        value.every(cimacUuid) &&
        new Set(value).size === value.length);
}
function sameIds(actual, expected) {
    return (identifiers(actual, true) &&
        actual.length === expected.length &&
        expected.every((id) => actual.includes(id)));
}
function decimalMinor(value) {
    const canonical = cimacMoney(value, "CNY", true);
    return BigInt(canonical.replace(".", ""));
}
function sameRate(left, right) {
    const normalize = (value) => {
        if (typeof value !== "string" || !/^\d+(\.\d{1,12})?$/.test(value))
            throw new Error("invalid_rate");
        const [whole, fraction = ""] = value.split(".");
        return `${BigInt(whole)}.${fraction.replace(/0+$/, "")}`;
    };
    return normalize(left) === normalize(right);
}
function convertedMinor(amount, rate) {
    if (typeof rate !== "string" || !/^\d+(\.\d{1,12})?$/.test(rate))
        throw new Error("invalid_rate");
    const [whole, fraction = ""] = rate.split(".");
    const scale = BigInt(10) ** BigInt(fraction.length);
    const integerRate = BigInt(whole + fraction);
    if (integerRate <= BigInt(0))
        throw new Error("invalid_rate");
    // PostgreSQL numeric round to cents, without converting money to IEEE doubles.
    return (decimalMinor(amount) * integerRate + scale / BigInt(2)) / scale;
}
function expectedPayments(operation) {
    switch (operation.type) {
        case "close":
            return [
                ...(operation.noteReceipt
                    ? [{ receipt: operation.noteReceipt, refund: false, native: true }]
                    : []),
                { receipt: operation.refund, refund: true, native: operation.noteReceipt ? true : null },
            ];
        case "replace":
            return [
                { receipt: operation.refund, refund: true, native: null },
                { receipt: operation.receipt, refund: false, native: false },
            ];
        case "note_receipt":
            return [{ receipt: operation.receipt, refund: false, native: true }];
        default:
            return [];
    }
}
/** Require row evidence and bounded side effects; never trust a bare verified flag. */
export function verifyCimacMaintenanceResult(value, request, actorId) {
    try {
        if (!cimacObject(value) ||
            value.status !== "completed" ||
            value.verified !== true ||
            value.requestId !== request.requestId ||
            !isDeepStrictEqual(value.request, request) ||
            value.actorId !== actorId ||
            value.operationCount !== request.operations.length ||
            !cimacUuid(value.auditId) ||
            !identifiers(value.paymentIds, true) ||
            !Array.isArray(value.operationResults) ||
            value.operationResults.length !== request.operations.length ||
            !Array.isArray(value.payments) ||
            !cimacObject(value.reconciliation))
            return false;
        const reconciliation = value.reconciliation;
        if (reconciliation.receivablesCreated !== 0 ||
            ![
                "originalPaymentsPreserved",
                "contractsMatch",
                "unitsMatch",
                "paymentsMatch",
                "ledgerMatch",
                "auditMatch",
            ].every((key) => reconciliation[key] === true))
            return false;
        const expectedCount = request.operations.reduce((sum, op) => sum + expectedPayments(op).length, 0);
        if (value.paymentIds.length !== expectedCount ||
            value.payments.length !== expectedCount ||
            reconciliation.paymentCount !== expectedCount ||
            reconciliation.ledgerCount !== expectedCount)
            return false;
        const rows = new Map();
        const ledgerIds = new Set();
        for (const payment of value.payments) {
            if (!cimacObject(payment) ||
                !cimacUuid(payment.id) ||
                rows.has(payment.id) ||
                !cimacUuid(payment.ledgerId) ||
                ledgerIds.has(payment.ledgerId) ||
                !cimacUuid(payment.sourceId) ||
                payment.recordedBy !== actorId ||
                !value.paymentIds.includes(payment.id))
                return false;
            rows.set(payment.id, payment);
            ledgerIds.add(payment.ledgerId);
        }
        const linked = new Set();
        for (let index = 0; index < request.operations.length; index++) {
            const op = request.operations[index], actual = value.operationResults[index];
            if (!cimacObject(actual) ||
                actual.type !== op.type ||
                !identifiers(actual.unitIds) ||
                !identifiers(actual.contractIds, true) ||
                !identifiers(actual.paymentIds, true))
                return false;
            if ("contractIds" in op &&
                op.type !== "replace" &&
                !sameIds(actual.contractIds, op.contractIds))
                return false;
            if (op.type === "replace" &&
                (actual.contractIds.length !== 2 ||
                    actual.contractIds[0] !== op.contractIds[0]))
                return false;
            const expectedUnits = "contractIds" in op ? op.contractIds.length : op.type === "reserve" ? op.unitNos.length : 1;
            if (actual.unitIds.length !== expectedUnits)
                return false;
            if ((op.type === "area" || op.type === "create_reservation") &&
                actual.contractIds.length !== 1)
                return false;
            // A reservation may have no signed lease; never invent contracts or receivables.
            if (op.type === "reserve" && actual.contractIds.length !== 0)
                return false;
            const expected = expectedPayments(op);
            if (actual.paymentIds.length !== expected.length)
                return false;
            const unmatched = [...expected];
            for (const paymentId of actual.paymentIds) {
                if (linked.has(paymentId))
                    return false;
                linked.add(paymentId);
                const payment = rows.get(paymentId);
                if (!payment || !actual.contractIds.includes(payment.sourceId))
                    return false;
                const match = unmatched.findIndex(({ receipt, refund }) => payment.paymentType === (refund ? "lease_deposit_refund" : "lease_deposit") &&
                    payment.currency === receipt.currency &&
                    payment.amount === receipt.amount &&
                    payment.paymentDate === receipt.paymentDate &&
                    payment.paymentMethod === receipt.paymentMethod);
                if (match < 0)
                    return false;
                const wanted = unmatched.splice(match, 1)[0];
                const expectedSource = op.type === "replace"
                    ? actual.contractIds[wanted.refund ? 0 : 1]
                    : op.type === "note_receipt"
                        ? op.receipt.contractId
                        : op.type === "close" && !wanted.refund
                            ? op.noteReceipt?.contractId
                            : null;
                if (expectedSource !== null &&
                    expectedSource !== undefined &&
                    payment.sourceId !== expectedSource)
                    return false;
                if (wanted.refund && (op.type === "close" || op.type === "replace")) {
                    if (!Array.isArray(payment.originalPayments) ||
                        !payment.originalPayments.length ||
                        !payment.originalPayments.every(cimacObject))
                        return false;
                    const originals = payment.originalPayments;
                    const expectedOriginals = op.type === "close" && op.noteReceipt
                        ? actual.paymentIds.filter((id) => rows.get(id)?.paymentType === "lease_deposit")
                        : op.refund.originalPaymentIds;
                    if (!sameIds(originals.map((row) => row.id), expectedOriginals) ||
                        originals.some((row) => row.currency !== "CNY") ||
                        originals.reduce((sum, row) => sum + decimalMinor(row.amount), BigInt(0)) !==
                            decimalMinor(wanted.receipt.amount))
                        return false;
                    if (wanted.native === true ||
                        (wanted.native === null && payment.nativeSettlement === true)) {
                        if (originals.some((row) => row.nativeSettlement !== true || row.exchangeRateToXof !== null))
                            return false;
                    }
                    else if (originals.some((row) => row.nativeSettlement !== false ||
                        !sameRate(row.exchangeRateToXof, payment.exchangeRateToXof)))
                        return false;
                }
                if (payment.ledgerCurrency !==
                    (payment.nativeSettlement === true ? payment.currency : "XOF") ||
                    payment.ledgerDirection !== (wanted.refund ? "liability_out" : "liability_in"))
                    return false;
                if (wanted.native === true ||
                    (wanted.native === null && payment.nativeSettlement === true)) {
                    if (payment.nativeSettlement !== true ||
                        payment.exchangeRateToXof !== null ||
                        decimalMinor(payment.ledgerAmountXof) !== BigInt(0) ||
                        payment.ledgerAmountNative !== wanted.receipt.amount)
                        return false;
                }
                else if (wanted.receipt.currency === "XOF") {
                    if (payment.nativeSettlement !== false ||
                        !sameRate(payment.exchangeRateToXof, "1") ||
                        decimalMinor(payment.ledgerAmountXof) !== BigInt(wanted.receipt.amount) * BigInt(100) ||
                        payment.ledgerAmountNative !== null)
                        return false;
                }
                else {
                    // Original converted deposits keep the historical currency/rate; no current FX is invented.
                    if (payment.nativeSettlement !== false ||
                        typeof payment.exchangeRateToXof !== "string" ||
                        !/^\d+(\.\d+)?$/.test(payment.exchangeRateToXof) ||
                        decimalMinor(payment.ledgerAmountXof) !==
                            convertedMinor(wanted.receipt.amount, payment.exchangeRateToXof) ||
                        payment.ledgerAmountNative !== null)
                        return false;
                }
            }
            if (unmatched.length)
                return false;
        }
        return linked.size === expectedCount;
    }
    catch {
        return false;
    }
}

export function normalizeCimacMaintenanceRequest(value) { return parseCimacMaintenance({...value, protocolVersion: value?.protocolVersion ?? "1.0", connectorVersion: value?.connectorVersion ?? "0.8.0", inputSource: value?.inputSource ?? "natural_language"}); }

