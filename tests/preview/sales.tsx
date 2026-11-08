import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RightDrawer } from "@/components/ui/operational";
import { SaleRoomOverview } from "@/features/sales/sale-room-overview";
import { SaleWorkbenchInspector } from "@/features/sales/sale-workbench-inspector";
import {
  buildSaleRoomOverview,
  buildSaleRecordOverview,
  type SaleRecordOverviewRow,
} from "@/features/sales/sale-room-overview-model";
import type { PaymentRow, ReceivableRow, SaleContractRow } from "@/types/database";
import { saleFixture } from "../fixtures/sale-workbench";
import "@/app/globals.css";

const fixture = saleFixture(undefined, "context", 1);
const uuid = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const definitions = [
  { no: "101", buyer: "示例买方甲", due: "2026-11-01", total: 72000000, paid: 42000000 },
  { no: "102", buyer: "示例买方乙", due: "2026-11-15", total: 68000000, paid: 38000000 },
  { no: "103", buyer: "示例买方丙", due: "2027-01-01", total: 80000000, paid: 80000000 },
  { no: "201", buyer: "示例买方丁", due: null, total: null, paid: 0 },
  { no: "203", buyer: "示例买方戊", due: "2026-11-07", total: 85000000, paid: 55000000 },
  { no: "205", buyer: "示例买方己", due: null, total: null, paid: 720000 },
];
const units = definitions.map((v, i) => ({
  ...fixture.units[0],
  id: uuid(i + 1),
  unit_no: v.no,
  floor_label: i < 3 ? "1F" : "2F",
  status: "sold" as const,
}));
const customers = definitions.map((v, i) => ({
  ...fixture.customers[0],
  id: uuid(i + 101),
  name: v.buyer,
  phone: null,
}));
const contracts: SaleContractRow[] = definitions.map((v, i) => ({
  ...(fixture.contracts[0] as SaleContractRow),
  id: uuid(i + 201),
  unit_id: units[i].id,
  customer_id: customers[i].id,
  contract_no: `SYNTHETIC-${v.no}`,
  total_amount_xof: v.total ?? 0,
  total_amount_confirmed: v.total !== null,
}));
Object.assign(contracts[5], {
  registration_basis: "source_record",
  source_reference: "SYNTHETIC-EXCEL-E65",
  signed_date: null,
  sale_currency: "CNY",
  total_amount_native: 720000,
  total_amount_xof: 0,
  total_amount_confirmed: true,
  source_balance_native: 0,
  source_balance_reference: "SYNTHETIC-EXCEL-K65",
  payment_plan_type: "unconfirmed",
  transfer_status: "unconfirmed",
});
const bills: ReceivableRow[] = definitions.flatMap((v, i) =>
  v.total === null
    ? []
    : [
        {
          ...fixture.receivables[0],
          id: uuid(i + 301),
          source_type: "sale_contract",
          source_id: contracts[i].id,
          building_id: units[i].building_id,
          unit_id: units[i].id,
          customer_id: customers[i].id,
          category: "sale_lump_sum",
          title: "示例出售房款",
          amount_xof: v.total,
          paid_amount_xof: v.paid,
          currency: "XOF",
          due_date: v.due!,
          status: v.paid === v.total ? "paid" : "partial",
          management_status: "managed",
          amount_native: null,
          paid_amount_native: null,
        },
      ],
);
const payments: PaymentRow[] = definitions.flatMap((v, i) =>
  v.paid === 0
    ? []
    : [
        {
          id: uuid(i + 401),
          source_type: "sale_contract",
          source_id: contracts[i].id,
          unit_id: units[i].id,
          customer_id: customers[i].id,
          payment_date: "2026-10-15",
          amount: v.paid,
          currency: i === 5 ? "CNY" : "XOF",
          exchange_rate_to_xof: i === 5 ? null : 1,
          native_settlement: i === 5,
          payment_method: i === 5 ? null : "bank_transfer",
          receipt_no: `SYNTHETIC-${i}`,
          notes: "仅为界面验证的合成收款",
          request_kind: null,
          reversal_of_payment_id: null,
          created_at: "2026-10-15T00:00:00Z",
        },
      ],
);
const input = {
  units,
  contracts,
  customers,
  buildings: fixture.buildings.map((b) => ({ ...b, display_name: "示例公寓" })),
  today: "2026-11-07",
  payments,
  receivables: bills,
  schedules: [],
};
const rows = buildSaleRoomOverview(input),
  records = buildSaleRecordOverview(input);
function Preview() {
  const [selected, setSelected] = useState<SaleRecordOverviewRow | null>(null);
  const data = selected
    ? {
        ...fixture,
        contracts: [selected.contract],
        units: [selected.unit],
        customers: selected.customer ? [selected.customer] : [],
        buildings: input.buildings,
        today: input.today,
        payments: payments.filter((p) => p.source_id === selected.id),
        receivables: bills.filter((b) => b.source_id === selected.id),
        schedules: [],
        summaries: {
          [selected.id]: {
            total: selected.priceXof ?? 0,
            paid: definitions.find((v) => v.no === selected.unit.unit_no)?.paid ?? 0,
            outstanding: selected.outstandingNative?.[0]?.amount ?? 0,
            overdue: 0,
            nextDue: selected.nextDue,
            count: bills.filter((b) => b.source_id === selected.id).length,
            dueOutstanding: 0,
          },
        },
      }
    : null;
  return (
    <main className="min-h-screen bg-background p-5 text-foreground md:p-8">
      <div className="mx-auto max-w-[1380px]">
        <p className="mb-5 rounded-lg border bg-muted px-4 py-2 text-sm">
          合成数据预览 · 不连接数据库，不办理真实收付款
        </p>
        <header className="mb-6">
          <p className="text-xs text-muted-foreground">SACSI / 示例公寓</p>
          <h1 className="mt-2 text-2xl font-semibold">出售房源</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            按楼层查看买方、总价、已收与未收，需要跟进的房间单独标明。
          </p>
        </header>
        <SaleRoomOverview
          rows={rows}
          records={records}
          locale="zh"
          loading={false}
          error={false}
          selectedRecordId={selected?.id}
          onSelectRecord={setSelected}
          onRetry={() => {}}
        />
        {selected ? (
          <RightDrawer
            open
            width="wide"
            title={`示例公寓 · ${selected.unit.unit_no}`}
            onClose={() => setSelected(null)}
          >
            <SaleWorkbenchInspector
              embedded
              data={data}
              locale="zh"
              loading={false}
              error={false}
              selectedId={selected.id}
              returnTo="/sales"
              onClose={() => setSelected(null)}
              onRetry={() => {}}
              onAction={() => {}}
              onPrint={() => {}}
            />
          </RightDrawer>
        ) : null}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
