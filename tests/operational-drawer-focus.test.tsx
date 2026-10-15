// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RightDrawer } from "@/components/ui/operational";
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
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open contract</button>
      {open && (
        <RightDrawer open title="Contract" onClose={() => setOpen(false)}>
          <label>
            Note
            <input aria-label="Contract note" />
          </label>
        </RightDrawer>
      )}
    </>
  );
}
it("handles Escape and restores keyboard focus to the originating action", async () => {
  await act(async () => root.render(<Harness />));
  const opener = host.querySelector("button")!;
  opener.focus();
  await act(async () => opener.click());
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
