import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LeaseRoomOverview } from "@/features/leases/lease-room-overview";
import {
  buildLeaseRoomOverview,
  buildLeaseRecordOverview,
  type LeaseRecordOverviewRow,
  type LeaseRoomOverviewRow,
} from "@/features/leases/lease-room-overview-model";
import { LeaseWorkbenchInspector } from "@/features/leases/lease-workbench-inspector";
import type { LeaseContractRow, ReceivableRow, CustomerRow } from "@/types/database";
import type { WorkspaceUnit } from "@/features/contracts/workspace-model";
import { workspaceFixture } from "../fixtures/contract-workspace";
import "@/app/globals.css";

const template = workspaceFixture();
const uuid = (number: number) => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
const definitions = [
  {
    no: "A101",
    floor: "一层",
    tenant: "示例租客甲",
    rent: 950000,
    paid: "2026-12-31",
    due: "2027-01-01",
    settled: 0,
  },
  {
    no: "A102",
    floor: "一层",
    tenant: "示例租客乙",
    rent: 950000,
    paid: "2026-10-31",
    due: "2026-11-01",
    settled: 500000,
  },
  {
    no: "A103",
    floor: "一层",
    tenant: "示例租客丙",
    rent: 800000,
    paid: "2026-11-14",
    due: "2026-11-15",
    settled: 0,
  },
  { no: "A104", floor: "一层", tenant: "", rent: 0, paid: null, due: null, settled: 0 },
  {
    no: "B201",
    floor: "二层",
    tenant: "示例外币租客",
    rent: 3200,
    currency: "USD",
    paid: "2026-11-14",
    due: "2026-11-15",
    settled: 1000,
  },
  {
    no: "B202",
    floor: "二层",
    tenant: "示例租客丁",
    rent: 750000,
    paid: "2026-10-31",
    due: null,
    settled: 0,
  },
  {
    no: "B203",
    floor: "二层",
    tenant: "",
    rent: 0,
    paid: null,
    due: null,
    settled: 0,
    reserved: true,
  },
  {
    no: "B204",
    floor: "二层",
    tenant: "",
    rent: 0,
    paid: null,
    due: null,
    settled: 0,
    unknown: true,
  },
];
const units: WorkspaceUnit[] = definitions.map((item, index) => ({
  ...template.units[0],
  id: uuid(index + 1),
  unit_no: item.no,
  code: "SYNTHETIC-" + item.no,
  floor_label: item.floor,
  status: item.tenant ? "leased" : item.reserved ? "reserved" : "available",
  occupancy_verified: !item.unknown,
}));
const contracts = definitions.flatMap((item, index): LeaseContractRow[] =>
  item.tenant
    ? [
        {
          ...(template.contracts[0] as LeaseContractRow),
          id: uuid(index + 101),
          unit_id: units[index].id,
          customer_id: uuid(index + 201),
          contract_no: "",
          start_date: "2026-01-01",
          expected_end_date: "2099-12-31",
          expected_end_confirmed: false,
          attachment_url: null,
          paid_through_date: item.paid,
          monthly_rent_xof: item.currency ? 0 : item.rent,
          rent_currency: item.currency === "USD" ? "USD" : "XOF",
          monthly_rent_amount: item.currency ? item.rent : null,
          deposit_amount_xof: 0,
        },
      ]
    : [],
);
const customers = definitions.flatMap((item, index): CustomerRow[] =>
  item.tenant
    ? [
        {
          ...template.customers[0],
          id: uuid(index + 201),
          name: item.tenant,
        },
      ]
    : [],
);
const receivables = definitions.flatMap((item, index): ReceivableRow[] =>
  item.due
    ? [
        {
          id: uuid(index + 301),
          unit_id: units[index].id,
          building_id: units[index].building_id,
          customer_id: uuid(index + 201),
          source_id: uuid(index + 101),
          source_type: "lease_contract",
          category: "lease_rent",
          title: "合成租金账期",
          due_date: item.due,
          amount_xof: item.currency ? 0 : item.rent,
          paid_amount_xof: item.currency ? 0 : item.settled,
          currency: item.currency === "USD" ? "USD" : "XOF",
          amount_native: item.currency ? item.rent : null,
          paid_amount_native: item.currency ? item.settled : null,
          status: item.settled ? "partial" : "pending",
          management_status: "managed",
          service_period_start: item.due,
          service_period_end: "2027-01-31",
          created_at: "2026-11-01T00:00:00Z",
          updated_at: "2026-11-01T00:00:00Z",
        },
      ]
    : [],
);
const historySamples = [
  {
    unit: 0,
    tenant: "示例原租客甲",
    amount: 900000,
    paid: 700000,
    due: "2026-10-01",
    currency: "XOF",
  },
  {
    unit: 3,
    tenant: "示例已结清租客",
    amount: 800000,
    paid: 800000,
    due: "2026-09-01",
    currency: "XOF",
  },
  { unit: 4, tenant: "示例原外币租客", amount: 200, paid: 50, due: "2026-12-10", currency: "USD" },
] as const;
for (const [index, sample] of historySamples.entries()) {
  const recordId = uuid(index + 601);
  const customerId = uuid(index + 701);
  contracts.push({
    ...contracts[0],
    id: recordId,
    unit_id: units[sample.unit].id,
    customer_id: customerId,
    status: "terminated",
    start_date: "2025-11-01",
    expected_end_date: "2026-10-31",
    expected_end_confirmed: true,
    actual_end_date: "2026-10-31",
    paid_through_date: "2026-09-30",
    rent_currency: sample.currency,
    monthly_rent_xof: sample.currency === "XOF" ? sample.amount : 0,
    monthly_rent_amount: sample.currency === "USD" ? sample.amount : null,
  });
  customers.push({ ...template.customers[0], id: customerId, name: sample.tenant, phone: null });
  receivables.push({
    ...receivables[0],
    id: uuid(index + 801),
    unit_id: units[sample.unit].id,
    customer_id: customerId,
    source_id: recordId,
    due_date: sample.due,
    currency: sample.currency,
    amount_xof: sample.currency === "XOF" ? sample.amount : 0,
    paid_amount_xof: sample.currency === "XOF" ? sample.paid : 0,
    amount_native: sample.currency === "USD" ? sample.amount : null,
    paid_amount_native: sample.currency === "USD" ? sample.paid : null,
    status: sample.amount === sample.paid ? "paid" : "partial",
    service_period_start: "2026-09-01",
    service_period_end: "2026-09-30",
    title: "合成历史未结算账单",
  });
}
for (const current of contracts.filter((record) => record.status === "active"))
  if ([units[0].id, units[4].id].includes(current.unit_id)) current.start_date = "2026-11-01";
