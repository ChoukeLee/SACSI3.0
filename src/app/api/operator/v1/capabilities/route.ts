import { NextResponse } from "next/server";
import { BOOKING_OPERATION_ACTIONS as bookingOperationActions } from "@/features/business-actions/booking-operation-contract";
import {
  buildOperatorProtocolManifest,
  isDatabaseOperatorCapabilityList,
  type OperatorDirectWorkflow,
} from "@/features/business-actions/operator-protocol";
import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { confirmationsEnabled } from "@/features/business-actions/operator-confirmation-http";
import { directExecutionEnabled } from "@/features/business-actions/operator-direct-execution";

export async function GET(request: Request) {
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  let data: unknown;
  try {
    const result = await auth.supabase.rpc("get_my_operator_capabilities");
    if (!result.error) data = result.data;
  } catch {
    // Never expose transport diagnostics or substitute static role grants.
  }
  if (!isDatabaseOperatorCapabilityList(data)) {
    return NextResponse.json(
      {
        error: "Operator capabilities unavailable",
        code: "operator_capabilities_unavailable",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let collectionAvailable = false;
  try {
    const version = await auth.supabase.rpc("operator_collection_protocol_version");
    collectionAvailable = confirmationsEnabled() && !version.error && version.data === 1;
  } catch {
    /* Older databases have no collection workflow. */
  }
  let dailyExecutionAvailable = false;
  try {
    const version = await auth.supabase.rpc("daily_workflow_protocol_version");
    dailyExecutionAvailable = confirmationsEnabled() && !version.error && version.data === 1;
  } catch {
    /* Unpublished database workflow must remain unavailable. */
  }
  let bookingOperationsAvailable = false;
  try {
    const version = await auth.supabase.rpc("booking_operations_protocol_version");
    bookingOperationsAvailable = confirmationsEnabled() && !version.error && version.data === 1;
  } catch {
    /* No published migration means no new write surface. */
  }
  let checkoutCorrectionInstalled = false;
  let settledOpenDiscountInstalled = false;
  let settledPriceInstalled = false;
  if (bookingOperationsAvailable && auth.user.role === "admin") {
    try {
      const version = await auth.supabase.rpc("booking_checkout_correction_protocol_version");
      checkoutCorrectionInstalled = !version.error && version.data === 1;
      if (checkoutCorrectionInstalled) {
        const [openVersion, priceVersion] = await Promise.all([
          auth.supabase.rpc("booking_open_checkout_discount_protocol_version"),
          auth.supabase.rpc("booking_checkout_settled_price_protocol_version"),
        ]);
        settledOpenDiscountInstalled = !openVersion.error && openVersion.data === 1;
        settledPriceInstalled = !priceVersion.error && priceVersion.data === 1;
      }
    } catch {
      /* Old databases must not advertise historical corrections. */
    }
  }
  const directWorkflows: OperatorDirectWorkflow[] = [];
  let nativeCollectionAvailable = false;
  let cimacMaintenanceAvailable = false;
  if (directExecutionEnabled()) {
    if (auth.user.role === "admin") {
      try {
        const [version, allowed] = await Promise.all([
          auth.supabase.rpc("cimac_maintenance_protocol_version"),
          auth.supabase.rpc("can_execute_cimac_maintenance"),
        ]);
        cimacMaintenanceAvailable =
          !version.error && version.data === 1 && !allowed.error && allowed.data === true;
        if (cimacMaintenanceAvailable) directWorkflows.push("cimac_maintenance");
      } catch {
        /* Maintenance stays unavailable until the admin-only transaction is ready. */
      }
    }
    try {
      const [version, allowed] = await Promise.all([
        auth.supabase.rpc("operator_native_collection_protocol_version"),
        auth.supabase.rpc("can_execute_operator_native_collection"),
      ]);
      nativeCollectionAvailable =
        !version.error && version.data === 1 && !allowed.error && allowed.data === true;
      if (nativeCollectionAvailable) directWorkflows.push("native_collection");
    } catch {
      /* No native write capability until the audited transaction is installed. */
    }
    if (collectionAvailable) directWorkflows.push("collection");
    if (dailyExecutionAvailable) directWorkflows.push("daily_workflow");
    if (bookingOperationsAvailable) directWorkflows.push("booking_operation");
    try {
      const [payment, directPayment] = await Promise.all([
        auth.supabase.rpc("operator_daily_payment_protocol_version"),
        auth.supabase.rpc("operator_direct_payment_protocol_version"),
      ]);
      if (!payment.error && payment.data === 2 && !directPayment.error && directPayment.data === 1)
        directWorkflows.push("daily_payment");
    } catch {
      /* Direct payments need truthful audit metadata before first write. */
    }
  }
  const manifest = buildOperatorProtocolManifest({
    user: auth.user,
    databaseCapabilities: data,
    directWorkflows,
    serverRelease:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_APP_VERSION ??
      "local-development",
  });
  const checkoutCorrectionAvailable =
    checkoutCorrectionInstalled &&
    manifest.actions.some((action) => action.name === "correct_daily_booking" && action.authorized);
  const availableBookingOperations = (operations: readonly string[]) =>
    operations.filter(
      (operation) => operation !== "correct_checkout" || checkoutCorrectionAvailable,
    );
  const directBooking = directWorkflows.includes("booking_operation");
  const directCollection = directWorkflows.includes("collection");
  const collectionActions = new Set([
    "record_daily_payment",
    "record_lease_rent",
    "record_property_fee",
    "record_combined_lease_payment",
    "record_lease_deposit",
    "record_sale_payment",
  ]);
  const actions = manifest.actions.map((action) => {
    if (bookingOperationsAvailable && bookingOperationActions[action.name])
      return {
        ...action,
        availability: "implemented",
        entryPoint: "booking_operations",
        supportedOperations: availableBookingOperations(bookingOperationActions[action.name]),
        confirmationRequired: !directBooking,
        ...(directBooking ? { naturalLanguageDecision: "execute" as const } : {}),
      };
    if (collectionAvailable && collectionActions.has(action.name))
      return {
        ...action,
        availability: "implemented",
        entryPoint: "collection",
        confirmationRequired: !directCollection,
        ...(directCollection ? { naturalLanguageDecision: "execute" as const } : {}),
      };
    return action;
  });
  return NextResponse.json(
    {
      ...manifest,
      actions,
      bookingOperations: {
        available: bookingOperationsAvailable,
        version: 1,
        confirmationRequired: !directBooking,
        operations: availableBookingOperations(Object.values(bookingOperationActions).flat()),
        checkoutCorrection: {
          available: checkoutCorrectionAvailable,
          version: 1,
          settledOpenDiscountAvailable: checkoutCorrectionAvailable && settledOpenDiscountInstalled,
          settledPriceAvailable: checkoutCorrectionAvailable && settledPriceInstalled,
        },
      },
      dailyWorkflow: {
        version: 1,
        readOnlyPlanning: true,
        executionAvailable: dailyExecutionAvailable,
        confirmationRequired: !directWorkflows.includes("daily_workflow"),
      },
      collectionWorkflow: {
        available: collectionAvailable,
        version: 1,
        domains: ["daily", "lease", "sale"],
        maximumRows: 30,
        maximumAllocations: 100,
        confirmationRequired: !directCollection,
      },
      nativeCollectionWorkflow: {
        available: nativeCollectionAvailable,
        version: 1,
        domain: "lease",
        currencies: ["USD", "CNY"],
        nativeOnly: true,
        maximumAllocations: 100,
        confirmationRequired: false,
        automaticConversion: false,
        paidThroughUpdate: "explicit_coverage_only",
      },
      cimacMaintenanceWorkflow: {
        available: cimacMaintenanceAvailable,
        version: 1,
        project: "CIMAC",
        adminOnly: true,
        maximumOperations: 30,
        confirmationRequired: false,
        arbitrarySqlAllowed: false,
        refundMeaning: "record_already_completed_refund_only",
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-SACSI-Auth-Mode": auth.mode,
      },
    },
  );
}
