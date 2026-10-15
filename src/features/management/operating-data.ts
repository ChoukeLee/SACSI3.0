import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { decodeOperatingSnapshot } from "./operating-snapshot";

export const getOperatingSnapshot = cache(async (projectId: string) => {
  const client = await createClient();
  const { data, error } = await client.rpc("management_operating_snapshot_rpc", {
    p_project_id: projectId,
  });
  if (error) throw new Error("OperatingSnapshotUnavailable");
  const snapshot = decodeOperatingSnapshot(data);
  if (snapshot.projectId !== projectId) throw new Error("OperatingSnapshotScopeMismatch");
  return snapshot;
});
