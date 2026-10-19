import { expect, it } from "vitest";
import { customerDirectoryFixture, directoryIds } from "./fixtures/customer-directory";
import {
  customerDirectoryHref,
  decodeCustomerDirectory,
  parseCustomerDirectoryQuery,
} from "../src/features/customers/customer-directory-model";
it("accepts canonical complete list and exact detail responses", () => {
  const list = customerDirectoryFixture();
  expect(decodeCustomerDirectory(list, list.query, "list")).toEqual(list);
  const detail = customerDirectoryFixture("detail");
  expect(decodeCustomerDirectory(detail, detail.query, "detail", directoryIds.customer)).toEqual(
    detail,
  );
});
it.each([
  { page: 0 },
  { page: 1.2 },
  { page: 100001 },
  { filter: "invented" },
  { projectId: "not-an-id" },
  { projectId: "__unassigned__", buildingId: directoryIds.building },
  { search: "x".repeat(201) },
  { unknown: "x" },
  { search: ["x"] },
])("rejects malformed queries %j", (raw) => {
  expect(() => parseCustomerDirectoryQuery(raw)).toThrow();
});
it.each([
  "missing-row",
  "duplicate-row",
  "wrong-scope",
  "wrong-kind",
  "partial-relations",
  "bad-date",
  "unknown-role",
  "exposed-document",
  "wrong-target",
  "bad-end-kind",
])("rejects corrupt or incomplete directory payloads: %s", (type) => {
  const d = customerDirectoryFixture("detail");
  if (type === "missing-row") d.rows = [];
  if (type === "duplicate-row") d.rows.push(d.rows[0]);
  if (type === "wrong-scope") d.relationships[0].buildingId = directoryIds.other;
  if (type === "wrong-kind") d.mode = "list";
  if (type === "partial-relations") d.relationshipTotal = 3;
  if (type === "bad-date") d.relationships[0].startDate = "2026-02-30";
  if (type === "unknown-role") d.relationships[0].role = "unknown" as never;
  if (type === "exposed-document") Object.assign(d.profile!, { encrypted_document_no: "secret" });
  if (type === "wrong-target") d.profile!.id = directoryIds.other;
  if (type === "bad-end-kind") d.relationships[1].endDateKind = null;
  expect(() => decodeCustomerDirectory(d, d.query, "detail", directoryIds.customer)).toThrow();
});
it("never treats list rows as a scope total or an unpaginated list", () => {
  const d = customerDirectoryFixture();
  d.total = 41;
  d.scopeCount = 41;
  expect(() => decodeCustomerDirectory(d, d.query, "list")).toThrow();
});
it("builds page and target URLs from canonical filters", () => {
  const q = parseCustomerDirectoryQuery({
    projectId: directoryIds.project,
    buildingId: directoryIds.building,
    search: "示例",
    filter: "guest",
    page: 2,
  });
  const url = new URL(
    customerDirectoryHref(q, "fr", {}, directoryIds.customer, "/sales?page=3"),
    "https://example.invalid",
  );
  expect(url.pathname).toBe("/fr/customers");
  expect(url.searchParams.get("customer")).toBe(directoryIds.customer);
  expect(url.searchParams.get("project")).toBe(directoryIds.project);
  expect(url.searchParams.get("building")).toBe(directoryIds.building);
  expect(url.searchParams.get("page")).toBe("2");
  expect(url.searchParams.get("returnTo")).toBe("/sales?page=3");
});
