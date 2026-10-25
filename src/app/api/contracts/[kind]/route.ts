import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  parseWorkspaceQuery,
  WorkspaceReadError,
  type WorkspaceKind,
  type WorkspaceMode,
} from "@/features/contracts/workspace-model";
import { readWorkspace } from "@/features/contracts/workspace-service";
import { createRequestTiming } from "@/lib/performance";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const timing = createRequestTiming();
  const response = await timing.measure("total", async () => {
    try {
      const user = await timing.measure("authorization", getCurrentUser);
      if (!user)
        return Response.json({ error: "authenticationRequired" }, { status: 401, headers });
      const { kind } = await params;
      if (kind !== "lease" && kind !== "sale")
        return Response.json({ error: "invalidContractRead" }, { status: 400, headers });
      if (!hasPermission(user, kind === "lease" ? "leases:read" : "sales:read"))
        return Response.json({ error: "contractPermissionDenied" }, { status: 403, headers });
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((k) => search.getAll(k).length !== 1))
        throw new WorkspaceReadError(400);
      const mode = search.get("mode") ?? "list",
        id = search.get("contractId") ?? undefined;
      const workArea = search.get("workspace") ?? "sacsi";
      if (workArea === "cimac" && !["admin", "boss", "finance", "rental_sales"].includes(user.role))
        throw new WorkspaceReadError(403);
      search.delete("mode");
      search.delete("contractId");
      search.delete("workspace");
      if (
        (workArea !== "sacsi" && workArea !== "cimac") ||
        (workArea === "cimac" && kind !== "lease") ||
        !["list", "scope", "detail", "context"].includes(mode) ||
        (mode === "detail" ? !id || !/^[0-9a-f-]{36}$/i.test(id) : Boolean(id))
      )
        throw new WorkspaceReadError(400);
      const query = parseWorkspaceQuery(Object.fromEntries(search));
      const data = await timing.measure("database", async () =>
        readWorkspace(
          await createClient(),
          kind as WorkspaceKind,
          query,
          mode as WorkspaceMode,
          id,
          workArea,
        ),
      );
      return timing.measure("response", () => Response.json(data, { headers }));
    } catch (error) {
      const failure = error instanceof WorkspaceReadError ? error : new WorkspaceReadError();
      return Response.json(
        {
          error:
            failure.status === 403
              ? "contractPermissionDenied"
              : failure.status === 400
                ? "invalidContractRead"
                : "contractWorkspaceUnavailable",
        },
        { status: failure.status, headers },
      );
    }
  });
  return timing.response(response);
}