const previewInput = {
  units,
  contracts,
  customers,
  receivables,
  today: "2026-11-07",
  buildings: template.buildings.map((building) => ({ ...building, display_name: "示例公寓" })),
};
const rows = buildLeaseRoomOverview(previewInput);
const records = buildLeaseRecordOverview(previewInput);

function Preview() {
  const [selected, setSelected] = useState<LeaseRoomOverviewRow | null>(null);
  const selectRecord = (record: LeaseRecordOverviewRow) => {
    const asset = rows.find((row) => row.unit.id === record.unit.id);
    if (asset)
      setSelected({
        ...asset,
        contract: record.contract,
        customer: record.customer,
        paidThrough: record.paidThrough,
      });
  };
  return (
    <main className="min-h-screen bg-background p-5 text-foreground md:p-8">
      <div className="mx-auto max-w-[1380px]">
        <p className="mb-5 rounded-lg border bg-muted px-4 py-2 text-sm">
          合成数据预览 · 不连接数据库，不办理真实收付款
        </p>
        <header className="mb-6">
          <p className="text-xs text-muted-foreground">SACSI / 示例公寓</p>
          <h1 className="mt-2 text-2xl font-semibold">长租房源</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            按楼层查看已有租赁的房间、租客与交租情况，纸质合同资料可后补。
          </p>
        </header>
        <LeaseRoomOverview
          rows={rows}
          records={records}
          locale="zh"
          loading={false}
          error={false}
          selectedUnitId={selected?.unit.id}
          onSelectUnit={setSelected}
          onSelectRecord={selectRecord}
          onRetry={() => {}}
        />
        {selected ? (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/25"
            onClick={() => setSelected(null)}
          >
            <section
              className="h-full w-full max-w-xl overflow-y-auto bg-background p-4 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-label="租赁资料"
              onClick={(event) => event.stopPropagation()}
            >
              {selected.contract ? (
                <LeaseWorkbenchInspector
                  contract={selected.contract}
                  unit={selected.unit}
                  customer={selected.customer}
                  buildingLabel="示例公寓"
                  locale="zh"
                  today="2026-11-07"
                  payments={[]}
                  receivables={receivables.filter(
                    (bill) => bill.source_id === selected.contract?.id,
                  )}
                  onClose={() => setSelected(null)}
                  onPrint={() => {}}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="mb-5 rounded border px-4 py-2"
                    onClick={() => setSelected(null)}
                  >
                    关闭
                  </button>
                  <h2 className="text-xl font-semibold">{selected.unit.unit_no} · 房源资料</h2>
                  <p className="mt-4 text-sm">当前没有租赁记录，房间仍在楼层总览中保留。</p>
                </>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
