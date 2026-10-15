/** Request-owned timing only: no identity, query input, results or error text. */
const SEGMENTS = [
  "authorization",
  "database",
  "response",
  "total",
  "middleware_claims",
  "middleware_total",
  "auth_client",
  "auth_user",
  "auth_profile",
  "db_read",
  "rpc_read",
  "lookup_read",
  "serialize",
  "route_total",
] as const;
export type PerformanceSegment = (typeof SEGMENTS)[number];
export type PerformanceScope = "middleware" | "ssr_auth" | "route_read";
export interface PerformanceSample {
  name: PerformanceSegment;
  durationMs: number;
  calls: number;
}
const allowedSegments = new Set<string>(SEGMENTS);
const allowedScopes = new Set<string>(["middleware", "ssr_auth", "route_read"]);

/** Create inside the request/render. Never retain this instance in module state. */
export function createRequestTiming(now: () => number = () => performance.now()) {
  const samples = new Map<PerformanceSegment, { durationMs: number; calls: number }>();
  const record = (name: PerformanceSegment, durationMs: number) => {
    if (!allowedSegments.has(name)) throw new Error("unsupportedPerformanceSegment");
    if (!Number.isFinite(durationMs)) return;
    const previous = samples.get(name);
    samples.set(name, {
      durationMs: Math.min(86_400_000, (previous?.durationMs ?? 0) + Math.max(0, durationMs)),
      calls: Math.min(1_000_000, (previous?.calls ?? 0) + 1),
    });
  };
  const snapshot = (): PerformanceSample[] =>
    [...samples].map(([name, sample]) => ({
      name,
      durationMs: Math.round(sample.durationMs * 100) / 100,
      calls: sample.calls,
    }));
  const headers = (headers: Headers): Headers => {
    const value = snapshot()
      .map((sample) => `${sample.name};dur=${sample.durationMs.toFixed(2)}`)
      .join(", ");
    if (value) headers.append("Server-Timing", value);
    headers.set("Cache-Control", "private, no-store");
    return headers;
  };
  return {
    record,
    snapshot,
    async measure<T>(name: PerformanceSegment, operation: () => T | PromiseLike<T>): Promise<T> {
      if (!allowedSegments.has(name)) throw new Error("unsupportedPerformanceSegment");
      const started = now();
      try {
        return await operation();
      } finally {
        record(name, now() - started);
      }
    },
    /** Headers expose fixed labels and durations only; no request-header input. */
    headers,
    response<T extends Response>(response: T): T {
      headers(response.headers);
      return response;
    },
    log(scope: PerformanceScope) {
      if (!allowedScopes.has(scope)) throw new Error("unsupportedPerformanceScope");
      try {
        console.info("SACSI_PERFORMANCE", { scope, segments: snapshot() });
      } catch {
        /* Observability must not change authentication or business outcomes. */
      }
    },
  };
}
