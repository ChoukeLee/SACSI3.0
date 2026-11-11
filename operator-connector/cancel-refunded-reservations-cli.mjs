import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const endpoint = "booking-cancellations";

try {
  const [mode, filename] = process.argv.slice(2);
  if (!["status", "execute"].includes(mode) || !filename) {
    throw new Error("usage_status_or_execute_request_file");
  }
  const path = resolve(filename);
  const raw = readFileSync(path, "utf8");
  if (Buffer.byteLength(raw) > 8192) throw new Error("request_too_large");
  const request = JSON.parse(raw);
  if (!uuid.test(request?.requestId ?? "")) throw new Error("invalid_request_id");

  const installed = join(
    homedir(),
    "Library",
    "Application Support",
    "SACSI",
    "connector-0.8.0-mac-checkout-revision",
  );
  const { runtime } = await import(pathToFileURL(join(installed, "runtime.mjs")));
  const { client, store } = runtime();
  const result = await store.lock(async () => {
    const caps = await client.capabilities();
    if (caps.identity?.role !== "admin") throw new Error("operationForbidden");

    const status = await client.api(
      `${endpoint}?requestId=${encodeURIComponent(request.requestId)}`,
    );
    if (status?.requestId !== request.requestId) throw new Error("invalid_cancellation_status");
    if (mode === "status" || status.status === "completed_previously") return status;
    if (status.status !== "not_found") throw new Error("check_original_request_status");

    if (
      !Array.isArray(request.bookingIds) ||
      !request.bookingIds.length ||
      request.bookingIds.length > 20 ||
      !request.bookingIds.every((id) => typeof id === "string" && uuid.test(id)) ||
      new Set(request.bookingIds.map((id) => id.toLowerCase())).size !==
        request.bookingIds.length ||
      !Number.isSafeInteger(request.amountEachXof) ||
      request.amountEachXof <= 0 ||
      request.amountEachXof > 999999999999 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(request.refundDate ?? "") ||
      !["cash", "check", "bank_transfer", "other"].includes(request.paymentMethod)
    ) {
      throw new Error("operationInvalidRequest");
    }

    // Leave a durable marker before sending. A second invocation checks status only.
    const statePath = path + ".submitted";
    writeFileSync(statePath, request.requestId + "\n", { flag: "wx", mode: 0o600, flush: true });
    const reply = await client.api(endpoint, request);
    if (
      reply?.requestId !== request.requestId ||
      reply.status !== "completed" ||
      reply.verified !== true ||
      !Array.isArray(reply.items) ||
      reply.items.length !== request.bookingIds.length ||
      !request.bookingIds.every((id) =>
        reply.items.some(
          (item) =>
            item.bookingId === id.toLowerCase() &&
            item.refundXof === request.amountEachXof &&
            uuid.test(item.paymentId ?? ""),
        ),
      )
    ) {
      throw new Error("check_original_request_status");
    }
    return reply;
  });
  console.log(JSON.stringify(result));
} catch (error) {
  const code = /^[a-zA-Z0-9_]{1,120}$/.test(error?.message ?? "")
    ? error.message
    : "cancellation_failed_check_original_request";
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 1;
}
