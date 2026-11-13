// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ownerAssetId, ownerContext } from "../../../tests/fixtures/owner-settlement";
import {
  ownerRentUiAccount,
  ownerRentUiAsset,
  ownerRentUiEntries,
  ownerRentUiInput,
  ownerRentUiSettlement,
} from "../../../tests/fixtures/owner-rent-ui";
import { OwnerRentAccountFacts, OwnerRentHistoryForm } from "./owner-rent-history";
import { getOperatingAssetFollowUp } from "./operating-asset-directory-model";
import { OperatingAssetDetail } from "./operating-asset-detail";
import { OperatingWholeLeases } from "./operating-lease-locations";
import { buildOperatingCollectionRows } from "@/features/leases/unified-lease-collections-model";
import { UnifiedLeaseCollections } from "@/features/leases/unified-lease-collections";

const mocks = vi.hoisted(() => ({ context: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("./owner-settlement-actions", () => ({
  getOwnerSettlementContext: mocks.context,
  backfillOwnerRentHistory: mocks.save,
  recordOwnerSettlement: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
let host: HTMLDivElement, root: Root;
const today = "2026-11-13";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mocks.context.mockResolvedValue({
    ok: true,
    context: {
      ...ownerContext(),
      monthlyRentNative: 3_500_000,
      previousSettlement: ownerRentUiSettlement(),
    },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function form() {
  const active = vi.fn(),
    unresolved = vi.fn();
  await act(async () =>
    root.render(
      <OwnerRentHistoryForm
        assetId={ownerAssetId}
        today={today}
        locale="zh"
        disabled={false}
        onActiveChange={active}
        onUnresolvedChange={unresolved}
      />,
    ),
  );
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(active).toHaveBeenLastCalledWith(true);
  const form = host.querySelector<HTMLFormElement>("form")!;
  const input = ownerRentUiInput();
  for (const [index, row] of input.history.entries()) {
    for (const [name, value] of Object.entries({
      date: row.cashDate,
      amount: String(row.amountNative),
      method: "not_recorded",
      source: row.sourceRef,
      text: row.sourceText,
    }))
      form.querySelector<HTMLInputElement>(`[name='${name}-${index}']`)!.value = value;
  }
  form.querySelector<HTMLInputElement>("[name='rateSourceRef']")!.value = input.rateSourceRef;
  form.querySelector<HTMLInputElement>("[name='historyReason']")!.value = input.reason;
  return { form, active, unresolved };
}
async function submit(form: HTMLFormElement) {
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it("keeps original text and explicit unknown methods, freezing the exact request after a lost response", async () => {
  const { form: element, unresolved } = await form();
  expect(element.querySelectorAll("input[type='date']")).toHaveLength(4);
  expect(element.textContent).toContain("西法元 XOF");
  mocks.save
    .mockRejectedValueOnce(new Error("response lost"))
    .mockImplementationOnce(async (_input, requestId) => ({
      ok: true,
      account: { ...ownerRentUiAccount(), requestId },
      idempotent: true,
    }));
  await submit(element);
  const first = mocks.save.mock.calls[0];
  expect(first[0]).toEqual(ownerRentUiInput());
  expect(first[0].history[0].paymentMethod).toBeNull();
  expect(first[0].history[0].sourceText).toMatch(/^  .*  $/);
  expect(element.querySelector("fieldset")!.disabled).toBe(true);
  expect(unresolved).toHaveBeenLastCalledWith(true);
  element.querySelector<HTMLInputElement>("[name='amount-0']")!.value = "1";
  await submit(element);
  expect(mocks.save.mock.calls[1]).toEqual(first);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(unresolved).toHaveBeenLastCalledWith(false);
});

it("refuses unordered or future-to-anchor history before calling the write action", async () => {
  const { form: element } = await form();
  element.querySelector<HTMLInputElement>("[name='date-0']")!.value = "2026-11-13";
  await submit(element);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(host.querySelector("[role='alert']")).not.toBeNull();
});

it("shows owner cash and arrears independently, retaining source text and correction explanation", async () => {
  const asset = ownerRentUiAsset(),
    entries = ownerRentUiEntries();
  const followUp = getOperatingAssetFollowUp(asset, entries, today);
  expect(followUp).toMatchObject({
    paidThrough: null,
    outstanding: null,
    dueDate: null,
    status: "overdue",
    ownerRent: { cumulativeActualNative: 22_500_000, arrearsNative: 47_250_000, dueMonthCount: 27 },
  });
  await act(async () =>
    root.render(
      <OwnerRentAccountFacts
        account={ownerRentUiAccount()}
        summary={followUp.ownerRent}
        locale="zh"
      />,
    ),
  );
  expect(host.textContent).toContain("2,250 万西法");
  expect(host.textContent).toContain("4,725 万西法");
  expect(host.textContent).toContain("共 27 期");
  expect(host.textContent!.match(/未记录/g)).toHaveLength(4);
  expect(host.textContent).toContain("原文");
  expect(host.textContent).toContain(ownerRentUiInput().reason);
  await act(async () =>
    root.render(
      <OperatingAssetDetail
        asset={asset}
        entries={entries}
        followUp={followUp}
        today={today}
        locale="zh"
        ownerSettlementEnabled
        canWrite={false}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(document.body.textContent).toContain("业主累计实收");
  expect(document.body.textContent).toContain("业主到期未结（截至 2026-11-13）");
  expect(document.body.textContent).not.toContain("原表登记未收");
});

it("shows owner balances in the whole-property overview and unified overdue collection row without forging tenant coverage", async () => {
  const asset = ownerRentUiAsset(),
    entries = ownerRentUiEntries(),
    followUp = getOperatingAssetFollowUp(asset, entries, today);
  await act(async () =>
    root.render(
      <OperatingWholeLeases
        rows={[
          {
            asset,
            entries,
            followUp,
            attention: "overdue",
            hasLeaseEvidence: true,
            pendingEntries: 0,
          },
        ]}
        initialAssetId={asset.id}
        locale="zh"
        today={today}
        onOpenDetail={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("业主累计实收");
  expect(host.textContent).toContain("4,725 万西法");
  expect(host.textContent).not.toContain("待收租金未登记");
  const rows = buildOperatingCollectionRows(
    { projectId: asset.projectId, canWrite: false, assets: [asset], entries },
    today,
    "zh",
  );
  expect(rows[0]).toMatchObject({
    paidThrough: null,
    ownerSettledThrough: "2024-08-31",
    amount: "4,725 万西法",
    amountLabel: "业主到期未结",
    status: "overdue",
  });
  await act(async () =>
    root.render(
      <UnifiedLeaseCollections
        rows={rows}
        locale="zh"
        initialCategory="all"
        unavailable={{ apartments: false, operatingAssets: false }}
      />,
    ),
  );
  expect(host.textContent).toContain("业主分账已结至");
});

it("replaces the old cash-only summary with the verified account after refreshed server props arrive", async () => {
  const asset = ownerRentUiAsset(),
    entries = ownerRentUiEntries();
  const before = {
    ...asset,
    leaseEvidence: { ...asset.leaseEvidence!, ownerRentAccount: undefined },
  };
  const latestOnly = entries.slice(-1);
  await act(async () =>
    root.render(
      <OperatingAssetDetail
        asset={before}
        entries={latestOnly}
        followUp={getOperatingAssetFollowUp(before, latestOnly, today)}
        today={today}
        locale="zh"
        ownerSettlementEnabled
        canWrite={false}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(document.body.textContent).toContain("累计已收租金（按资产）500 万西法");
  expect(document.body.textContent).toContain("原表登记未收未登记");
  await act(async () =>
    root.render(
      <OperatingAssetDetail
        asset={asset}
        entries={entries}
        followUp={getOperatingAssetFollowUp(asset, entries, today)}
        today={today}
        locale="zh"
        ownerSettlementEnabled
        canWrite={false}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(document.body.textContent).toContain("业主累计实收2,250 万西法");
  expect(document.body.textContent).toContain("业主到期未结（截至 2026-11-13）4,725 万西法");
  expect(document.body.textContent).not.toContain("原表登记未收");
});
