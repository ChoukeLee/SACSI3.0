import "server-only";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { CurrencyCode } from "@/types/domain";
import { isAssetDate, type AssetOperationsData } from "./asset-operations-model";
import {
  isConfirmedExcelSource,
  type OperatingAssetBillingGroup,
  type OperatingAssetLeaseEvidence,
  type OperatingAssetLeaseGroup,
  type OperatingAssetReferenceRent,
  type OperatingAssetTenantEvidence,
} from "./operating-asset-directory-model";

type AssetSourceIdentity = {
  id: string;
  source_key: string;
  lease?: { evidence: unknown; reviewed_on: unknown } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readAmount(value: unknown): {
  amountNative: number;
  currency: CurrencyCode;
  sourceRef: string;
} {
  if (!isRecord(value)) throw new Error("AssetOperationsReadUnavailable");
  const { amountNative, currency, sourceRef } = value;
  if (
    typeof amountNative !== "number" ||
    !Number.isFinite(amountNative) ||
    amountNative <= 0 ||
    !Number.isSafeInteger(Math.round(amountNative * 100)) ||
    (currency !== "XOF" && currency !== "CNY" && currency !== "USD") ||
    !isText(sourceRef)
  )
    throw new Error("AssetOperationsReadUnavailable");
  return { amountNative, currency, sourceRef };
}

function readRent(value: unknown): OperatingAssetReferenceRent {
  if (!isRecord(value)) throw new Error("AssetOperationsReadUnavailable");
  const { period, effectiveFrom, effectiveThrough } = value;
  if (
    (period !== "month" && period !== "quarter" && period !== "year") ||
    (effectiveFrom != null && !isAssetDate(effectiveFrom)) ||
    (effectiveThrough != null && !isAssetDate(effectiveThrough)) ||
    (effectiveFrom != null && effectiveThrough != null && effectiveThrough < effectiveFrom)
  )
    throw new Error("AssetOperationsReadUnavailable");
  return {
    ...readAmount(value),
    period,
    effectiveFrom: effectiveFrom ?? undefined,
    effectiveThrough: effectiveThrough ?? undefined,
  };
}

function readBillingGroup(value: unknown): OperatingAssetBillingGroup | undefined {
  if (!isRecord(value)) return undefined;
  const { primarySourceKey, label, monthlyRent } = value;
  if (!isText(primarySourceKey) || !isText(label)) return undefined;
  try {
    const rent = readRent(monthlyRent);
    if (rent.period === "month") {
      return { primarySourceKey: primarySourceKey.trim(), label: label.trim(), monthlyRent: rent };
    }
  } catch {
    // Optional billing metadata must not prevent ordinary asset reads.
  }
  return undefined;
}

// The numbered variants in these two sheets distinguish units held by one tenant.
const oldWarehouseTenantAliases = new Map([
  ["宋留成1", "宋留成"],
  ["宋留成2", "宋留成"],
  ["宋留成3", "宋留成"],
  ["宋留成4", "宋留成"],
  ["宋留成5", "宋留成"],
  ["宋留成6", "宋留成"],
  ["谢立新Niang2", "谢立新Niang"],
  ["谢立新Niang3", "谢立新Niang"],
  ["小庄1", "小庄"],
  ["小庄2", "小庄"],
  ["小庄3", "小庄"],
]);
const newWarehouseTenantAliases = new Map([
  ["孙章阳1", "孙章阳"],
  ["孙章阳2", "孙章阳"],
]);

function readTenantEvidence(value: unknown): OperatingAssetTenantEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const { names, sourceRef, classification, scope, asOfSourceDate } = value;
  if (
    !Array.isArray(names) ||
    !names.length ||
    !names.every(isText) ||
    !isText(sourceRef) ||
    (classification !== "latest_source" && classification !== "historical") ||
    (scope !== "asset" && scope !== "group") ||
    (asOfSourceDate != null && !isAssetDate(asOfSourceDate))
  )
    return undefined;
  const sourceNames = names.map((name) => name.trim());
  const aliases = isConfirmedExcelSource(sourceRef)
    ? /\|sheet:老仓库(?:等)?\|/.test(sourceRef)
      ? oldWarehouseTenantAliases
      : /\|sheet:新仓库\|/.test(sourceRef)
        ? newWarehouseTenantAliases
        : undefined
    : undefined;
  const displayNames = sourceNames.some((name) => aliases?.has(name))
    ? [...new Set(sourceNames.map((name) => aliases?.get(name) ?? name))]
    : undefined;
  return {
    names: sourceNames,
    displayNames,
    sourceRef,
    classification,
    scope,
    asOfSourceDate: asOfSourceDate ?? undefined,
  };
}

function readLeaseGroups(value: unknown): OperatingAssetLeaseGroup[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const groups: OperatingAssetLeaseGroup[] = [];
  const keys = new Set<string>();
  for (const group of value) {
    if (!isRecord(group)) return undefined;
    const {
      key,
      label,
      sourceRef,
      receiptSourceRef,
      receiptSourceRefs,
      warehouseSourceKey,
      paidRoomCount,
      notes,
    } = group;
    if (
      !isText(key) ||
      keys.has(key) ||
      !isText(label) ||
      !isText(sourceRef) ||
      !isText(receiptSourceRef) ||
      (receiptSourceRefs != null &&
        (!Array.isArray(receiptSourceRefs) || !receiptSourceRefs.every(isText))) ||
      (warehouseSourceKey != null && !isText(warehouseSourceKey)) ||
      (paidRoomCount != null &&
        (typeof paidRoomCount !== "number" ||
          !Number.isSafeInteger(paidRoomCount) ||
          paidRoomCount <= 0)) ||
      (notes != null && (!Array.isArray(notes) || !notes.every(isText)))
    )
      return undefined;
    keys.add(key);
    groups.push({
      key,
      label,
      sourceRef,
      receiptSourceRef,
      receiptSourceRefs: receiptSourceRefs ?? undefined,
      tenantEvidence: readTenantEvidence(group.tenantEvidence),
      warehouseSourceKey: warehouseSourceKey ?? undefined,
      paidRoomCount: paidRoomCount ?? undefined,
      notes: notes ?? undefined,
    });
  }
  return groups;
}

