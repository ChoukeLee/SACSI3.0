// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AssetOperationsWorkspace } from "./asset-operations-workspace";
import { assetReportPeriod, type AssetOperationsData } from "./asset-operations-model";

const operations = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: operations.refresh }) }));
vi.mock("./asset-operations-actions", () => ({
  confirmAssetOperationAsset: vi.fn(),
  confirmAssetOperationEntry: vi.fn(),
  createAssetOperationEntry: operations.create,
  importAssetOperationCatalog: vi.fn(),
  voidAssetOperationEntry: vi.fn(),
  updateAssetOperationTerms: vi.fn(),
  importAssetOperationEntries: vi.fn(),
}));

it("reuses the request ID when an unknown save result is retried without changing the financial input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  operations.create
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ ok: true });
  const data: AssetOperationsData = {
    projectId: "project",
    canWrite: true,
    assets: [
      {
        id: "asset",
        projectId: "project",
        unitId: null,
        code: "OLD-TEST",
        name: "Test warehouse",
        group: "old_warehouse",
        verification: "verified",
        sourceRefs: ["test.xlsx!A2"],
        monthlyRentNative: null,
        rentCurrency: null,
        costCoverageThrough: null,
        updatedAt: "2026-11-07T00:00:00Z",
      },
    ],
    entries: [],
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AssetOperationsWorkspace
          data={data}
          locale="zh"
          initialPeriod={assetReportPeriod("month", "2026-11")}
          today="2026-11-07"
          canImport={false}
        />,
      ),
    );
    const form = host.querySelector("input[name='amount']")?.closest("form");
    expect(form).not.toBeNull();
    for (const [name, value] of Object.entries({
      amount: "100.50",
      cashDate: "2026-11-05",
      sourceRef: "test-receipt-line-1",
      description: "Verified maintenance receipt",
    })) {
      const input = form!.querySelector<HTMLInputElement>(`input[name='${name}']`);
      expect(input).not.toBeNull();
      input!.value = value;
    }
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(operations.create).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("保存结果未确认");
    expect(operations.refresh).not.toHaveBeenCalled();
    const first = operations.create.mock.calls[0][0];
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(operations.create).toHaveBeenCalledTimes(2);
    expect(operations.create.mock.calls[1][0]).toEqual(first);
    expect(first).toMatchObject({
      amountNative: 100.5,
      currency: "XOF",
      cashDate: "2026-11-05",
      recognitionMethod: "unallocated",
      verification: "pending",
    });
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(operations.refresh).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("exports deposit totals and net metrics alongside the same filtered source entries", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let savedBlob: Blob | null = null;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((blob: Blob) => {
      savedBlob = blob;
      return "blob:test-report";
    }),
    revokeObjectURL: vi.fn(),
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const data: AssetOperationsData = {
    projectId: "project",
    canWrite: false,
    assets: [
      {
        id: "asset",
        projectId: "project",
        unitId: null,
        code: "OLD-TEST",
        name: "Test warehouse",
        group: "old_warehouse",
        verification: "verified",
        sourceRefs: ["test.xlsx!A2"],
        monthlyRentNative: null,
        rentCurrency: null,
        costCoverageThrough: null,
        updatedAt: "2026-11-07T00:00:00Z",
      },
    ],
    entries: [
      {
        id: "deposit",
        assetId: "asset",
        kind: "deposit_in",
        category: "deposit",
        amountNative: 500,
        currency: "XOF",
        cashDate: "2026-11-05",
        periodStart: null,
        periodEnd: null,
        recognitionMethod: "unallocated",
        verification: "verified",
        sourceRef: "test-deposit-line",
        description: "Test deposit",
      },
    ],
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AssetOperationsWorkspace
          data={data}
          locale="zh"
          initialPeriod={assetReportPeriod("month", "2026-11")}
          today="2026-11-07"
          canImport={false}
        />,
      ),
    );
    const button = Array.from(host.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("导出当前报表"),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(savedBlob).not.toBeNull();
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(savedBlob!);
    });
    expect(csv).toContain("本期押金收取,,XOF,500");
    expect(csv).toContain("本期押金退还,,XOF,0");
    expect(csv).toContain("已录经营现金净额,,XOF,0");
    expect(csv).toContain("按日分摊差额（测算）,,XOF,,");
    expect(csv).toContain("test-deposit-line");
    expect(csv).toContain(
      "group,categoryFilter,assetStatusFilter,assetCount,generatedAt,assetSearch",
    );
    expect(csv.split("\r\n")[1]).toMatch(/^scope,/);
    expect(csv.split("\r\n").filter((line) => line.startsWith("summary,")).length).toBe(8);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});
