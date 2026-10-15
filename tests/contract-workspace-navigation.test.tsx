// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useContractWorkspace } from "../src/features/contracts/use-workspace";
import { parseWorkspaceQuery, type WorkspaceData } from "../src/features/contracts/workspace-model";
import { workspaceFixture, workspaceContract } from "./fixtures/contract-workspace";
let root: Root, host: HTMLDivElement, api: ReturnType<typeof useContractWorkspace>;
const pending: { url: URL; finish: (value: Response) => void }[] = [];
function Probe({ initial }: { initial: WorkspaceData }) {
  api = useContractWorkspace(initial);
  return (
    <output>
      {api.unavailable
        ? "unknown"
        : `${api.query?.page}:${api.pageData?.stats.currentDue}:${api.detailData?.contracts[0]?.id ?? "none"}`}
    </output>
  );
}
const flush = () =>
  act(async () => {
    await vi.runAllTimersAsync();
  });
function finish(index: number, overrides: Partial<WorkspaceData> = {}) {
  const p = pending[index],
    raw = Object.fromEntries(p.url.searchParams);
  const mode = raw.mode as WorkspaceData["mode"];
  delete raw.mode;
  delete raw.contractId;
  const query = parseWorkspaceQuery(raw);
  const total = query.page === 2 ? 26 : 1;
  p.finish(Response.json(workspaceFixture({ total, ...overrides }, query, mode)));
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
          pending.push({ url: new URL(url, "http://local.invalid"), finish: resolve });
        }),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe initial={workspaceFixture()} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("uses the SSR snapshot once, then queries cross-page and return navigation without an old snapshot cache", async () => {
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => api.change({ page: 2 }));
  await flush();
  await act(async () => finish(0));
  expect(host.textContent).toContain("2:");
  await act(async () => api.change({ page: 1 }));
  await flush();
  await act(async () => finish(1, { stats: { ...workspaceFixture().stats, currentDue: 50 } }));
  expect(host.textContent).toContain("1:50:");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not allow a delayed old page to overwrite a newer page", async () => {
  await act(async () => api.change({ page: 2 }));
  await flush();
  await act(async () => api.change({ page: 1 }));
  await flush();
  await act(async () => finish(1, { stats: { ...workspaceFixture().stats, currentDue: 50 } }));
  await act(async () => finish(0));
  expect(host.textContent).toContain("1:50:");
});
it("hides stale data on failure and retries only reading", async () => {
  await act(async () => api.change({ page: 2 }));
  await flush();
  await act(async () => pending[0].finish(new Response("", { status: 503 })));
  expect(host.textContent).toBe("unknown");
  await act(async () => api.retry());
  await flush();
  await act(async () => finish(1));
  expect(host.textContent).toContain("2:");
});
it("loads complete detail only on intent, and write refresh rereads current list and selected detail", async () => {
  let operation: Promise<unknown>;
  await act(async () => {
    operation = api.ensure("detail", workspaceContract);
  });
  expect(pending[0].url.searchParams.get("mode")).toBe("detail");
  await act(async () => {
    finish(0);
    await operation!;
  });
  await act(async () => {
    operation = api.refresh();
  });
  expect(pending).toHaveLength(3);
  expect(host.textContent).toBe("unknown");
  await act(async () => {
    finish(1, { stats: { ...workspaceFixture().stats, currentDue: 25 } });
    finish(2);
    await operation!;
  });
  expect(host.textContent).toContain(`1:25:${workspaceContract}`);
});
it("rejects delayed special data across a new SSR project and keeps the new scope", async () => {
  let operation: Promise<unknown>;
  await act(async () => {
    operation = api.ensure("detail", workspaceContract).catch(() => undefined);
  });
  const next = workspaceFixture(
    {},
    parseWorkspaceQuery({ projectId: "88888888-8888-4888-8888-888888888888" }),
  );
  await act(async () => root.render(<Probe initial={next} />));
  await act(async () => {
    finish(0);
    await operation!;
  });
  expect(api.query?.projectId).toBe(next.query.projectId);
  expect(api.detailData).toBeUndefined();
  expect(host.textContent).not.toBe("unknown");
});
it("clamps a removed final page and rereads the last valid page after refresh", async () => {
  await act(async () => api.change({ page: 2 }));
  await flush();
  await act(async () => finish(0));
  let op: Promise<unknown>;
  await act(async () => {
    op = api.refresh();
  });
  await act(async () => {
    finish(1, { total: 25, contracts: [], summaries: {}, accruals: {}, attentionDue: {} });
    await op!;
  });
  await flush();
  expect(pending[2].url.searchParams.get("page")).toBe("1");
  await act(async () => finish(2));
  expect(host.textContent).toContain("1:");
});
it("invalidates same-scope new SSR props and rereads the selected complete detail", async () => {
  let op: Promise<unknown>;
  await act(async () => {
    op = api.ensure("detail", workspaceContract);
  });
  await act(async () => {
    finish(0);
    await op!;
  });
  await act(async () => root.render(<Probe initial={workspaceFixture()} />));
  expect(host.textContent).toBe("unknown");
  expect(pending).toHaveLength(3);
  await act(async () => {
    finish(1, { stats: { ...workspaceFixture().stats, currentDue: 10 } });
    finish(2);
  });
  expect(host.textContent).toContain(`1:10:${workspaceContract}`);
});
it("does not let an old refresh overwrite new SSR scope data", async () => {
  let op: Promise<unknown>;
  await act(async () => {
    op = api.refresh();
  });
  const next = workspaceFixture(
    {},
    parseWorkspaceQuery({ projectId: "88888888-8888-4888-8888-888888888888" }),
  );
  await act(async () => root.render(<Probe initial={next} />));
  await act(async () => {
    finish(0);
    await op!;
  });
  expect(api.query?.projectId).toBe(next.query.projectId);
  expect(api.pageData?.query.projectId).toBe(next.query.projectId);
});
