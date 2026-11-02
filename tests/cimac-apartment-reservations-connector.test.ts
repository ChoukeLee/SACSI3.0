import { afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
// @ts-expect-error Standalone connector intentionally has no app dependency.
import { OperatorClient, VERSION, checkManifest } from "../operator-connector/core.mjs";
// @ts-expect-error Standalone connector intentionally has no app dependency.
import * as wire from "../operator-connector/apartment-reservations.mjs";
// @ts-expect-error Standalone connector intentionally has no app dependency.
import { durableClient } from "../operator-connector/pending-client.mjs";
// @ts-expect-error Standalone connector intentionally has no app dependency.
import { pendingStore } from "../operator-connector/pending-store.mjs";
// @ts-expect-error Standalone connector intentionally has no app dependency.
import { callTool, tools } from "../operator-connector/mcp-tools.mjs";
// @ts-expect-error Standalone connector intentionally has no app dependency.
import { humanError, humanResult } from "../operator-connector/human-output.mjs";
// @ts-expect-error Standalone package compiler.
import { packageFiles } from "../scripts/lib/operator-package.mjs";
// @ts-expect-error Standalone integrity verifier.
import { verifyPackage } from "../operator-connector/verify-package.mjs";
import { parseCimacApartmentReservationRequest } from "@/features/cimac/cimac-apartment-reservation-model";

const id = (number: number) => `ab000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const actor = id(1),
  project = id(2),
  building = id(3),
  unit = id(4),
  reservation = id(5),
  requestId = id(6);
const before = "2026-11-02T10:00:00.123456+00:00",
  after = "2026-11-02T11:00:00.123456+00:00";
const config = {
  formatVersion: 1,
  appUrl: "https://app.test",
  supabaseUrl: "https://auth.test",
  publishableKey: "sb_publishable_synthetic",
};
const session = {
  userId: actor,
  accessToken: "synthetic-token",
  expiresAt: Date.now() + 3600000,
  appUrl: config.appUrl,
  supabaseUrl: config.supabaseUrl,
};
const sessionStore = () => ({ load: async () => ({ ...session }) });
const request = (type = "reserve") => ({
  requestId,
  originalInstruction: "Explicitly register the synthetic unpaid apartment reservation.",
  operations: [
    {
      type,
      unitId: unit,
      expectedUnitUpdatedAt: before,
      expectedReservationId: type === "reserve" ? null : reservation,
      expectedReservationUpdatedAt: type === "reserve" ? null : before,
      reserverName: type === "cancel" ? null : "Synthetic reserver A",
      reason: "Synthetic explicit instruction",
    },
  ],
});
const query = (type = "reserve") => ({
  success: true,
  actorId: actor,
  projectId: project,
  buildingId: building,
  schemaAvailable: true,
  rooms: [
    {
      unitId: unit,
      unitNo: "201",
      unitUpdatedAt: before,
      reservation:
        type === "reserve"
          ? null
          : {
              id: reservation,
              reserverName: "Synthetic prior reserver",
              status: "reserved",
              paymentStatus: "unpaid",
              updatedAt: before,
            },
    },
  ],
});
const completed = (type = "reserve") => ({
  success: true,
  requestId,
  actorId: actor,
  projectId: project,
  buildingId: building,
  idempotent: false,
  rooms: [
    {
      unitId: unit,
      unitNo: "201",
      reservationId: reservation,
      status: type === "cancel" ? "cancelled" : "reserved",
      reserverName: type === "cancel" ? "Synthetic prior reserver" : "Synthetic reserver A",
      paymentStatus: "unpaid",
      updatedAt: after,
    },
  ],
});
const notFound = () => ({ requestId, status: "not_found", verified: false });
const history = (type = "reserve") => ({
  requestId,
  actorId: actor,
  status: "completed_previously",
  verified: false,
  request: request(type),
  result: completed(type),
});
const manifest = () => ({
  protocolVersion: "1.0",
  minimumConnectorVersion: "0.8.0",
  identity: { userId: actor, role: "admin" },
  actions: [],
  safeguards: {
    serviceRoleAllowed: false,
    arbitrarySqlAllowed: false,
    systemChangesAllowed: false,
    screenshotWritesRequireConfirmation: false,
    batchWritesRequireConfirmation: false,
  },
  directExecution: {
    available: true,
    version: 1,
    authorization: "explicit_instruction",
    workflows: ["daily_payment"],
  },
  cimacApartmentReservations: {
    available: true,
    version: 1,
    actions: ["reserve", "cancel", "correct_name"],
    minimumConnectorVersion: "0.9.0",
  },
});
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
function transportFor(
  result: unknown = completed(),
  snapshot: unknown = query(),
  prior: unknown = notFound(),
  capabilities: unknown = manifest(),
) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/capabilities")) return reply(capabilities);
    if (path.endsWith("/status")) return reply(prior);
    if (path.endsWith("/query")) return reply(snapshot);
    if (path.endsWith("/execute")) return reply(result);
    throw new Error("Unexpected synthetic endpoint");
  });
}
const directories: string[] = [];
function journal() {
  const directory = mkdtempSync(join(tmpdir(), "sacsi-apartment-connector-"));
  directories.push(directory);
  const key = Buffer.alloc(32, 17);
  const crypt = (value: string | Buffer, operation: string) => {
    if (operation === "protect") {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    }
    const bytes = Buffer.from(value),
      decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  };
  return { directory, crypt, value: pendingStore(directory, config.appUrl, crypt) };
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    expect(
      target.startsWith(resolve(tmpdir()) + sep) &&
        basename(target).startsWith("sacsi-apartment-connector-"),
    ).toBe(true);
    rmSync(target, { recursive: true, force: true });
  }
});

describe("dedicated B17 unpaid apartment reservation connector", () => {
  it.each(["reserve", "cancel", "correct_name"])(
    "shares the server's canonical request contract for %s",
    (type) => {
      expect(wire.normalizeApartmentReservationRequest(request(type))).toEqual(
        parseCimacApartmentReservationRequest(request(type)),
      );
    },
  );

  it("accepts exactly the full 64-room scope and rejects a 65th target before network", async () => {
    const input = request(),
      snapshot = query(),
      result = completed();
    input.operations = Array.from({ length: 64 }, (_, index) => ({
      ...request().operations[0],
      unitId: id(100 + index),
    }));
    snapshot.rooms = input.operations.map((op, index) => ({
      ...query().rooms[0],
      unitId: op.unitId,
      unitNo: String((2 + Math.floor(index / 16)) * 100 + (index % 16) + 1),
    }));
    result.rooms = snapshot.rooms.map((room, index) => ({
      ...completed().rooms[0],
      unitId: room.unitId,
      unitNo: room.unitNo,
      reservationId: id(200 + index),
    }));
    const transport = transportFor(result, snapshot);
    expect(
      await new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
        "execute",
        input,
      ),
    ).toMatchObject({ status: "completed", verified: true, rooms: result.rooms });
    input.operations.push({ ...request().operations[0], unitId: id(999) });
    const invalid = transportFor();
    await expect(
      new OperatorClient(config, sessionStore(), invalid).cimacApartmentReservations(
        "execute",
        input,
      ),
    ).rejects.toThrow("invalid_cimac_apartment_reservation_request");
    expect(invalid).not.toHaveBeenCalled();
  });
  it.each(["reserve", "cancel", "correct_name"])(
    "executes %s only after actor status and live CAS checks",
    async (type) => {
      const transport = transportFor(completed(type), query(type));
      const client = new OperatorClient(config, sessionStore(), transport);
      expect(await client.cimacApartmentReservations("execute", request(type))).toMatchObject({
        status: "completed",
        verified: true,
        actorId: actor,
        executionMode: "explicit_instruction",
      });
      expect(transport.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
        "/api/operator/v1/capabilities",
        "/api/operator/v1/cimac-apartment-reservations/status",
        "/api/operator/v1/cimac-apartment-reservations/query",
        "/api/operator/v1/cimac-apartment-reservations/execute",
      ]);
      const options = (transport.mock.calls as unknown as [string, RequestInit][])[3][1];
      expect(JSON.parse(String(options.body))).toEqual(request(type));
      expect(
        (transport.mock.calls as unknown as [string, RequestInit][]).every(
          ([, init]) =>
            (init.headers as Record<string, string>).Authorization === "Bearer synthetic-token",
        ),
      ).toBe(true);
      expect(
        transport.mock.calls.every(
          ([url]) => !/\/rpc|\/actions|\/daily|cimac-maintenance/.test(url),
        ),
      ).toBe(true);
    },
  );

  it("keeps the optional feature compatible with old workflow capabilities and includes its standalone module", () => {
    expect(VERSION).toBe("0.10.0");
    const old = manifest();
    delete (old as Partial<typeof old>).cimacApartmentReservations;
    expect(checkManifest(old)).toEqual(old);
    expect(checkManifest(manifest()).directExecution.workflows).toEqual(["daily_payment"]);
    expect(packageFiles).toContain("apartment-reservations.mjs");
    expect(humanResult("capabilities", manifest())).toContain("只登记未收款预留");
  });

  it.each(["missing", "disabled", "truthy", "version", "actions", "upgrade", "role", "direct"])(
    "does not send business requests when feature gate is invalid: %s",
    async (kind) => {
      const capability = manifest();
      if (kind === "missing")
        delete (capability as Partial<typeof capability>).cimacApartmentReservations;
      if (kind === "disabled") capability.cimacApartmentReservations.available = false;
      if (kind === "truthy")
        Object.assign(capability.cimacApartmentReservations, { available: "true" });
      if (kind === "version") capability.cimacApartmentReservations.version = 2;
      if (kind === "actions")
        capability.cimacApartmentReservations.actions = ["reserve", "reserve", "cancel"];
      if (kind === "upgrade")
        capability.cimacApartmentReservations.minimumConnectorVersion = "0.11.0";
      if (kind === "role") capability.identity.role = "finance";
      if (kind === "direct") {
        capability.directExecution.available = false;
        capability.safeguards.screenshotWritesRequireConfirmation = true;
        capability.safeguards.batchWritesRequireConfirmation = true;
      }
      const transport = transportFor(undefined, undefined, undefined, capability);
      await expect(
        new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
          "execute",
          request(),
        ),
      ).rejects.toThrow("cimac_apartment_reservations_not_available");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it("queries one fixed B17 room without a write, financial data or a generated request", async () => {
    const transport = transportFor();
    expect(
      await new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
        "query",
        { unitNos: ["201"] },
      ),
    ).toEqual(query());
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toContain("cimac-apartment-reservations/query");
    expect(
      JSON.parse(String((transport.mock.calls as unknown as [string, RequestInit][])[1][1].body)),
    ).toEqual({ unitNos: ["201"] });
  });

  it("keeps query and original-request recovery readable when emergency direct execution is disabled", async () => {
    const capability = manifest();
    capability.directExecution.available = false;
    capability.cimacApartmentReservations.available = false;
    capability.safeguards.screenshotWritesRequireConfirmation = true;
    capability.safeguards.batchWritesRequireConfirmation = true;
    const transport = transportFor(undefined, query(), history(), capability);
    const client = new OperatorClient(config, sessionStore(), transport);
    expect(await client.cimacApartmentReservations("status", { requestId })).toMatchObject({
      status: "completed_previously",
      verified: false,
    });
    expect(await client.cimacApartmentReservations("query", {})).toEqual(query());
    expect(transport.mock.calls.some(([url]) => url.endsWith("/execute"))).toBe(false);
  });

  it.each([
    "date",
    "money",
    "stay",
    "extra",
    "empty",
    "duplicate",
    "missing CAS",
    "bad timestamp",
    "name missing",
    "reserve existing",
    "cancel no target",
  ])("rejects invalid or unrelated business fields before network: %s", async (kind) => {
    const input = request();
    if (kind === "date") Object.assign(input.operations[0], { checkIn: "2026-11-02" });
    if (kind === "money") Object.assign(input.operations[0], { amount: 350000 });
    if (kind === "stay") input.operations[0].type = "check_in";
    if (kind === "extra") Object.assign(input, { buildingId: building });
    if (kind === "empty") input.operations = [];
    if (kind === "duplicate")
      input.operations.push({ ...input.operations[0], unitId: unit.toUpperCase() });
    if (kind === "missing CAS")
      delete (input.operations[0] as Partial<(typeof input.operations)[0]>).expectedUnitUpdatedAt;
    if (kind === "bad timestamp") input.operations[0].expectedUnitUpdatedAt = "today";
    if (kind === "name missing") input.operations[0].reserverName = " ";
    if (kind === "reserve existing") input.operations[0].expectedReservationId = reservation;
    if (kind === "cancel no target") input.operations[0].type = "cancel";
    const transport = transportFor();
    await expect(
      new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
        "execute",
        input,
      ),
    ).rejects.toThrow("invalid_cimac_apartment_reservation_request");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["actor", "unit", "unit version", "reservation", "reservation version", "schema"])(
    "requires live actor and CAS evidence before POST execute: %s",
    async (kind) => {
      const snapshot = query();
      if (kind === "actor") snapshot.actorId = id(9);
      if (kind === "unit") snapshot.rooms[0].unitId = id(9);
      if (kind === "unit version") snapshot.rooms[0].unitUpdatedAt = after;
      if (kind === "reservation") Object.assign(snapshot.rooms[0], query("cancel").rooms[0]);
      if (kind === "reservation version") {
        Object.assign(snapshot.rooms[0], query("cancel").rooms[0]);
        snapshot.rooms[0].reservation!.updatedAt = after;
      }
      if (kind === "schema") {
        snapshot.schemaAvailable = false;
        snapshot.rooms = [];
      }
      const transport = transportFor(completed(), snapshot);
      await expect(
        new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
          "execute",
          request(),
        ),
      ).rejects.toThrow();
      expect(transport.mock.calls.some(([url]) => url.endsWith("/execute"))).toBe(false);
    },
  );

  it.each([
    "actor",
    "project",
    "building",
    "request",
    "unit",
    "room number",
    "reservation",
    "status",
    "name",
    "paid",
    "timestamp",
    "duplicate",
    "financial evidence",
    "idempotency",
  ])("does not certify a mismatched result: %s", async (kind) => {
    const result = completed("cancel");
    if (kind === "actor") result.actorId = id(9);
    if (kind === "project") result.projectId = id(9);
    if (kind === "building") result.buildingId = id(9);
    if (kind === "request") result.requestId = id(9);
    if (kind === "unit") result.rooms[0].unitId = id(9);
    if (kind === "room number") result.rooms[0].unitNo = "202";
    if (kind === "reservation") result.rooms[0].reservationId = id(9);
    if (kind === "status") result.rooms[0].status = "reserved";
    if (kind === "name") result.rooms[0].reserverName = "Different synthetic reserver";
    if (kind === "paid") result.rooms[0].paymentStatus = "paid";
    if (kind === "timestamp") result.rooms[0].updatedAt = "today";
    if (kind === "duplicate") result.rooms.push({ ...result.rooms[0] });
    if (kind === "financial evidence") Object.assign(result, { paymentIds: [id(9)] });
    if (kind === "idempotency") Object.assign(result, { idempotent: "false" });
    const transport = transportFor(result, query("cancel"));
    await expect(
      new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
        "execute",
        request("cancel"),
      ),
    ).rejects.toThrow("apartment_reservation_verification_failed_keep_original_request_id");
  });

  it("never treats status history or an idempotent execution race as a newly verified operation", async () => {
    const transport = transportFor(undefined, undefined, history());
    expect(
      await new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
        "execute",
        request(),
      ),
    ).toMatchObject({ status: "completed_previously", verified: false });
    expect(transport).toHaveBeenCalledTimes(2);
    const race = transportFor({ ...completed(), idempotent: true });
    expect(
      await new OperatorClient(config, sessionStore(), race).cimacApartmentReservations(
        "execute",
        request(),
      ),
    ).toMatchObject({ status: "completed_previously", verified: false });
  });

  it("refuses changed instructions or another actor's original history without query or replay", async () => {
    const changed = history();
    changed.request.operations[0].reserverName = "Different synthetic reserver";
    const transport = transportFor(undefined, undefined, changed);
    await expect(
      new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
        "execute",
        request(),
      ),
    ).rejects.toThrow("apartment_reservation_state_requires_reconciliation");
    expect(transport).toHaveBeenCalledTimes(2);
    const foreign = transportFor(undefined, undefined, { ...history(), actorId: id(9) });
    await expect(
      new OperatorClient(config, sessionStore(), foreign).cimacApartmentReservations("status", {
        requestId,
      }),
    ).rejects.toThrow("apartment_reservation_state_requires_reconciliation");
  });

  it("MCP schemas route only dedicated operations under the existing lock and reject unknown money fields", async () => {
    const client = { cimacApartmentReservations: vi.fn().mockResolvedValue({ synthetic: true }) };
    const lock = { lock: vi.fn(async (fn: () => Promise<unknown>) => fn()) };
    for (const [name, operation, args] of [
      ["query_cimac_apartment_reservations", "query", { unitNos: ["201"] }],
      ["execute_cimac_apartment_reservations", "execute", request()],
      ["cimac_apartment_reservation_status", "status", { requestId }],
    ] as const) {
      await callTool(name, args, client, lock);
      expect(client.cimacApartmentReservations).toHaveBeenLastCalledWith(operation, args);
      expect(tools.find((tool: { name: string }) => tool.name === name)).toBeDefined();
    }
    await expect(
      callTool(
        "execute_cimac_apartment_reservations",
        { ...request(), paymentDate: "2026-11-02" },
        client,
        lock,
      ),
    ).rejects.toThrow("invalid_tool_arguments");
    await expect(
      callTool(
        "execute_cimac_apartment_reservations",
        { ...request(), operations: [{ ...request().operations[0], reserverName: null }] },
        client,
        lock,
      ),
    ).rejects.toThrow("invalid_tool_arguments");
    expect(lock.lock).toHaveBeenCalledTimes(3);
  });

  it("normalizes case and surrounding text while preserving microsecond CAS versions", () => {
    const input = request();
    input.requestId = requestId.toUpperCase();
    input.operations[0].unitId = unit.toUpperCase();
    input.operations[0].reserverName = " Synthetic reserver A ";
    expect(wire.normalizeApartmentReservationRequest(input)).toEqual(request());
    expect(() => wire.normalizeApartmentReservationQuery({ unitNos: ["1701"] })).toThrow();
    expect(() => wire.normalizeApartmentReservationQuery({ unitNos: ["201", "201"] })).toThrow();
    expect(() => wire.normalizeApartmentReservationStatus({ requestId, unitId: unit })).toThrow();
    expect(
      humanError("apartment_reservation_verification_failed_keep_original_request_id"),
    ).toContain("保留原请求号");
  });

  it("retains the original request on an invalid committed-write response without an automatic retry", async () => {
    const transport = vi.fn(async (url: string) => {
      if (url.endsWith("/capabilities")) return reply(manifest());
      if (new URL(url).pathname.endsWith("/status")) return reply(notFound());
      if (url.endsWith("/query")) return reply(query());
      return new Response("Synthetic truncated response", { status: 200 });
    });
    await expect(
      new OperatorClient(config, sessionStore(), transport).cimacApartmentReservations(
        "execute",
        request(),
      ),
    ).rejects.toThrow("apartment_reservation_outcome_unknown");
    expect(transport).toHaveBeenCalledTimes(4);
    expect(humanError("apartment_reservation_outcome_unknown")).toContain("不要换号或自动重放");
  });

  it("encrypts the immutable request before the POST and retains unknown results without replay during recovery", async () => {
    const local = journal();
    const base = {
      capabilities: vi.fn().mockResolvedValue(manifest()),
      cimacApartmentReservations: vi.fn(),
    };
    base.cimacApartmentReservations.mockImplementation(async (operation: string) => {
      if (operation === "status") return notFound();
      expect(local.value.get(actor, requestId)).toMatchObject({
        kind: "cimac_apartment_reservations",
        state: "preparing",
        request: request(),
      });
      throw new Error("Synthetic transport loss");
    });
    const client = durableClient(base, sessionStore(), local.value, config);
    await expect(client.cimacApartmentReservations("execute", request())).rejects.toThrow(
      "Synthetic transport loss",
    );
    expect(local.value.get(actor, requestId).state).toBe("unknown");
    const bytes = readFileSync(
      join(local.directory, "pending-v1", readdirSync(join(local.directory, "pending-v1"))[0]),
    );
    expect(bytes.includes(Buffer.from("Synthetic reserver A"))).toBe(false);
    expect(JSON.parse(local.crypt(bytes, "unprotect").toString()).formatVersion).toBe(4);
    expect(await client.pending("recover", { requestId })).toMatchObject({
      status: "not_found",
      verified: false,
      state: "unknown",
    });
    expect(base.cimacApartmentReservations.mock.calls.map(([op]) => op)).toEqual([
      "execute",
      "status",
    ]);
    const changed = request();
    changed.operations[0].reserverName = "Changed synthetic reserver";
    await expect(client.cimacApartmentReservations("execute", changed)).rejects.toThrow(
      "pending_request_changed_reconcile_first",
    );
    expect(base.cimacApartmentReservations).toHaveBeenCalledTimes(2);
  });

  it("retains formats 1–3 and old kinds after an upgrade to format4 without downgrading encrypted state", () => {
    for (const formatVersion of [1, 2, 3]) {
      const local = journal();
      const kind =
        formatVersion === 1
          ? "note"
          : formatVersion === 2
            ? "native_collection"
            : "cimac_maintenance";
      const priorId = id(100 + formatVersion),
        file = join(
          local.directory,
          "pending-v1",
          createHash("sha256")
            .update(config.appUrl + "|" + actor)
            .digest("hex") + ".dpapi",
        );
      writeFileSync(
        file,
        local.crypt(
          JSON.stringify({
            formatVersion,
            site: config.appUrl,
            actor,
            items: [{ requestId: priorId, kind, state: "unknown", request: { synthetic: true } }],
          }),
          "protect",
        ),
      );
      expect(local.value.get(actor, priorId).kind).toBe(kind);
      local.value.put(actor, {
        requestId,
        kind: "cimac_apartment_reservations",
        request: request(),
        state: "unknown",
      });
      local.value.put(actor, {
        requestId: id(200),
        kind: "cimac_maintenance",
        request: { synthetic: true },
        state: "unknown",
      });
      expect(local.value.list(actor)).toHaveLength(3);
      expect(local.value.get(actor, priorId).kind).toBe(kind);
      expect(
        JSON.parse(local.crypt(readFileSync(file), "unprotect").toString()).formatVersion,
      ).toBe(4);
      expect(local.value.list(id(999))).toEqual([]);
    }
  });

  it("requires the new module and durable components in 0.9 packages while accepting old integrity manifests", () => {
    const directory = journal().directory;
    const critical = [
      "core.mjs",
      "runtime.mjs",
      "cli.mjs",
      "mcp-server.mjs",
      "mcp-tools.mjs",
      "session-store.mjs",
      "node.exe",
      "SessionProtection.exe",
      "config.json",
    ];
    const checksums: Record<string, string> = {};
    const add = (file: string) => {
      const bytes = Buffer.from("Synthetic package file: " + file);
      writeFileSync(join(directory, file), bytes);
      checksums[file] = createHash("sha256").update(bytes).digest("hex");
    };
    critical.forEach(add);
    const manifestPath = join(directory, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ version: "0.8.0", checksums }));
    expect(verifyPackage(directory).version).toBe("0.8.0");
    writeFileSync(manifestPath, JSON.stringify({ version: "0.9.0", checksums }));
    expect(verifyPackage(directory).version).toBe("0.9.0");
    writeFileSync(manifestPath, JSON.stringify({ version: "0.10.0", checksums }));
    expect(() => verifyPackage(directory)).toThrow("package_manifest_incomplete");
    [
      "apartment-reservations.mjs",
      "cimac-finance.mjs",
      "pending-client.mjs",
      "pending-store.mjs",
      "human-output.mjs",
    ].forEach(add);
    writeFileSync(manifestPath, JSON.stringify({ version: "0.10.0", checksums }));
    expect(verifyPackage(directory).version).toBe("0.10.0");
    writeFileSync(join(directory, "apartment-reservations.mjs"), "Synthetic tampering");
    expect(() => verifyPackage(directory)).toThrow("package_checksum_failed");
  });

  it("recovers completed history as unverified and never silently marks a pending request complete", async () => {
    const local = journal();
    local.value.put(actor, {
      requestId,
      kind: "cimac_apartment_reservations",
      request: request(),
      executionMode: "direct",
      state: "unknown",
    });
    const base = {
      capabilities: vi.fn().mockResolvedValue(manifest()),
      cimacApartmentReservations: vi.fn().mockResolvedValue(history()),
    };
    const client = durableClient(base, sessionStore(), local.value, config);
    expect(await client.pending("recover", { requestId })).toMatchObject({
      status: "completed_previously",
      verified: false,
    });
    expect(local.value.get(actor, requestId).state).toBe("completed_history");
    await expect(client.cimacApartmentReservations("execute", request())).rejects.toThrow(
      "pending_already_completed_do_not_repeat",
    );
    expect(base.cimacApartmentReservations).toHaveBeenCalledExactlyOnceWith("status", {
      requestId,
    });
  });
});
