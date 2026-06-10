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

const createBookingBody = functionSection(actions, "createBooking");
const createBackfillBody = functionSection(actions, "createBackfillBooking");
const checkInBody = functionSection(actions, "checkIn");
const deletePaymentBody = functionSection(actions, "deletePayment");
const cancelBookingBody = functionSection(actions, "cancelBooking");

check(actions.includes("allowCreateBooking"), "actions.ts imports allowCreateBooking");
check(actions.includes("allowCheckIn"), "actions.ts imports allowCheckIn");
check(actions.includes("syncBookingFinance"), "actions.ts imports syncBookingFinance");
check(actions.includes("insertLedgerEntry"), "actions.ts imports insertLedgerEntry");
check(actions.includes("reverseLedgerEntriesForPayment"), "actions.ts imports reverseLedgerEntriesForPayment");

check(hasCall(createBookingBody, "allowCreateBooking"), "createBooking calls allowCreateBooking");
check(hasCall(createBackfillBody, "requireRole") && createBackfillBody.includes("admin"), "createBackfillBooking requires admin");
check(createBackfillBody.includes("backfillMustBePastDate"), "createBackfillBooking blocks non-past check-in");
check(!/from\(["']units["']\)\s*\.update/.test(createBackfillBody), "createBackfillBooking does not update units.status");
check(createBackfillBody.includes("[\u5386\u53f2\u8865\u5f55]"), "createBackfillBooking prefixes notes with [historical backfill]");

check(hasCall(checkInBody, "allowCheckIn"), "checkIn calls allowCheckIn");
check(checkInBody.includes("cleaning_tasks") || checkInBody.includes("hasOpenCleaningTask"), "checkIn checks open cleaning tasks");
check(checkInBody.includes("otherCheckedIn") || checkInBody.includes("otherCheckedInCount"), "checkIn checks other checked-in bookings");
check(checkInBody.includes("syncBookingFinance"), "checkIn syncs booking finance after payment changes");

check(deletePaymentBody.includes("reverseLedgerEntriesForPayment"), "deletePayment reverses ledger entries");
check(deletePaymentBody.includes("syncBookingFinance"), "deletePayment syncs booking finance");
check(cancelBookingBody.includes("cancelReceivablesForSource"), "cancelBooking cancels receivables");
check(cancelBookingBody.includes("reverseLedgerEntriesForPayment"), "cancelBooking reverses payment ledger entries");

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
