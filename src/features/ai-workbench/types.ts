export type WorkbenchDomain = "all" | "daily" | "lease" | "sale";

export type WorkbenchQueryKind =
  | "daily_status"
  | "receivable_overdue"
  | "receivable_outstanding"
  | "receivable_due_soon"
  | "unit_snapshot"
  | "unsupported";

export interface WorkbenchIntent {
  kind: WorkbenchQueryKind;
  domain: WorkbenchDomain;
  buildingCode: string | null;
  unitNo: string | null;
  customerName: string | null;
  days: number;
  asOfDate: string;
  confidence: number;
  source: "rules" | "deepseek" | "openai";
}

export type WorkbenchTone = "neutral" | "blue" | "green" | "amber" | "red" | "purple" | "teal";

export interface WorkbenchMetric {
  label: string;
  value: string;
  tone: WorkbenchTone;
}

export interface WorkbenchTable {
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, string | number | null>>;
}

export interface WorkbenchEvidence {
  label: string;
  value: string;
}

export interface WorkbenchResult {
  kind: "query_result";
  query: string;
  intent: WorkbenchIntent;
  title: string;
  answer: string;
  scope: string;
  metrics: WorkbenchMetric[];
  table: WorkbenchTable | null;
  evidence: WorkbenchEvidence[];
  warnings: string[];
  generatedAt: string;
  resultCount: number;
}

export interface WorkbenchCleaningExecution {
  action: "complete_daily_cleaning";
  taskId: string;
  unitId: string;
  buildingCode: string;
  unitNo: string;
  /** ai_jobs + ai_proposed_actions evidence identity, filled after the draft is persisted. */
  jobId?: string;
  proposalId?: string;
  proposalVersion?: number;
}

export interface WorkbenchCleaningMachineEffect {
  entityType: string;
  entityId?: string;
  operation: "insert" | "update" | "cancel" | "reverse";
  summary: string;
}

export interface WorkbenchCleaningMachine {
  buildingId: string;
  bookingId: string | null;
  beforeSnapshot: Record<string, unknown>;
  expectedEffects: WorkbenchCleaningMachineEffect[];
}

export interface WorkbenchDraftPreview {
  kind: "action_draft";
  action: "complete_daily_cleaning";
  risk: "L1";
  title: string;
  summary: string;
  target: WorkbenchEvidence[];
  beforeState: WorkbenchEvidence[];
  expectedEffects: string[];
  warnings: string[];
  generatedAt: string;
  confidence: number;
  canConfirm: true;
  confirmationNote: string;
  /** Stable execution identity posted back on confirm; never trusted without re-check. */
  execution: WorkbenchCleaningExecution;
  /** Structured evidence facts for the ai_* proposal ledger (not rendered). */
  machine: WorkbenchCleaningMachine;
}

export interface WorkbenchActionResult {
  kind: "action_result";
  action: "complete_daily_cleaning";
  risk: "L1";
  title: string;
  summary: string;
  executedAt: string;
  target: WorkbenchEvidence[];
  verification: WorkbenchEvidence[];
  warnings: string[];
}

export type WorkbenchResponse = WorkbenchResult | WorkbenchDraftPreview | WorkbenchActionResult;

export interface WorkbenchActionState {
  status: "idle" | "success" | "error";
  result: WorkbenchResponse | null;
  error: string | null;
}

export const INITIAL_WORKBENCH_STATE: WorkbenchActionState = {
  status: "idle",
  result: null,
  error: null,
};
