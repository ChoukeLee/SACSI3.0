#!/usr/bin/env node
/**
 * Static checks for SACIS daily rental business rules.
 *
 * This script does not connect to the database. It guards source-code
 * invariants that are easy to break during UI or server-action edits.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const features = join(root, "src", "features", "daily-rentals");
const errors = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function fail(message) {
  errors.push(message);
  console.error(`  FAIL: ${message}`);
}

function pass(message) {
  console.log(`  OK: ${message}`);
}

function check(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function functionSection(source, name) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("\nexport async function ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function hasCall(source, name) {
  return new RegExp(`\\b${name}\\s*\\(`).test(source);
}

const actions = read(join(features, "actions.ts"));
const policy = read(join(features, "daily-rental-policy.ts"));
const audit = read(join(features, "daily-rental-audit.ts"));
const repair = read(join(features, "daily-rental-repair.ts"));
const bookingPanel = read(join(features, "booking-panel.tsx"));
const atomicCreateMigration = read(join(root, "supabase", "migrations", "202607280001_atomic_daily_booking_create.sql"));
const atomicFinanceMigration = read(join(root, "supabase", "migrations", "202607290001_atomic_daily_finance_operations.sql"));

const createBookingBody = functionSection(actions, "createBooking");
const createBackfillBody = functionSection(actions, "createBackfillBooking");
const checkInBody = functionSection(actions, "checkIn");
const recordPaymentBody = functionSection(actions, "recordSupplementaryPayment");
const reversePaymentBody = functionSection(actions, "reversePayment");
const checkOutBody = functionSection(actions, "checkOut");
const extendStayBody = functionSection(actions, "extendStay");
const cancelBookingBody = functionSection(actions, "cancelBooking");

check(createBookingBody.includes('rpc("daily_create_booking_rpc"'), "createBooking uses the atomic database RPC");
check(createBookingBody.includes("p_request_id: input.requestId"), "createBooking sends an idempotency request id");
check(!createBookingBody.includes('.from("daily_bookings").insert'), "createBooking does not insert bookings outside the transaction");
check(atomicCreateMigration.includes("for update"), "atomic create RPC locks the room before conflict checks");
check(atomicCreateMigration.includes("creation_request_id"), "atomic create RPC enforces request idempotency");
check(atomicCreateMigration.includes("insert into public.receivables"), "atomic create RPC creates the receivable");
check(atomicCreateMigration.includes("insert into public.audit_logs"), "atomic create RPC writes the audit log");
check(!bookingPanel.includes("optimistic-booking-"), "new booking UI does not render an uncommitted booking");
check(bookingPanel.includes("closeOnSuccess: true"), "new booking panel closes only after server success");
check(hasCall(createBackfillBody, "requireRole") && createBackfillBody.includes("admin"), "createBackfillBooking requires admin");
check(createBackfillBody.includes("backfillMustBePastDate"), "createBackfillBooking blocks non-past check-in");
check(!/from\(["']units["']\)\s*\.update/.test(createBackfillBody), "createBackfillBooking does not update units.status");
check(createBackfillBody.includes("[\u5386\u53f2\u8865\u5f55]"), "createBackfillBooking prefixes notes with [historical backfill]");

check(checkInBody.includes('rpc("daily_check_in_booking_rpc"'), "checkIn uses the atomic database RPC");
check(recordPaymentBody.includes('rpc("daily_record_payment_rpc"'), "supplementary payment uses the atomic database RPC");
check(recordPaymentBody.includes("p_request_id: input.requestId"), "supplementary payment sends an idempotency request id");
check(reversePaymentBody.includes('rpc("daily_reverse_payment_rpc"'), "payment correction uses a reversal RPC");
check(reversePaymentBody.includes("p_reason: input.reason"), "payment reversal requires a reason");
check(!actions.includes('.from("payments").delete'), "daily actions never physically delete payment records");
check(checkOutBody.includes('rpc("daily_check_out_booking_rpc"'), "check-out uses the atomic database RPC");
check(extendStayBody.includes('rpc("daily_extend_stay_rpc"'), "stay extension uses the atomic database RPC");
check(extendStayBody.includes("p_request_id: requestId"), "stay extension sends an idempotency request id");
check(cancelBookingBody.includes('rpc("daily_cancel_booking_rpc"'), "cancellation uses the atomic database RPC");

check(atomicFinanceMigration.includes("where request_id = p_request_id"), "daily payment RPCs reuse the global payment idempotency key");
check(atomicFinanceMigration.includes("requestIdConflict"), "daily finance RPCs reject request id conflicts");
check(atomicFinanceMigration.includes("paymentExceedsOutstanding"), "daily finance RPCs reject overpayment");
check(atomicFinanceMigration.includes("reversal_of_payment_id"), "payment reversal retains a link to the original payment");
check(atomicFinanceMigration.includes("reversalReasonRequired"), "payment reversal requires a reason in the database");
check(!atomicFinanceMigration.includes("delete from public.payments"), "daily finance migration never deletes payment history");
check(atomicFinanceMigration.includes("checkoutMustCreateCleaning"), "check-out always creates a cleaning state");
check(atomicFinanceMigration.includes("daily_operation_requests"), "non-payment additive operations have idempotency records");
check(atomicFinanceMigration.includes("if v_paid <> 0 then raise exception 'bookingHasPayments'"), "paid bookings cannot be directly cancelled");

check(policy.includes("export function allowCreateBooking"), "daily-rental-policy exports allowCreateBooking");
check(policy.includes("export function allowCheckIn"), "daily-rental-policy exports allowCheckIn");
check(policy.includes("export function getPrimaryDailyAction"), "daily-rental-policy exports getPrimaryDailyAction");
check(policy.includes("pastDateNotAllowed"), "daily-rental-policy blocks normal past-date booking");
check(policy.includes("cleaningPending"), "daily-rental-policy blocks check-in while cleaning is pending");

check(hasCall(repair, "requireRole") && repair.includes("admin"), "daily-rental-repair requires admin");
check(repair.includes("syncBookingFinance"), "daily-rental-repair can resync daily rental finance");
check(repair.includes("daily_occupied") && repair.includes("reserved") && repair.includes("available"), "daily-rental-repair derives unit status from active booking state");

check(audit.includes("[\u5386\u53f2\u8865\u5f55]"), "daily-rental-audit detects historical backfill notes");
check(audit.includes("fixable") && audit.includes("repairEntityId"), "daily-rental-audit marks fixable issues for repair UI");
check(!/booking=\$\{/.test(actions), "ledger descriptions do not expose booking UUID");

console.log("");
if (errors.length > 0) {
  console.error(`${errors.length} daily rental rule check(s) failed.`);
  process.exit(1);
}

console.log("Daily rental rule checks passed.");
