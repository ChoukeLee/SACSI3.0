import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI workbench human-confirmed execution (L1)", () => {
  const workbench = read("src/features/ai-workbench/actions.ts");
  const draftService = read("src/features/ai-workbench/action-draft-service.ts");
  const types = read("src/features/ai-workbench/types.ts");
  const view = read("src/features/ai-workbench/workbench-view.tsx");
  const dailyActions = read("src/features/daily-rentals/actions.ts");

  it("exposes a confirm action next to the query action", () => {
    expect(workbench).toContain("export async function confirmWorkbenchAction");
    expect(workbench).toContain("export async function askWorkbench");
  });

  it("reuses the same atomic daily-rental RPC as the manual page, never a privileged client", () => {
    expect(workbench).toContain('completeCleaning');
    expect(workbench).toContain('from "@/features/daily-rentals/actions"');
    expect(workbench).not.toContain("createPrivilegedClient");
    expect(dailyActions).toContain("daily_complete_cleaning_rpc");
  });

  it("keeps auth and role guards before any write and re-checks facts server-side", () => {
    expect(workbench).toContain("await requireAuth();");
    expect(workbench).toContain('hasPermission(user, "daily_rentals:write")');
    // The re-query happens before (task still pending/unique) and after (verify) the RPC.
    const first = workbench.indexOf('.from("cleaning_tasks")');
    const last = workbench.lastIndexOf('.from("cleaning_tasks")');
    expect(first).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(first);
    expect(workbench).toContain("草稿已过期");
  });

  it("rejects a request whose posted target no longer matches the database", () => {
    expect(workbench).toContain("task.unit_id !== unitId");
    expect(workbench).toContain("task.is_completed");
    expect(workbench).toContain("unit.unit_no !== unitNo");
  });

  it("carries stable execution identity into the draft and posts it back with the confirm form", () => {
    expect(draftService).toContain("canConfirm: true");
    expect(draftService).toContain("execution: {");
    expect(draftService).toContain("taskId: task.id");
    expect(draftService).toContain("unitId: unit.id");
    for (const field of ["execution_action", "task_id", "unit_id", "building_code", "unit_no"]) {
      expect(view).toContain(`name="${field}"`);
    }
  });

  it("defines a verified action-result response for the executed effect", () => {
    expect(types).toContain('kind: "action_result"');
    expect(types).toContain("verification: WorkbenchEvidence[]");
    expect(types).toContain("execution: WorkbenchCleaningExecution");
    // The view renders an execution result distinct from a plain query result.
    expect(view).toContain("WorkbenchActionResultView");
  });
});
