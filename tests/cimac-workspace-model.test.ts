import { describe, expect, it } from "vitest";
import {
  assertCimacWorkspaceQuery,
  cimacAssetCounts,
  decodeCimacAsset,
  decodeCimacPosition,
  decodeCimacWorkspaceScope,
  filterCimacAssets,
} from "@/features/cimac/cimac-workspace-model";
import { parseCimacWorkspaceQuery } from "@/features/cimac/cimac-workspace-query";
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = () =>
  decodeCimacWorkspaceScope({ id: id(1), code: "CIMAC", display_name: "CIMAC" }, [
    {
      id: id(2),
      project_id: id(1),
      code: "D",
      display_name: "演示楼",
      construction_status: "unverified",
      is_active: true,
    },
  ]);
const unit = (extra: Record<string, unknown> = {}) => ({
  id: id(3),
  building_id: id(2),
  code: "DEMO-D1",
  unit_no: "D1",
  kind: "storefront",
  asset_subtype: "commercial_shop",
  floor_label: "G",
  area_sqm: "10.125",
  construction_status: "operational",
  occupancy_verified: true,
  updated_at: "2026-10-25T01:00:00Z",
  ...extra,
});
const position = (extra: Record<string, unknown> = {}) => ({
  id: id(3),
  building_id: id(2),
  ownership: "unspecified",
  operational_condition: "normal",
  daily_occupied: false,
  lease_occupied: false,
  cleaning_pending: false,
  daily_enabled: false,
  lease_enabled: true,
  ...extra,
});
describe("operational facts do not invent business stages or money", () => {
  it("keeps construction, occupancy, ownership, handover and opening separate", () => {
    const a = decodeCimacAsset(
      scope(),
      unit(),
      position({ ownership: "sold", lease_occupied: true }),
    );
    expect(a.position).toMatchObject({ ownership: "sold", lease_occupied: true });
    expect(a.handover).toEqual({ status: "unknown", date: null });
    expect(a.opening).toEqual({ status: "unknown", date: null });
    expect(a.areaSqm).toBe(10.125);
    expect(a).not.toHaveProperty("balance");
  });
  it("missing position/unverified occupancy are not ready or empty", () => {
    const rows = [
      decodeCimacAsset(scope(), unit({ occupancy_verified: false }), position()),
      decodeCimacAsset(scope(), unit({ id: id(4), construction_status: null }), null),
    ];
    expect(cimacAssetCounts(rows)).toMatchObject({
      total: 2,
      occupied: 0,
      unoccupied: 0,
      occupancyUnknown: 2,
      constructionUnknown: 1,
    });
    expect(rows[1].position).toBeNull();
  });
  it("counts verified occupation and derives state checks, not assigned work orders", () => {
    const rows = [
      decodeCimacAsset(scope(), unit(), position({ lease_occupied: true })),
      decodeCimacAsset(
        scope(),
        unit({ id: id(4), construction_status: "inspection_pending" }),
        position({ id: id(4), operational_condition: "maintenance" }),
      ),
      decodeCimacAsset(scope(), unit({ id: id(5) }), null),
    ];
    expect(cimacAssetCounts(rows)).toMatchObject({
      total: 3,
      occupied: 1,
      unoccupied: 1,
      occupancyUnknown: 1,
      constructionPending: 1,
      maintenance: 1,
    });
    expect(filterCimacAssets(rows, parseCimacWorkspaceQuery({ filter: "attention" }))).toHaveLength(
      2,
    );
    expect(filterCimacAssets(rows, parseCimacWorkspaceQuery({ filter: "occupied" }))).toHaveLength(
      1,
    );
    expect(rows[0]).not.toHaveProperty("assignee");
  });
  it.each([
    { kind: "invalid" },
    { id: "bad" },
    { area_sqm: "" },
    { area_sqm: -1 },
    { occupancy_verified: "true" },
    { construction_status: "already_open" },
    { updated_at: "yesterday" },
  ])("fails closed for malformed facts %#", (extra) => {
    expect(() => decodeCimacAsset(scope(), unit(extra), null)).toThrow();
  });
  it("retains explicitly unknown values without numeric/boolean coercion", () => {
    expect(
      decodeCimacAsset(
        scope(),
        unit({
          area_sqm: null,
          occupancy_verified: null,
          construction_status: undefined,
          updated_at: null,
        }),
        null,
      ),
    ).toMatchObject({
      areaSqm: null,
      occupancyVerified: null,
      constructionStatus: null,
      updatedAt: null,
    });
  });
  it.each([
    { id: id(99) },
    { building_id: id(99) },
    { ownership: "owned" },
    { daily_occupied: null },
    { operational_condition: "maybe" },
  ])("verifies exact position identity %#", (extra) => {
    expect(() => decodeCimacPosition(position(extra), id(3), id(2))).toThrow();
  });
  it("refuses foreign scope instead of choosing another visible building", () => {
    for (const raw of [{ project: id(99) }, { building: id(99) }])
      expect(() => assertCimacWorkspaceQuery(scope(), parseCimacWorkspaceQuery(raw))).toThrow();
    expect(() => decodeCimacAsset(scope(), unit({ building_id: id(99) }), null)).toThrow();
    expect(() =>
      decodeCimacWorkspaceScope({ id: id(1), code: "SACSI", display_name: "Other" }, []),
    ).toThrow();
  });
  it("retains inactive building history", () => {
    const s = decodeCimacWorkspaceScope({ id: id(1), code: "CIMAC", display_name: "CIMAC" }, [
      {
        id: id(2),
        project_id: id(1),
        code: "D",
        display_name: "Historic",
        construction_status: null,
        is_active: false,
      },
    ]);
    expect(decodeCimacAsset(s, unit(), null).buildingName).toBe("Historic");
  });
});
