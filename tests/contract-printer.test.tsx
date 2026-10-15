// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reserve: vi.fn() }));
vi.mock("@/features/print/print-templates", () => ({ reservePrintWindow: mocks.reserve }));
import { useContractPrinter } from "../src/features/contracts/use-contract-printer";
let root: Root,
  host: HTMLDivElement,
  api: ReturnType<typeof useContractPrinter>,
  popup: { closed: boolean; close: ReturnType<typeof vi.fn> };
function Probe({ scope = "one" }: { scope?: string }) {
  api = useContractPrinter(scope, "zh");
  return <output>{api.error}</output>;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  popup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
  };
  mocks.reserve.mockReturnValue(popup);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("reserves the print window synchronously and fills it only after complete data arrives", async () => {
  let finish: (s: string) => void;
  const promise = new Promise<string>((resolve) => {
      finish = resolve;
    }),
    render = vi.fn();
  await act(async () => api.print(() => promise, render));
  expect(mocks.reserve).toHaveBeenCalledTimes(1);
  expect(render).not.toHaveBeenCalled();
  await act(async () => {
    finish!("complete history");
    await promise;
  });
  expect(render).toHaveBeenCalledWith("complete history", popup);
  expect(popup.close).not.toHaveBeenCalled();
});
it("explains blocked popups and never starts reading or silently leaves a blank window", async () => {
  mocks.reserve.mockReturnValue(null);
  const load = vi.fn();
  await act(async () => api.print(load, vi.fn()));
  expect(load).not.toHaveBeenCalled();
  expect(host.textContent).toContain("浏览器拦截");
});
it("closes the pending window on read failure without rendering partial history", async () => {
  const render = vi.fn();
  await act(async () => api.print(() => Promise.reject(new Error("synthetic")), render));
  expect(popup.close).toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  expect(host.textContent).toContain("未使用旧金额");
});
it("closes the pending window on scope change and ignores the old delayed response", async () => {
  let finish: (s: string) => void;
  const promise = new Promise<string>((resolve) => {
      finish = resolve;
    }),
    render = vi.fn();
  await act(async () => api.print(() => promise, render));
  await act(async () => root.render(<Probe scope="two" />));
  expect(popup.close).toHaveBeenCalled();
  await act(async () => {
    finish!("old");
    await promise;
  });
  expect(render).not.toHaveBeenCalled();
});
it("closes only its pending popup when the component unmounts", async () => {
  await act(async () => api.print(() => new Promise(() => {}), vi.fn()));
  await act(async () => root.unmount());
  expect(popup.close).toHaveBeenCalled();
});
