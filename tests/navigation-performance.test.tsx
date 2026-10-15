// @vitest-environment jsdom
import {
  act,
  Component,
  createContext,
  Suspense,
  use,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ path: (): string => "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.path(),
  useRouter: () => ({ push: mocks.push }),
}));
import {
  NavigationTransitionProvider,
  useNavigationTransition,
} from "@/components/navigation-transition-provider";
const Route = createContext("/management");
let finish: (value: boolean) => void;
let fail: (error: Error) => void;
let pending: Promise<boolean>;
let root: Root;
let host: HTMLDivElement;

function Page({ path }: { path: string }) {
  if (path !== "/management") use(pending);
  return <p>{path}</p>;
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Load failed</p> : this.props.children;
  }
}
function Probe() {
  const nav = useNavigationTransition();
  return (
    <>
      <output>{nav.isNavigating ? `pending:${nav.pendingHref}` : "idle"}</output>
      <button onClick={() => nav.startNavigation("/leases/?project=SACSI")}>Navigate</button>
      <button onClick={() => nav.startNavigation("/management/")}>Same page</button>
    </>
  );
}
function useTestPath() {
  return useContext(Route);
}
function Harness() {
  const [path, setPath] = useState("/management");
  mocks.path = useTestPath;
  mocks.push.mockImplementation((href: string) =>
    setPath(href.replace(/[?#].*$/, "").replace(/\/+$/, "")),
  );
  return (
    <Route.Provider value={path}>
      <NavigationTransitionProvider>
        <Probe />
        <Boundary>
          <Suspense fallback={<p>Loading</p>}>
            <Page path={path} />
          </Suspense>
        </Boundary>
      </NavigationTransitionProvider>
    </Route.Provider>
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  pending = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  mocks.push.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("keeps navigation pending past three seconds until the real route commits", async () => {
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(host.querySelector("output")?.textContent).toBe("pending:/leases");
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(host.querySelector("output")?.textContent).toBe("pending:/leases");
  expect(host.textContent).toContain("/management");
  await act(async () => {
    finish(true);
    await pending;
  });
  expect(host.querySelector("output")?.textContent).toBe("idle");
  expect(host.textContent).toContain("/leases");
  expect(mocks.push).toHaveBeenCalledTimes(1);
});
it("does not start or duplicate a same-route navigation", async () => {
  await act(async () => (host.querySelectorAll("button")[1] as HTMLButtonElement).click());
  expect(mocks.push).not.toHaveBeenCalled();
  expect(host.querySelector("output")?.textContent).toBe("idle");
});
it("coalesces repeated clicks on the same in-flight destination", async () => {
  await act(async () => {
    const button = host.querySelector("button") as HTMLButtonElement;
    button.click();
    button.click();
  });
  expect(mocks.push).toHaveBeenCalledTimes(1);
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(mocks.push).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(true);
    await pending;
  });
  expect(host.querySelector("output")?.textContent).toBe("idle");
});
it("releases the old-page lock when the route settles into its error boundary", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  await act(async () => {
    fail(new Error("Synthetic read failure"));
    await pending.catch(() => {});
  });
  expect(host.textContent).toContain("Load failed");
  expect(host.querySelector("output")?.textContent).toBe("idle");
});
it("disables automatic data-heavy route prefetch and lets Next handle modified clicks", () => {
  for (const file of ["app-sidebar.tsx", "mobile-bottom-nav.tsx"]) {
    const source = readFileSync(resolve(__dirname, "../src/components", file), "utf8");
    expect(source).toContain("prefetch={false}");
    expect(source).toContain("onNavigate=");
    expect(source).not.toContain("usePrefetch");
  }
  const shell = readFileSync(resolve(__dirname, "../src/components/app-shell.tsx"), "utf8");
  expect(shell).not.toContain("n.remove()");
  expect(shell).toContain("inert={isNavigating ? true : undefined}");
  const dashboard = readFileSync(
    resolve(__dirname, "../src/features/management/operating-dashboard.tsx"),
    "utf8",
  );
  const dashboardLinks = [...dashboard.matchAll(/<Link\b[^>]*>/g)];
  expect(dashboardLinks.length).toBeGreaterThan(0);
  for (const [link] of dashboardLinks) expect(link).toContain("prefetch={false}");
});
