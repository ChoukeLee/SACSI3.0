import type { CimacFinanceRequest } from "@/features/business-actions/cimac-finance";
import { cimacFinanceChildId } from "@/features/business-actions/cimac-finance-verification";

export const financeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const financeActorId = financeId(1);
export const financeRequestId = financeId(2);
export function financeRequest(): CimacFinanceRequest {
  const receipt = (amountXof: string) => ({
    amountXof,
    paymentDate: "2026-10-26",
    paymentMethod: "cash" as const,
    sourceText: "原表现金已收",
    externalReceiptNo: "纸质123",
  });
  return {
    protocolVersion: "1.0",
    connectorVersion: "0.9.0",
    requestId: financeRequestId,
    originalInstruction: "按已确认原表收款及科目纠正；保留历史凭证和所有现金事实。",
    inputSource: "excel_screenshot",
    operations: [
      {
        type: "collect",
        customerId: financeId(10),
        customerName: "测试客户甲",
        category: "lease_deposit",
        receipt: receipt("500000"),
        parts: [{ contractId: financeId(20), amountXof: "500000" }],
        annotation: "现金押金已确认",
      },
      {
        type: "new_deposit",
        customerName: "测试客户乙",
        receipt: receipt("1000000"),
        units: [
          { unitNo: "382", monthlyRentXof: "860000", depositXof: "2580000", amountXof: "1000000" },
        ],
        annotation: "按确认价格未签预留",
      },
      {
        type: "collect",
        customerId: financeId(12),
        customerName: "测试客户丙",
        category: "property_fee",
        receipt: receipt("691000"),
        parts: [{ contractId: financeId(22), amountXof: "691000", discountXof: "200" }],
        servicePeriod: { start: "2027-04-01", end: "2028-03-31" },
        annotation: "年毛691200优惠200实收691000",
      },
      {
        type: "reclassify",
        paymentId: financeId(43),
        expectedSourceType: "lease_rent",
        targetSourceType: "lease_deposit",
        amountCny: "31875.00",
        annotation: "测试甲铺原人民币整笔改为押金",
      },
      {
        type: "identity",
        customerId: financeId(14),
        customerName: "测试客户戊",
        units: [{ unitNo: "385", expectedHolderName: "旧标签" }],
        holderName: "测试客户戊",
        managementNames: ["测试客户戊", "测试经理"],
        annotation: "只修正本铺标签及经理记载",
      },
      {
        type: "reclassify",
        paymentId: financeId(45),
        expectedSourceType: "lease_deposit",
        targetSourceType: "lease_rent",
        amountCny: "35500.00",
        annotation: "测试乙铺原人民币整笔改为租金",
      },
    ],
  };
}

