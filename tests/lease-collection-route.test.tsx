import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ user: vi.fn(), read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: deps.user }));
vi.mock("@/features/leases/lease-collection-read", () => ({
  readLeaseCollectionContext: deps.read,
}));
vi.mock("@/features/leases/lease-collection-workbench", () => ({
  LeaseCollectionWorkbench: () => null,
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));

import { LeaseCollectionPage } from "@/features/leases/lease-collection-page";
import { workspaceFixture, workspaceContract } from "./fixtures/contract-workspace";
import { parseWorkspaceQuery } from "@/features/contracts/workspace-model";

function props(locale: "zh" | "fr" = "zh", id = workspaceContract, returnTo?: string | string[]) {
  return { params: Promise.resolve({ id }), searchParams: Promise.resolve({ returnTo }), locale };
}
async function content(returnTo?: string | string[], workArea?: "sacsi" | "cimac") {
  const page = await LeaseCollectionPage({ ...props("zh", workspaceContract, returnTo), workArea });
  const child = (page as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props
    .children;
  return (
    child.type as (p: Record<string, unknown>) => Promise<ReactElement<Record<string, unknown>>>
  )(child.props);
}
beforeEach(() => {
  vi.clearAllMocks();
  deps.user.mockResolvedValue({ id: "actor", role: "finance", displayName: "Synthetic recorder" });
  const data = workspaceFixture({}, parseWorkspaceQuery({ status: "all" }), "detail");
  deps.read.mockResolvedValue({
    contract: data.contracts[0],
    unit: data.units[0],
    customer: data.customers[0],
    building: data.buildings[0],
    receivables: data.receivables,
    today: data.today,
    writeReady: false,
  });
});

it("redirects unauthenticated visitors before reading any financial context", async () => {
  deps.user.mockResolvedValue(null);
  await expect(LeaseCollectionPage(props())).rejects.toThrow("redirect:/login");
  expect(deps.read).not.toHaveBeenCalled();
});
it.each(["boss", "front_desk", "rental_sales"])(
  "does not turn the %s read capability into finance write access",
  async (role) => {
    deps.user.mockResolvedValue({ role });
    await expect(LeaseCollectionPage(props("fr"))).rejects.toThrow("redirect:/fr/leases");
    expect(deps.read).not.toHaveBeenCalled();
  },
);
it("rejects a malformed contract before creating a data-loading subtree", async () => {
  await expect(LeaseCollectionPage(props("zh", "308"))).rejects.toThrow("not-found");
  expect(deps.read).not.toHaveBeenCalled();
});
it.each(["admin", "finance"])(
  "gives %s a fresh exact-contract workspace, retaining recorder and collector separation",
  async (role) => {
    deps.user.mockResolvedValue({ id: "actor", role, displayName: "Recorder only" });
    const result = await content();
    expect(deps.read).toHaveBeenCalledWith(workspaceContract, "zh");
    expect(result.props.recordedByLabel).toBe("Recorder only");
    expect(result.props.viewerId).toBe("actor");
    expect(result.props.writeReady).toBe(false);
    expect(result.props).not.toHaveProperty("actualCollector");
    expect(result.props.returnHref).toContain(`contract=${workspaceContract}`);
    expect(result.props.returnHref).toContain("building=");
  },
);
it("preserves a safe return source but strips unsafe or repeated values", async () => {
  expect((await content("/customers?customer=synthetic")).props.returnHref).toBe(
    "/customers?customer=synthetic",
  );
  expect((await content("https://evil.invalid")).props.returnHref).toMatch(/^\/leases\?contract=/);
  expect((await content(["/leases", "https://evil.invalid"])).props.returnHref).toMatch(
    /^\/leases\?contract=/,
  );
});
it("does not expose an empty form when a complete contract context cannot be loaded", async () => {
  deps.read.mockRejectedValue(new Error("offline"));
  const result = await content();
  const html = renderToStaticMarkup(result);
  expect(html).toContain("暂时无法核对这份合同");
  expect(html).toContain("未开放收款");
  expect(html).not.toContain("<form");
});
it("redirects an old bookmarked park collection into its native workspace before rendering a write form", async () => {
  const data = await deps.read();
  data.building.project.code = "CIMAC";
  await expect(content()).rejects.toThrow(`redirect:/cimac/contracts/${workspaceContract}/collect`);
});
it("keeps a native park collection's exact-contract read and default return inside the park", async () => {
  const data = await deps.read();
  data.building.project.code = "CIMAC";
  const result = await content(undefined, "cimac");
  expect(deps.read).toHaveBeenLastCalledWith(workspaceContract, "zh", "cimac");
  expect(result.props.workArea).toBe("cimac");
  const href = new URL(String(result.props.returnHref), "https://local.invalid");
  expect(href.pathname).toBe("/cimac/contracts");
  expect(href.searchParams.get("contract")).toBe(workspaceContract);
});
