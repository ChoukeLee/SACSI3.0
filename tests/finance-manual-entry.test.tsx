// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/finance/actions", () => ({ addLedgerEntry: vi.fn() }));
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({
    open,
    title,
    subtitle,
    children,
    onClose,
  }: {
    open: boolean;
    title: string;
    subtitle: string;
    children: React.ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <section role="dialog" aria-label={title}>
        <button type="button" onClick={onClose}>
          Close
        </button>
        <p>{subtitle}</p>
        {children}
      </section>
    ) : null,
}));
import { FinanceManualEntry } from "@/features/finance/finance-manual-entry";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondProjectId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const buildingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secondBuildingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const unitId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const building = { id: buildingId, project_id: projectId, display_name: "示例楼栋", code: "B1" };
const secondBuilding = {
  id: secondBuildingId,
  project_id: projectId,
  display_name: "第二楼栋",
  code: "B2",
};
const unit = { id: unitId, building_id: buildingId, unit_no: "101" };
const response = (data: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
const options = (selected: string | null = null, project: string | null = projectId) => ({
  scope: { projectId: project, buildingId: selected },
  buildings: selected
    ? [selected === buildingId ? building : secondBuilding]
    : [building, secondBuilding],
  units: selected === buildingId ? [unit] : [],
});
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function render(props: Partial<React.ComponentProps<typeof FinanceManualEntry>> = {}) {
  await act(async () =>
    root.render(<FinanceManualEntry locale="zh" canWrite projectId={projectId} {...props} />),
  );
}
async function click(name: string) {
  const button = [...host.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );
  if (!button) throw new Error(`Missing button ${name}`);
  await act(async () => button.click());
}
async function chooseBuilding(id: string) {
  const select = host.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, "https://sacsi.example").searchParams;
    return response(options(params.get("buildingId"), params.get("projectId")));
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("on-demand manual entry drawer", () => {
  it("never requests options on initial render and does not mount the form", async () => {
    await render();
    expect(host.textContent).toBe("手工记账");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector("form")).toBeNull();
  });

  it("does not offer a button or make requests without write permission", async () => {
    await render({ canWrite: false });
    expect(host.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an explicit authorized building before loading any units or showing a form", async () => {
    await render();
    await click("手工记账");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/finance/manual-options?projectId=${projectId}`);
    expect(host.querySelector("form")).toBeNull();
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("");
    await chooseBuilding(buildingId);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `/api/finance/manual-options?projectId=${projectId}&buildingId=${buildingId}`,
    );
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelector("summary")).toBeNull();
    expect(host.querySelectorAll("form")).toHaveLength(1);
    expect([...host.querySelectorAll("select")].filter((select) => !select.name)).toHaveLength(1);
    expect(host.querySelector("form")?.textContent).not.toContain("手工记账");
    expect(
      [...host.querySelectorAll('select[name="unitId"] option')].map(
        (option) => option.textContent,
      ),
    ).toEqual(["—", "101"]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("opens a fixed scope with only its building and units", async () => {
    await render({ buildingId });
    await click("手工记账");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(`buildingId=${buildingId}`);
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("form")?.textContent).toContain("示例楼栋");
    expect([...host.querySelectorAll("select")].filter((select) => !select.name)).toHaveLength(0);
  });

  it("shows an independent retry state and never mounts a form after a failed read", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 503));
    await render({ buildingId });
    await click("手工记账");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("记账选项暂时无法读取");
    expect(host.querySelector("form")).toBeNull();
    await click("重新读取");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.querySelector("form")).not.toBeNull();
  });

  it("hides the previous form immediately while switching building and aborts its prior request", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    await render();
    await click("手工记账");
    await chooseBuilding(buildingId);
    fetchMock.mockReturnValueOnce(pending.promise);
    await chooseBuilding(secondBuildingId);
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("读取授权楼栋");
    const signal = fetchMock.mock.calls[2][1].signal as AbortSignal;
    await click("Close");
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response(options(secondBuildingId))));
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("rejects a response whose scope or unit association does not match the selected building", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ ...options(buildingId), units: [{ ...unit, building_id: secondBuildingId }] }),
    );
    await render({ buildingId });
    await click("手工记账");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector("form")).toBeNull();
  });

  it("does not accept a late old-project response after the workbench scope changes", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render({ buildingId });
    await click("手工记账");
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await render({ projectId: secondProjectId, buildingId: secondBuildingId });
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response(options(buildingId))));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toContain("示例楼栋");
  });

  it("clears a mounted form immediately when write permission is revoked", async () => {
    await render({ buildingId });
    await click("手工记账");
    expect(host.querySelector("form")).not.toBeNull();
    await render({ canWrite: false, buildingId });
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
  });

  it("reloads metadata when reopened rather than reusing a closed form snapshot", async () => {
    await render({ buildingId });
    await click("手工记账");
    await click("Close");
    await click("手工记账");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains French labels and the original manual entry transaction fields", async () => {
    await render({ locale: "fr", buildingId });
    await click("Écriture manuelle");
    expect(host.textContent).toContain("Écritures hors encaissements métier");
    expect(host.querySelector('input[name="amount"]')?.getAttribute("step")).toBe("0.01");
    expect(
      [...host.querySelectorAll('select[name="direction"] option')].map(
        (option) => (option as HTMLOptionElement).value,
      ),
    ).toEqual(["income", "expense", "liability_in", "liability_out"]);
  });
});
