// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useContractWorkspace } from "@/features/contracts/use-workspace";
import { parseWorkspaceQuery, type WorkspaceData } from "@/features/contracts/workspace-model";
import { saleFixture } from "./fixtures/sale-workbench";
import { workspaceProject, workspaceBuilding } from "./fixtures/contract-workspace";

let api: ReturnType<typeof useContractWorkspace>, host: HTMLDivElement, root: Root;
const pending: { url: URL; finish: (response: Response) => void }[] = [];
const initial = saleFixture(
  parseWorkspaceQuery({ projectId: workspaceProject, status: "active", search: "buyer", page: 2 }),
  "list",
  26,
);
function Probe() {
  api = useContractWorkspace(initial);
  return <output>{api.contextData?.query.buildingId ?? "no-context"}</output>;
}
function finish(index: number) {
  const request = pending[index];
  const raw = Object.fromEntries(request.url.searchParams);
  const mode = raw.mode as WorkspaceData["mode"];
  const room = raw.roomOverview === "1";
  delete raw.mode;
  delete raw.roomOverview;
  const query = parseWorkspaceQuery(raw);
  const data = saleFixture(query, mode, 1);
  request.finish(
    Response.json({
      ...data,
      ...(room
        ? {
            roomPayments: [],
            roomReceivables: [],
            roomSchedules: [],
            roomFinanceCounts: { payments: 0, receivables: 0, schedules: 0 },
          }
        : {}),
    }),
  );
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pending.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pending.push({ url: new URL(url, "https://local.invalid"), finish: resolve });
        }),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does not accept an ordinary filtered sale form context as the complete room finance cache", async () => {
  let form: Promise<WorkspaceData>, room: Promise<WorkspaceData>;
  await act(async () => {
    form = api.ensure("context");
  });
  expect(pending[0].url.searchParams.has("roomOverview")).toBe(false);
  await act(async () => {
    finish(0);
    await form!;
  });
  expect(api.contextData?.roomFinanceCounts).toBeUndefined();
  await act(async () => {
    room = api.ensureRoomContext();
  });
  expect(pending).toHaveLength(2);
  expect(Object.fromEntries(pending[1].url.searchParams)).toMatchObject({
    roomOverview: "1",
    status: "all",
    search: "",
    page: "1",
  });
  await act(async () => {
    finish(1);
    await room!;
  });
  expect(api.contextData?.roomFinanceCounts).toEqual({ payments: 0, receivables: 0, schedules: 0 });
  await act(async () => {
    form = api.ensure("context");
  });
  await act(async () => {
    finish(2);
    await form!;
  });
  expect(api.contextData?.roomFinanceCounts).toBeUndefined();
  await act(async () => {
    room = api.ensureRoomContext();
  });
  expect(pending).toHaveLength(4);
  expect(pending[3].url.searchParams.get("roomOverview")).toBe("1");
  await act(async () => {
    finish(3);
    await room!;
  });
  expect(api.contextData?.roomFinanceCounts).toEqual({ payments: 0, receivables: 0, schedules: 0 });
});

it("rejects an old sale room response after a building switch and never restores the old finance scope", async () => {
  let old: Promise<unknown>;
  await act(async () => {
    old = api.ensureRoomContext().catch(() => undefined);
  });
  await act(async () => api.change({ buildingId: workspaceBuilding, page: 1 }));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  const current = pending.findIndex(
    (request) =>
      request.url.searchParams.get("roomOverview") === "1" &&
      request.url.searchParams.get("buildingId") === workspaceBuilding,
  );
  expect(current).toBeGreaterThan(0);
  await act(async () => {
    finish(1);
    finish(current);
  });
  expect(api.contextData?.query.buildingId).toBe(workspaceBuilding);
  await act(async () => {
    finish(0);
    await old!;
  });
  expect(api.contextData?.query.buildingId).toBe(workspaceBuilding);
  expect(api.contextData?.roomFinanceCounts).toEqual({ payments: 0, receivables: 0, schedules: 0 });
});
