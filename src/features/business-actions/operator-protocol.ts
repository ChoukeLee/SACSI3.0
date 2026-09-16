import type { CurrentUser } from "@/lib/auth";
import { BUSINESS_ACTIONS } from "./registry";
import { decideOperatorExecution } from "./operator-execution-policy";

export const SACSI_OPERATOR_PROTOCOL_VERSION = "1.0";
export const SACSI_OPERATOR_MIN_CONNECTOR_VERSION = "0.1.0";
export const IMPLEMENTED_OPERATOR_ACTIONS = new Set([
  "query_daily_booking",
  "record_daily_payment",
  "renew_lease",
]);

export interface OperatorProtocolManifest {
  protocolVersion: string;
  minimumConnectorVersion: string;
  serverRelease: string;
  generatedAt: string;
  timezone: "Africa/Abidjan";
  identity: {
    userId: string;
    displayName: string;
    role: CurrentUser["role"];
  };
  safeguards: {
    serviceRoleAllowed: false;
    arbitrarySqlAllowed: false;
    systemChangesAllowed: false;
    screenshotWritesRequireConfirmation: true;
    batchWritesRequireConfirmation: true;
  };
  actions: Array<{
    name: string;
    domain: string;
    description: string;
    risk: string;
    write: boolean;
    availability: "implemented" | "planned";
    authorized: boolean;
    authorizationSource: "role" | "explicit_grant" | "none";
    naturalLanguageDecision: "execute" | "confirm" | "block_and_report";
  }>;
}

export interface DatabaseOperatorCapability {
  action_name: string;
  authorized: boolean;
  authorization_source: "role" | "explicit_grant" | "none";
}

export function isDatabaseOperatorCapabilityList(value: unknown): value is DatabaseOperatorCapability[] {
  if (!Array.isArray(value)) return false;
  const names = new Set<string>();
  return value.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.action_name !== "string" || !row.action_name.trim()
      || typeof row.authorized !== "boolean"
      || !["role", "explicit_grant", "none"].includes(row.authorization_source)
      || (row.authorized && row.authorization_source === "none")
      || (!row.authorized && row.authorization_source !== "none")
      || names.has(row.action_name)) return false;
    names.add(row.action_name);
    return true;
  });
}

function cleanRelease(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "local-development";
  return trimmed.slice(0, 80);
}

/**
 * Public, secret-free protocol metadata for a logged-in operator connector.
 * The manifest describes supported actions; it is not an authorization token.
 */
export function buildOperatorProtocolManifest(input: {
  user: CurrentUser;
  serverRelease?: string;
  now?: Date;
  databaseCapabilities?: DatabaseOperatorCapability[];
}): OperatorProtocolManifest {
  const now = input.now ?? new Date();
  const databaseCapabilities = new Map(
    (input.databaseCapabilities ?? []).map((capability) => [capability.action_name, capability]),
  );
  return {
    protocolVersion: SACSI_OPERATOR_PROTOCOL_VERSION,
    minimumConnectorVersion: SACSI_OPERATOR_MIN_CONNECTOR_VERSION,
    serverRelease: cleanRelease(input.serverRelease),
    generatedAt: now.toISOString(),
    timezone: "Africa/Abidjan",
    identity: {
      userId: input.user.id,
      displayName: input.user.displayName,
      role: input.user.role,
    },
    safeguards: {
      serviceRoleAllowed: false,
      arbitrarySqlAllowed: false,
      systemChangesAllowed: false,
      screenshotWritesRequireConfirmation: true,
      batchWritesRequireConfirmation: true,
    },
    actions: BUSINESS_ACTIONS.map((action) => {
      const databaseCapability = databaseCapabilities.get(action.name);
      return {
        name: action.name,
        domain: action.domain,
        description: action.description,
        risk: action.risk,
        write: action.write,
        availability: IMPLEMENTED_OPERATOR_ACTIONS.has(action.name) ? "implemented" : "planned",
        // Page roles are descriptive, not a fallback for missing live grants.
        authorized: databaseCapability?.authorized === true,
        authorizationSource: databaseCapability?.authorization_source ?? "none",
        naturalLanguageDecision: decideOperatorExecution({
          actionName: action.name,
          inputSource: "natural_language",
        }).decision,
      };
    }),
  };
}
