import { expect, it } from "vitest";
import { confirmationReturnPath } from "@/lib/confirmation-return-path";
it("preserves only exact internal confirmation paths", () => {
  const path = "/operator/confirmations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expect(confirmationReturnPath(path)).toBe(path);
  const workflow=path.replace('/confirmations/','/daily-workflows/');
  expect(confirmationReturnPath(workflow)).toBe(workflow);
  expect(confirmationReturnPath(`${workflow}?next=evil`)).toBeNull();
  for (const value of [undefined, null, {}, "https://evil.invalid", "//evil.invalid", "/settings", `${path}?next=evil`, `${path}/..`, path.replace("/operator", "\\operator")]) expect(confirmationReturnPath(value)).toBeNull();
});
