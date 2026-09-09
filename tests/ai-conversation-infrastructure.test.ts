import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI conversation infrastructure", () => {
  const migration = read("supabase/migrations/20260907133648_add_ai_conversations.sql");
  const roleRepair = read("supabase/migrations/20260907154428_allow_front_desk_ai_conversations.sql");
  const service = read("src/features/ai-workbench/conversation-service.ts");
  const actions = read("src/features/ai-workbench/actions.ts");
  const scan = read("src/app/api/receipt/scan/route.ts");

  it("creates owner-scoped conversation tables with explicit Data API grants", () => {
    for (const table of ["ai_conversations", "ai_conversation_turns"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toMatch(/revoke all on table public\.ai_conversations, public\.ai_conversation_turns from anon, authenticated/i);
    expect(migration).toMatch(/conversation\.actor_id = \(select auth\.uid\(\)\)/i);
    expect(migration).toContain("Conversation context is never execution authority");
    expect(roleRepair).toMatch(/has_app_role\('admin', 'boss', 'finance', 'front_desk', 'rental_sales'\)/i);
  });

  it("prevents jobs from linking to another actor's conversation", () => {
    expect(migration).toMatch(/create policy "actors create their ai jobs"[\s\S]+conversation\.actor_id = \(select auth\.uid\(\)\)/i);
    expect(migration).toMatch(/create policy "actors update their ai jobs"[\s\S]+conversation\.actor_id = \(select auth\.uid\(\)\)/i);
  });

  it("loads only through the authenticated client and bounds retained history", () => {
    expect(service).toContain("await requireAuth()");
    expect(service).toContain("Math.min(30");
    expect(service).toContain('.eq("conversation_id", conversationId)');
    expect(service).not.toContain("service_role");
  });

  it("threads conversation identity through text and receipt requests", () => {
    expect(actions).toContain('formData.get("conversation_id")');
    expect(actions).toContain("loadRecentConversationContexts(conversationId)");
    expect(actions).toContain("selectConversationContext");
    expect(actions).toContain("enrichQueryWithConversationContext");
    expect(scan).toContain('form.get("conversation_id")');
    expect(scan).toContain("appendConversationTurn");
  });
});
