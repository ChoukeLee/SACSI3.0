import { describe, expect, it } from "vitest";
import {
  cimacWorkspaceHref,
  parseCimacWorkspaceQuery,
  safeCimacReturnTo,
  cimacWorkspaceId,
} from "@/features/cimac/cimac-workspace-query";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("fixed-project CIMAC workspace query boundaries", () => {
  it("defaults only omitted fields and keeps exact account subtab", () => {
    expect(parseCimacWorkspaceQuery({}, "customers")).toMatchObject({
      project: "CIMAC",
      q: "",
      building: "",
      kind: "",
      filter: "all",
      page: 1,
      relationPage: 1,
      tab: "overview",
      accountTab: "bills",
      returnTo: null,
    });
    expect(
      parseCimacWorkspaceQuery(
        { q: " 店铺 ", tab: "account", accountTab: "receipts", page: "2", relationPage: "3" },
        "customers",
      ),
    ).toMatchObject({
      q: "店铺",
      tab: "account",
      accountTab: "receipts",
      page: 2,
      relationPage: 3,
    });
  });
  it.each([
    { project: "SACSI" },
    { project: "" },
    { project: ["CIMAC"] },
    { project: "x".repeat(50) },
    { building: "123" },
    { building: [id] },
    { page: "0" },
    { page: "-1" },
    { page: "1.1" },
    { page: "01" },
    { page: "100001" },
    { page: NaN },
    { page: ["1"] },
    { relationPage: "0" },
    { q: "x".repeat(201) },
    { q: "x\0y" },
    { secret: "x" },
    { tab: "bogus" },
    { filter: "bogus" },
    { kind: "castle" },
    { returnTo: "https://example.com" },
  ])("rejects malformed or ambiguous input %#", (raw) => {
    expect(() => parseCimacWorkspaceQuery(raw)).toThrow();
  });
  it("separates customer and asset filter/tab vocabularies", () => {
    expect(
      parseCimacWorkspaceQuery({ membershipStatus: "archived" }, "customers").membershipStatus,
    ).toBe("archived");
    expect(() => parseCimacWorkspaceQuery({ membershipStatus: "archived" }, "assets")).toThrow();
    expect(() => parseCimacWorkspaceQuery({ membershipStatus: "deleted" }, "customers")).toThrow();
    for (const raw of [{ filter: "contract" }, { tab: "account" }, { accountTab: "receipts" }])
      expect(() => parseCimacWorkspaceQuery(raw, "assets")).toThrow();
    expect(() => parseCimacWorkspaceQuery({ kind: "warehouse" }, "customers")).toThrow();
    expect(() => parseCimacWorkspaceQuery({ accountTab: "secrets" }, "customers")).toThrow();
    expect(
      parseCimacWorkspaceQuery({ filter: "attention", kind: "warehouse" }, "assets").kind,
    ).toBe("warehouse");
  });
  it("builds exact encoded routes without unnecessary defaults", () => {
    expect(cimacWorkspaceHref("home")).toBe("/cimac");
    expect(
      cimacWorkspaceHref("customers", "fr", { tab: "account", accountTab: "receipts" }, id),
    ).toBe(`/fr/cimac/customers/${id}?tab=account&accountTab=receipts`);
    expect(cimacWorkspaceHref("assets", "zh", { q: "店铺 #1", page: 2 })).toBe(
      "/cimac/assets?q=%E5%BA%97%E9%93%BA+%231&page=2",
    );
    expect(() => cimacWorkspaceHref("assets", "zh", {}, "not-uuid")).toThrow();
    expect(() => cimacWorkspaceHref("home", "zh", {}, id)).toThrow();
    expect(cimacWorkspaceId(id.toUpperCase())).toBe(id);
  });
  it.each([
    "/cimac",
    "/fr/cimac",
    "/cimac/finance",
    `/cimac/customers/${id}?tab=account&accountTab=meters`,
    `/fr/cimac/assets/${id}?tab=contracts`,
  ])("allows CIMAC GET return %s", (value) => {
    expect(safeCimacReturnTo(value)).toBe(value);
  });
  it.each([
    "//evil.invalid/cimac",
    "/api/cimac",
    "/finance",
    "/cimac/../login",
    "/cimac/customers/not-id",
    "/cimac?token=secret",
    "/cimac?x=1",
    "/cimac?q=1&q=2",
    "/cimac?q=%0Asecret",
    "/cimac\\evil",
    " /cimac",
    "/cimac?returnTo=%2Fcimac&password=secret",
  ])("refuses unsafe return %s", (value) => {
    expect(safeCimacReturnTo(value)).toBeNull();
  });
  it("removes nested return without skipping following validation", () => {
    expect(safeCimacReturnTo("/cimac/assets?returnTo=%2Fcimac&q=1")).toBe("/cimac/assets?q=1");
    const returnTo = `/cimac/customers/${id}?tab=account&accountTab=rules`,
      href = cimacWorkspaceHref("assets", "zh", { returnTo }, id);
    expect(new URL(href, "https://test.invalid").searchParams.get("returnTo")).toBe(returnTo);
  });
});
