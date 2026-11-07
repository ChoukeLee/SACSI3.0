// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AssetFinanceImport } from "./asset-operations-intake";

const actions = vi.hoisted(() => ({ import: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("./asset-operations-actions", () => ({
  importAssetOperationEntries: actions.import,
  updateAssetOperationTerms: vi.fn(),
}));

it("previews source cash separately from rent terms and preserves the file request ID when reloaded after an unknown result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  actions.import
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ ok: true, importedCount: 1, updatedTermsCount: 1 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root = createRoot(host);
  const manifest = {
    requestId: "10000000-0000-4000-8000-000000000001",
    projectId: "project",
    sourceFingerprint: "a".repeat(64),
    entries: [
      {
        assetSourceKey: "old_warehouse:1",
        kind: "income",
        category: "rent",
        currency: "XOF",
        amountNative: 100.5,
        cashDate: "2026-10-09",
        sourceRef: "test.xlsx!H2",
        verification: "verified",
        recognitionMethod: "daily",
      },
    ],
    terms: [
      {
        assetSourceKey: "old_warehouse:1",
        expectedUpdatedAt: "2026-11-07T00:00:00Z",
        monthlyRentNative: 500,
        rentCurrency: "XOF",
        reason: "Source denomination confirmed",
      },
    ],
  };
  function button(label: string) {
    const value = Array.from(host.querySelectorAll("button")).find((item) =>
      item.textContent?.includes(label),
    );
    expect(value).toBeDefined();
    return value!;
  }
  const view = (
    <AssetFinanceImport
      projectId="project"
      zh
      assets={[
        {
          id: "asset",
          projectId: "project",
          unitId: null,
          sourceKey: "old_warehouse:1",
          code: "OLD-TEST",
          name: "Test warehouse",
          group: "old_warehouse",
          verification: "pending",
          sourceRefs: ["test.xlsx!A2"],
          monthlyRentNative: null,
          rentCurrency: null,
          costCoverageThrough: null,
          updatedAt: "2026-11-07T00:00:00Z",
        },
      ]}
    />
  );
  async function previewFile() {
    await act(async () => root.render(view));
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        JSON.stringify(manifest),
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("预览来源").click();
    });
  }
  try {
    await previewFile();
    expect(host.textContent).toContain("参考月租更新 1");
    const preview = host.querySelector("table")!;
    expect(preview.textContent).toContain("100.5");
    expect(preview.textContent).not.toContain("500");
    await act(async () => {
      button("确认更新参考月租并接入待核收付").click();
    });
    expect(host.textContent).toContain("接入结果未确认");
    expect(actions.import).toHaveBeenCalledTimes(1);
    expect(actions.refresh).not.toHaveBeenCalled();
    const first = actions.import.mock.calls[0][0];
    expect(first.entries[0]).not.toHaveProperty("verification");
    expect(first.entries[0]).not.toHaveProperty("recognitionMethod");
    expect(first.terms).toHaveLength(1);
    expect(first.requestId).toBe(manifest.requestId);
    await act(async () => root.unmount());
    root = createRoot(host);
    await previewFile();
    await act(async () => {
      button("确认更新参考月租并接入待核收付").click();
    });
    expect(actions.import.mock.calls[1][0]).toEqual(first);
    expect(actions.refresh).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
