import type { UserRole } from "@/lib/auth";

export type BusinessDomain = "daily_rental" | "lease" | "sale" | "unit";
export type BusinessActionRisk = "L0" | "L1" | "L2" | "L3";

export interface BusinessActionDefinition {
  name: string;
  domain: BusinessDomain;
  risk: BusinessActionRisk;
  write: boolean;
  allowedRoles: readonly UserRole[];
  description: string;
}

export interface BusinessActionEffect {
  entityType: string;
  entityId?: string;
  operation: "insert" | "update" | "cancel" | "reverse";
  summary: string;
}

export interface BusinessActionResult<TData = unknown> {
  success: boolean;
  action: string;
  requestId: string;
  data?: TData;
  effects: BusinessActionEffect[];
  warnings: string[];
  verified: boolean;
  error?: string;
}

export interface ProposedBusinessAction<TInput = Record<string, unknown>> {
  proposalId: string;
  action: string;
  risk: BusinessActionRisk;
  target: {
    projectId?: string;
    buildingId?: string;
    unitId?: string;
    bookingId?: string;
    leaseContractId?: string;
    saleContractId?: string;
    customerId?: string;
  };
  input: TInput;
  beforeSnapshot: Record<string, unknown>;
  expectedEffects: BusinessActionEffect[];
  warnings: string[];
  confidence: number;
  requiresClarification: boolean;
  expiresAt: string;
}