/** A valid raw-row response. Each call creates fresh mutable test evidence. */
export function financeCompleted() {
  const request = financeRequest();
  const unitNos = ["881", "382", "486", "781", "385", "283"];
  const units = unitNos.map((unit_no, index) => ({
    id: financeId(30 + index),
    building_id: financeId(100 + index),
    unit_no,
    kind: "storefront",
    asset_subtype: "commercial_shop",
    status: "reserved",
    area_sqm: 64,
    reservation_holder_name: [
      "测试客户甲",
      "测试客户乙",
      "测试客户丙",
      "测试客户丁",
      "测试客户戊",
      "测试客户己",
    ][index],
    notes: `${request.operations[index].annotation}；测试客户戊；测试经理`,
  }));
  const contracts = units.map((unit, index) => ({
    id: index === 1 ? cimacFinanceChildId(financeRequestId, "2:1:contract") : financeId(20 + index),
    unit_id: unit.id,
    customer_id:
      index === 1 ? cimacFinanceChildId(financeRequestId, "2:customer") : financeId(10 + index),
    contract_no: `LC-${index}`,
    status: "draft",
    commencement_state: "pending_project_opening",
    signing_state: "pending_confirmation",
    start_date: null,
    expected_end_date: null,
    actual_end_date: null,
    expected_end_confirmed: false,
    paid_through_date: null,
    deposit_received: index === 0,
    deposit_amount_xof: index === 1 ? 2580000 : index === 3 ? 3000000 : 1000000,
    monthly_rent_xof: index === 1 ? 860000 : 333333,
    rent_currency: "XOF",
    monthly_rent_amount: null,
    deposit_months: 3,
    free_months: 12,
    signer_name: null,
    signed_date: null,
    source_reference: `${request.operations[index].annotation}；2028-04-01；2027-04-01至2028-03-31；900；测试客户戊；测试经理`,
  }));
  const payments = [0, 1, 2].map((index) => ({
    id: cimacFinanceChildId(financeRequestId, `${index + 1}:1:payment`),
    source_id: contracts[index].id,
    source_type: index === 2 ? "property_fee" : "lease_deposit",
    unit_id: units[index].id,
    customer_id: contracts[index].customer_id,
    payment_date: "2026-10-26",
    amount: [500000, 1000000, 691000][index],
    currency: "XOF",
    exchange_rate_to_xof: 1,
    native_settlement: false,
    payment_method: "cash",
    recorded_by: financeActorId,
    request_kind: "cimac_finance",
    request_id: cimacFinanceChildId(financeRequestId, `${index + 1}:1:request`),
    receipt_no: `WB-CIMAC-B0${index + 1}-L-${units[index].unit_no}-20261026-${index === 2 ? "PROP" : "DEP"}-01`,
    external_receipt_no: "纸质123",
    reversal_of_payment_id: null,
    actual_collector: null,
    notes: "原表现金已收",
    created_at: "2026-11-02T19:00:00Z",
  }));
  const ledger = payments.map((payment, index) => ({
    id: cimacFinanceChildId(financeRequestId, `${index + 1}:1:ledger`),
    payment_id: payment.id,
    unit_id: payment.unit_id,
    building_id: units[index].building_id,
    entry_date: payment.payment_date,
    amount_xof: payment.amount,
    currency: "XOF",
    amount_native: null,
    amount_cny: null,
    category: payment.source_type,
    direction: index === 2 ? "income" : "liability_in",
    description: "已确认现金收款",
    created_at: "2026-11-02T19:00:00Z",
  }));
  const reclassifications = [3, 5].map((index) => {
    const op = request.operations[index];
    if (op.type !== "reclassify") throw new Error("fixture");
    const paymentBefore = {
      ...payments[0],
      id: op.paymentId,
      source_id: contracts[index].id,
      unit_id: units[index].id,
      customer_id: contracts[index].customer_id,
      source_type: op.expectedSourceType,
      amount: Number(op.amountCny),
      currency: "CNY",
      exchange_rate_to_xof: 80,
      payment_date: "2026-08-01",
      receipt_no: "ORIGINAL-SYSTEM-REF",
      notes: "原始说明逐字保留",
      request_kind: null,
      request_id: null,
    };
    const ledgerBefore = {
      ...ledger[0],
      id: financeId(50 + index),
      payment_id: op.paymentId,
      unit_id: units[index].id,
      building_id: units[index].building_id,
      entry_date: "2026-08-01",
      amount_xof: Number(op.amountCny) * 80,
      amount_cny: Number(op.amountCny),
      category: op.expectedSourceType,
      direction: op.expectedSourceType === "lease_deposit" ? "liability_in" : "income",
      description: "历史分类",
    };
    return {
      paymentBefore,
      paymentAfter: { ...paymentBefore, source_type: op.targetSourceType },
      ledgerBefore,
      ledgerAfter: {
        ...ledgerBefore,
        category: op.targetSourceType,
        direction: op.targetSourceType === "lease_deposit" ? "liability_in" : "income",
        description: op.annotation,
      },
    };
  });
  const priorDeposit = {
    ...payments[0],
    id: financeId(46),
    amount: 500000,
    receipt_no: "HISTORICAL-DEP",
    request_id: null,
    request_kind: null,
  };
  const priorLedger = {
    ...ledger[0],
    id: financeId(56),
    payment_id: priorDeposit.id,
    amount_xof: priorDeposit.amount,
  };
  const receivables = [
    {
      id: cimacFinanceChildId(financeRequestId, "3:1:receivable"),
      source_id: contracts[2].id,
      source_type: "lease_contract",
      category: "property_fee",
      unit_id: units[2].id,
      building_id: units[2].building_id,
      customer_id: contracts[2].customer_id,
      currency: "XOF",
      amount_xof: 691000,
      paid_amount_xof: 691000,
      amount_native: null,
      paid_amount_native: null,
      management_status: "managed",
      status: "paid",
      due_date: "2027-04-01",
      service_period_start: "2027-04-01",
      service_period_end: "2028-03-31",
      title: "年度标准毛额691200；优惠200；实收691000",
    },
  ];
  return {
    status: "completed",
    verified: true,
    requestId: request.requestId,
    actorId: financeActorId,
    request,
    operationCount: request.operations.length,
    auditId: financeId(70),
    paymentIds: payments.map((p) => p.id),
    idempotent: false,
    operationResults: request.operations.map((op, index) => ({
      index,
      type: op.type,
      customerId: contracts[index].customer_id,
      unitIds: [units[index].id],
      contractIds: [contracts[index].id],
      paymentIds: index < 3 ? [payments[index].id] : op.type === "reclassify" ? [op.paymentId] : [],
      ledgerIds:
        index < 3 ? [ledger[index].id] : op.type === "reclassify" ? [financeId(50 + index)] : [],
      receivableIds: index === 2 ? [receivables[0].id] : [],
    })),
    verification: {
      version: 1,
      actorId: financeActorId,
      checks: {
        scope: true,
        payments: true,
        ledger: true,
        receivables: true,
        contracts: true,
        units: true,
        cashFactsPreserved: true,
        audit: true,
        exclusions: true,
      },
      payments,
      ledger,
      receivables,
      contracts,
      units,
      reclassifications,
      customers: [
        "测试客户甲",
        "测试客户乙",
        "测试客户丙",
        "测试客户丁",
        "测试客户戊",
        "测试客户己",
      ].map((name, index) => ({ id: contracts[index].customer_id, name })),
      depositPayments: [payments[0], payments[1], priorDeposit, reclassifications[0].paymentAfter],
      depositLedger: [ledger[0], ledger[1], priorLedger, reclassifications[0].ledgerAfter],
      allocations: [
        { payment_id: payments[2].id, receivable_id: receivables[0].id, amount_xof: 691000 },
      ],
      audit: {
        id: financeId(70),
        actorId: financeActorId,
        requestId: request.requestId,
        channel: "external_codex",
        authorization: "explicit_instruction",
      },
    },
  };
}
