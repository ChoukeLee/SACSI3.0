import { describe, expect, it } from "vitest";
import {
  constructionLabel,
  decodeUnitBusinessContext,
  matchesUnitWorkbenchFilter,
  parseUnitWorkbenchQuery,
  unitNeedsVerification,
  unitWorkbenchHref,
  type UnitWorkbenchPositionRecord,
} from "@/features/units/unit-workbench-model";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const building = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const project = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const record = (
  overrides: Partial<UnitWorkbenchPositionRecord> = {},
): UnitWorkbenchPositionRecord => ({
  unit: { occupancy_verified: true, construction_status: "operational" },
  position: {
    ownership: "sold",
    operational_condition: "normal",
    daily_occupied: false,
    lease_occupied: true,
    cleaning_pending: true,
    daily_enabled: false,
    lease_enabled: true,
  },
  ...overrides,
});

describe("asset workbench query and independent state dimensions", () => {
  it("does not truncate an invalid UUID plus suffix into another valid target", () => {
    expect(parseUnitWorkbenchQuery({ unit: `${id}suffix` }).unit).toBe("");
    expect(parseUnitWorkbenchQuery({ unit: `${id}/other` }).unit).toBe("");
    expect(parseUnitWorkbenchQuery({ unit: ` ${id} ` }).unit).toBe(id);
  });
  it("defaults and bounds untrusted query fields without inventing prices or selection", () => {
    const query = parseUnitWorkbenchQuery({
      page: "999999999",
      unit: "not-a-uuid",
      kind: "invalid",
      filter: "available",
      q: "x".repeat(200),
      floor: "2F",
      business: "sale",
    });
    expect(query.page).toBe(100000);
    expect(query.unit).toBe("");
    expect(query.kind).toBe("");
    expect(query.filter).toBe("all");
    expect(query.q).toHaveLength(120);
    expect(query.floor).toBe("2F");
    expect(query.business).toBe("sale");
  });
  it.each(["0", "-1", "NaN", "Infinity", "1.4"])("defaults malformed page %s", (page) =>
    expect(parseUnitWorkbenchQuery({ page }).page).toBe(1),
  );
  it("keeps stable UUID selection, encoded filters and French scope links", () => {
    const href = unitWorkbenchHref(
      "fr",
      parseUnitWorkbenchQuery({ unit: id, building, project, q: "A & B", page: "2" }),
      { view: "floor" },
    );
    const url = new URL(href, "https://example.invalid");
    expect(url.pathname).toBe("/fr/units");
    expect(url.searchParams.get("unit")).toBe(id);
    expect(url.searchParams.get("q")).toBe("A & B");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("view")).toBe("floor");
  });
  it("allows sold, occupied and cleaning states on the same asset", () => {
    const row = record();
    expect(matchesUnitWorkbenchFilter(row, "sold")).toBe(true);
    expect(matchesUnitWorkbenchFilter(row, "occupied")).toBe(true);
    expect(matchesUnitWorkbenchFilter(row, "cleaning")).toBe(true);
    expect(matchesUnitWorkbenchFilter(row, "unoccupied")).toBe(false);
    expect(matchesUnitWorkbenchFilter(row, "attention")).toBe(true);
  });
  it("does not turn unknown occupancy or a missing projection into vacancy", () => {
    const emptyPosition = {
      ...record().position!,
      daily_occupied: false,
      lease_occupied: false,
      cleaning_pending: false,
    };
    expect(matchesUnitWorkbenchFilter(record({ position: null }), "unoccupied")).toBe(false);
    expect(
      matchesUnitWorkbenchFilter(
        record({ unit: { occupancy_verified: false }, position: emptyPosition }),
        "unoccupied",
      ),
    ).toBe(false);
    expect(matchesUnitWorkbenchFilter(record({ position: emptyPosition }), "unoccupied")).toBe(
      true,
    );
    expect(
      unitNeedsVerification(
        record({ unit: { occupancy_verified: true, construction_status: "unverified" } }),
      ),
    ).toBe(true);
    expect(unitNeedsVerification(record({ position: null }))).toBe(true);
  });
  it("keeps readiness separate from verified lack of occupation", () => {
    const row = record({
      position: {
        ...record().position!,
        lease_occupied: false,
        operational_condition: "maintenance",
      },
      unit: { occupancy_verified: true, construction_status: "under_construction" },
    });
    expect(matchesUnitWorkbenchFilter(row, "unoccupied")).toBe(true);
    expect(matchesUnitWorkbenchFilter(row, "maintenance")).toBe(true);
    expect(constructionLabel("under_construction", "zh")).toBe("建设中");
    expect(constructionLabel(undefined, "fr")).toBe("À vérifier");
  });
});

describe("asset business context decoder", () => {
  const context = () => ({
    unitId: id,
    buildingId: building,
    projectId: project,
    total: 1,
    page: 1,
    relations: [
      {
        id,
        type: "daily",
        contractNo: null,
        status: "checked_in",
        start: "2026-10-19",
        end: null,
        endDateKind: null,
        endConfirmed: false,
        customerId: null,
        customerName: "Actual guest",
        agentId: building,
        agentName: "Booking agent",
      },
    ],
  });
  it("preserves explicit guest and agent as different identities", () =>
    expect(decodeUnitBusinessContext(context(), id, 1).relations[0]).toMatchObject({
      customerId: null,
      customerName: "Actual guest",
      agentId: building,
    }));
  it.each([
    null,
    {},
    { ...context(), unitId: building },
    { ...context(), total: -1 },
    { ...context(), total: 2 },
    { ...context(), relations: [] },
    { ...context(), page: 2 },
    { ...context(), relations: [{ ...context().relations[0], agentId: "not-id" }] },
  ])("rejects malformed, wrong-target or truncated context %#", (data) =>
    expect(() => decodeUnitBusinessContext(data, id, 1)).toThrow("InvalidUnitBusinessContext"),
  );
});