function readLeaseEvidence(value: unknown, reviewedOn: unknown): OperatingAssetLeaseEvidence {
  if (!isRecord(value) || !isAssetDate(reviewedOn))
    throw new Error("AssetOperationsReadUnavailable");
  const { assetSourceRef, referenceRent, rates, paidThrough, nextPayment, outstanding, notes } =
    value;
  if (
    !isText(assetSourceRef) ||
    (rates != null && !Array.isArray(rates)) ||
    (notes != null && (!Array.isArray(notes) || !notes.every(isText)))
  )
    throw new Error("AssetOperationsReadUnavailable");
  const evidence: OperatingAssetLeaseEvidence = {
    assetSourceRef,
    reviewedOn,
    referenceRent: referenceRent == null ? undefined : readRent(referenceRent),
    rates: rates?.map(readRent),
    outstanding: outstanding == null ? undefined : readAmount(outstanding),
    tenantEvidence: readTenantEvidence(value.tenantEvidence),
    billingGroup: readBillingGroup(value.billingGroup),
    leaseGroups: readLeaseGroups(value.leaseGroups),
    notes: notes ?? undefined,
    leaseListed: value.leaseListed === true,
    selfUse: value.selfUse === true,
    blockReceiptCutoff: value.blockReceiptCutoff === true,
  };
  if (paidThrough != null) {
    if (!isRecord(paidThrough) || !isAssetDate(paidThrough.date) || !isText(paidThrough.sourceRef))
      throw new Error("AssetOperationsReadUnavailable");
    evidence.paidThrough = { date: paidThrough.date, sourceRef: paidThrough.sourceRef };
  }
  if (nextPayment != null) {
    if (
      !isRecord(nextPayment) ||
      !isAssetDate(nextPayment.dueDate) ||
      !isText(nextPayment.sourceRef)
    )
      throw new Error("AssetOperationsReadUnavailable");
    evidence.nextPayment = {
      dueDate: nextPayment.dueDate,
      sourceRef: nextPayment.sourceRef,
      unpaid: typeof nextPayment.unpaid === "boolean" ? nextPayment.unpaid : undefined,
    };
  }
  return evidence;
}

export async function fetchAssetOperations(
  input: { projectId?: string; includeLeaseEvidence?: boolean } = {},
): Promise<
  AssetOperationsData & {
    leaseEvidence?: Readonly<Record<string, OperatingAssetLeaseEvidence>>;
  }
> {
  await requireRole("admin", "boss", "finance");
  const supabase = await createClient();
  let projectId = input.projectId;
  if (!projectId) {
    const project = await supabase.from("projects").select("id").eq("code", "SACSI").single();
    if (project.error || !project.data?.id) throw new Error("AssetOperationsProjectUnavailable");
    projectId = project.data.id as string;
  }
  const result = await supabase.rpc("asset_operations_read_rpc", { p_project_id: projectId });
  if (result.error) {
    if (result.error.code === "PGRST202" || result.error.code === "42883")
      throw new Error("AssetOperationsMigrationRequired");
    throw new Error("AssetOperationsReadUnavailable");
  }
  if (
    !result.data ||
    result.data.projectId !== projectId ||
    !Array.isArray(result.data.assets) ||
    !Array.isArray(result.data.entries) ||
    typeof result.data.canWrite !== "boolean"
  )
    throw new Error("AssetOperationsReadUnavailable");
  const sourceColumns = input.includeLeaseEvidence
    ? "id,source_key,lease:asset_operation_lease_evidence(evidence,reviewed_on)"
    : "id,source_key";
  const sourceKeys = await fetchAllPages<AssetSourceIdentity>(
    (from, to) =>
      supabase
        .from("asset_operation_assets")
        .select(sourceColumns, { count: "exact" })
        .eq("project_id", projectId)
        .order("id")
        .range(from, to)
        .overrideTypes<AssetSourceIdentity[], { merge: false }>(),
    "asset operation source identities",
  ).catch((error: unknown) => {
    if (!input.includeLeaseEvidence) throw error;
    throw new Error("AssetOperationsReadUnavailable", { cause: error });
  });
  const keys = new Map(sourceKeys.map((row) => [row.id, row.source_key]));
  const data = result.data as AssetOperationsData;
  if (data.assets.some((asset) => !keys.has(asset.id)))
    throw new Error("AssetOperationsReadUnavailable");
  const leaseEvidence = input.includeLeaseEvidence
    ? Object.fromEntries(
        sourceKeys.flatMap(({ source_key, lease }) =>
          lease ? [[source_key, readLeaseEvidence(lease.evidence, lease.reviewed_on)]] : [],
        ),
      )
    : undefined;
  return {
    ...data,
    assets: data.assets.map((asset) => ({ ...asset, sourceKey: keys.get(asset.id)! })),
    ...(leaseEvidence ? { leaseEvidence } : {}),
  };
}
