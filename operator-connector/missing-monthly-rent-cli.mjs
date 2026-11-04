import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { MissingMonthlyRentClient, parseMissingMonthlyRent } from "./missing-monthly-rent.mjs";

// Reuse the signed-in, integrity-checked Mac connector and its existing lock,
// Keychain encryption and refresh flow. Never export authentication material.
const installed = join(
  homedir(),
  "Library",
  "Application Support",
  "SACSI",
  "connector-0.8.0-mac-checkout-revision",
);
const read = (p) => {
  const raw = readFileSync(p, "utf8");
  if (Buffer.byteLength(raw) > 65536) throw new Error("input_too_large");
  return JSON.parse(raw);
};
const write = (p, v, exclusive = false) =>
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n", {
    mode: 0o600,
    flag: exclusive ? "wx" : "w",
  });
try {
  const [mode, provided] = process.argv.slice(2);
  if (!["prepare", "execute", "status"].includes(mode) || !provided)
    throw new Error("usage_prepare_execute_status_request_file");
  const requestFile = resolve(provided),
    preparedFile = requestFile + ".prepared.json",
    stateFile = requestFile + ".state.json";
  const { runtime } = await import(pathToFileURL(join(installed, "runtime.mjs")));
  const { OperatorClient } = await import(pathToFileURL(join(installed, "core.mjs")));
  const { config, store } = runtime();
  const result = await store.lock(async () => {
    const client = new MissingMonthlyRentClient(new OperatorClient(config, store));
    const request = parseMissingMonthlyRent(read(requestFile));
    if (mode === "prepare") {
      if (existsSync(preparedFile) || existsSync(stateFile))
        throw new Error("original_prepared_request_exists_use_status");
      const prepared = await client.prepare(request);
      write(preparedFile, prepared, true);
      write(stateFile, { requestId: request.requestId, status: "prepared" }, true);
      return {
        status: "prepared",
        requestId: request.requestId,
        actorId: prepared.actorId,
        request,
        priorPaidThroughDate: prepared.review.contract.paid_through_date,
        historicalCoverageWillRemainUnchanged: true,
        preparedFile,
      };
    }
    const prepared = read(preparedFile);
    if (JSON.stringify(prepared.request) !== JSON.stringify(request))
      throw new Error("original_prepared_request_changed");
    if (mode === "status") {
      const current = await client.status(prepared);
      if (current.status === "completed") write(stateFile, current);
      return current;
    }
    const state = read(stateFile);
    if (state.status === "completed")
      return { ...(await client.status(prepared)), status: "completed_previously" };
    if (state.status !== "prepared")
      throw new Error("outcome_unknown_use_original_status_do_not_replay");
    // Persist uncertainty BEFORE sending; process exit or a broken response may
    // hide a commit. The next invocation can only read the original status.
    write(stateFile, { requestId: request.requestId, status: "submitting_outcome_unknown" });
    const completed = await client.execute(prepared);
    write(stateFile, completed);
    return completed;
  });
  console.log(JSON.stringify(result));
} catch (error) {
  const code = /^[a-zA-Z0-9_]{1,120}$/.test(error?.message ?? "")
    ? error.message
    : "missing_rent_failed_keep_original_request_id";
  console.error(
    JSON.stringify({ error: code, notice: "结果未明请按原请求号查询，不要换号或删除待办。" }),
  );
  process.exitCode = 1;
}
