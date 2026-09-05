import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_ACTIONS } from "../src/features/business-actions/registry";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260905083639_create_ai_draft_infrastructure.sql"),
  "utf8",
);

describe("AI draft infrastructure migration", () => {
  it("creates all four evidence tables with RLS and explicit grants", () => {
    for (const table of ["ai_jobs", "ai_inputs", "ai_proposed_actions", "ai_action_events"]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toMatch(/revoke all on table public\.ai_jobs[\s\S]+from anon, authenticated/i);
    expect(sql).toMatch(/grant select, insert on table public\.ai_jobs, public\.ai_inputs, public\.ai_proposed_actions to authenticated/i);
    expect(sql).toMatch(/grant select on table public\.ai_action_events to authenticated/i);
  });

  it("owns records by the authenticated actor and rechecks project access", () => {
    expect(sql).toMatch(/actor_id uuid not null default auth\.uid\(\)/i);
    expect(sql).toMatch(/actor_role = public\.current_user_role\(\)/i);
    expect(sql).toMatch(/project_id is null or public\.can_access_project\(project_id\)/i);
    expect(sql).toMatch(/and status = 'input_received'/i);
    expect(sql).toMatch(/status in \('awaiting_clarification', 'proposed'\)[\s\S]+and version = 1/i);
  });

  it("keeps AI input files private and isolated by owner path", () => {
    expect(sql).toMatch(/'ai-inputs',[\s\S]+false,[\s\S]+20971520/i);
    expect(sql).toMatch(/owner_id = \(select auth\.uid\(\)\)::text/i);
    expect(sql).toMatch(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/i);
    expect(sql).not.toMatch(/on storage\.objects for update[\s\S]+bucket_id = 'ai-inputs'/i);
  });

  it("stores lifecycle events through database triggers instead of direct event writes", () => {
    expect(sql).toMatch(/create trigger trg_ai_job_created_event/i);
    expect(sql).toMatch(/create trigger trg_ai_input_added_event/i);
    expect(sql).toMatch(/create trigger trg_ai_proposal_created_event/i);
    expect(sql).not.toMatch(/grant [^;]*insert[^;]*public\.ai_action_events to authenticated/i);
  });

  it("keeps privileged transition bodies in a private schema behind invoker wrappers", () => {
    expect(sql).toMatch(/create or replace function private\.confirm_ai_proposed_action[\s\S]+security definer/i);
    expect(sql).toMatch(/create or replace function public\.confirm_ai_proposed_action[\s\S]+security invoker/i);
    expect(sql).toMatch(/revoke all on schema private from public, anon, authenticated/i);
    expect(sql).toMatch(/proposalVersionChanged/i);
    expect(sql).toMatch(/create or replace function private\.revise_ai_proposed_action/i);
    expect(sql).toMatch(/create or replace function private\.reject_ai_proposed_action/i);
    expect(sql).toMatch(/rejectionReasonRequired/i);
  });

  it("publishes named RPC parameters for PostgREST calls", () => {
    expect(sql).toMatch(/public\.confirm_ai_proposed_action\(p_proposal_id uuid, p_expected_version integer, p_request_id uuid\)/i);
    expect(sql).toMatch(/public\.reject_ai_proposed_action\(p_proposal_id uuid, p_expected_version integer, p_reason text\)/i);
  });

  it("mirrors every registered write action at the database permission boundary", () => {
    const writes = BUSINESS_ACTIONS.filter((action) => action.write);
    for (const action of writes) {
      expect(sql).toContain(`('${action.name}', '${action.risk}'`);
    }
    for (const action of BUSINESS_ACTIONS.filter((item) => !item.write)) {
      expect(sql).not.toContain(`('${action.name}',`);
    }
    expect(sql).toMatch(/businessActionPermissionDenied/i);
  });

  it("requires idempotency and post-write verification", () => {
    expect(sql).toMatch(/execution_request_id uuid unique/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/successfulExecutionMustBeVerified/i);
    expect(sql).toMatch(/failedExecutionRequiresError/i);
    expect(sql).toMatch(/status in \('executing', 'executed', 'failed'\)/i);
  });

  it("does not complete a multi-action job while another proposal is active", () => {
    expect(sql).toMatch(/proposal\.status in \('awaiting_clarification', 'proposed', 'confirmed', 'executing'\)/i);
    expect(sql).toMatch(/then 'awaiting_confirmation'/i);
  });

  it("uses separate retention windows for raw inputs and audit evidence", () => {
    expect(sql).toMatch(/ai_jobs[\s\S]+retention_until timestamptz not null default \(now\(\) \+ interval '365 days'\)/i);
    expect(sql).toMatch(/ai_inputs[\s\S]+retention_until timestamptz not null default \(now\(\) \+ interval '30 days'\)/i);
    expect(sql).toMatch(/ai_inputs_pending_redaction_idx/i);
    expect(sql).toMatch(/retention_until between created_at and created_at \+ interval '31 days'/i);
    expect(sql).toMatch(/create or replace function private\.redact_expired_ai_input/i);
    expect(sql).toMatch(/aiInputRetentionNotExpired/i);
    expect(sql).toMatch(/event_type, event_payload[\s\S]+input_redacted/i);
  });
});
