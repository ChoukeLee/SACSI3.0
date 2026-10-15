// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/finance/actions", () => ({ addLedgerEntry: vi.fn() }));
import { ManualEntryForm } from "@/features/finance/manual-entry-form";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("localizes manual entry directions while preserving transaction codes and decimal amount input", async () => {
  await act(async () =>
    root.render(
      <ManualEntryForm
        buildings={[{ id: "b", display_name: "Bâtiment", code: "B" }]}
        units={[]}
        zh={false}
      />,
    ),
  );
  const options = [...host.querySelectorAll('select[name="direction"] option')];
  expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual([
    "income",
    "expense",
    "liability_in",
    "liability_out",
  ]);
  expect(options.map((option) => option.textContent)).toEqual([
    "Revenu",
    "Dépense",
    "Entrée de passif",
    "Sortie de passif",
  ]);
  expect(host.querySelector('input[name="amount"]')?.getAttribute("step")).toBe("0.01");
});
