import {
  parseCustomerDirectoryQuery,
  type CustomerDirectoryData,
} from "../../src/features/customers/customer-directory-model";

export const directoryIds = {
  project: "11111111-1111-4111-8111-111111111111",
  building: "22222222-2222-4222-8222-222222222222",
  customer: "33333333-3333-4333-8333-333333333333",
  other: "44444444-4444-4444-8444-444444444444",
  unit: "55555555-5555-4555-8555-555555555555",
  sale: "66666666-6666-4666-8666-666666666666",
  booking: "77777777-7777-4777-8777-777777777777",
};
export function customerDirectoryFixture(
  mode: "list" | "detail" = "list",
  id = directoryIds.customer,
): CustomerDirectoryData {
  return {
    mode,
    query: parseCustomerDirectoryQuery({}),
    pageSize: 40,
    total: 2,
    scopeCount: 2,
    buildings: [
      {
        id: directoryIds.building,
        code: "A",
        label: "示例楼栋",
        project: { id: directoryIds.project, code: "SACSI", label: "SACSI 示例" },
      },
    ],
    rows: (mode === "detail" ? [id] : [directoryIds.customer, directoryIds.other]).map(
      (customer) => ({
        id: customer,
        name: customer === directoryIds.customer ? "示例客户甲" : "示例客户乙",
        phone: null,
        isBlacklisted: false,
        hasDocument: false,
        roles: customer === directoryIds.customer ? ["sale", "daily_guest"] : [],
        rooms: customer === directoryIds.customer ? ["示例楼栋 · 101"] : [],
        roomCount: customer === directoryIds.customer ? 1 : 0,
        relationshipCount: customer === directoryIds.customer ? 2 : 0,
        lastBusinessDate: customer === directoryIds.customer ? "2026-10-19" : null,
      }),
    ),
    profile:
      mode === "detail"
        ? {
            id,
            name: id === directoryIds.customer ? "示例客户甲" : "示例客户乙",
            phone: null,
            gender: null,
            document_type: null,
            notes: "测试资料",
            is_blacklisted: false,
            blacklist_reason: null,
            blacklist_date: null,
            blacklist_operator_id: null,
            blacklist_permanent: false,
            hasDocument: false,
            created_at: "2026-10-01T00:00:00Z",
            updated_at: "2026-10-19T00:00:00Z",
          }
        : null,
    relationships:
      mode === "detail" && id === directoryIds.customer
        ? [
            {
              id: directoryIds.sale,
              role: "sale",
              unitId: directoryIds.unit,
              unitNo: "101",
              buildingId: directoryIds.building,
              buildingLabel: "示例楼栋",
              projectId: directoryIds.project,
              code: "DEMO-S-101",
              startDate: "2026-10-19",
              endDate: null,
              endDateKind: null,
              status: "active",
            },
            {
              id: directoryIds.booking,
              role: "daily_guest",
              unitId: directoryIds.unit,
              unitNo: "101",
              buildingId: directoryIds.building,
              buildingLabel: "示例楼栋",
              projectId: directoryIds.project,
              code: null,
              startDate: "2026-10-17",
              endDate: "2026-10-21",
              endDateKind: "expected",
              status: "checked_in",
            },
          ]
        : [],
    relationshipPage: 1,
    relationshipTotal: mode === "detail" && id === directoryIds.customer ? 2 : 0,
  };
}
