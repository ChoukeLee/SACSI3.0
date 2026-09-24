// Only request identity + SHA-256 fingerprint are persisted, never form values.
// A network failure retains the original identity even across a page refresh.
export async function businessRequestIdentity(
  namespace: string,
  operation: string,
  target: string,
  payload: unknown,
): Promise<string> {
  const key = `sacsi:${namespace}-request:v1:${operation}:${target}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const raw = sessionStorage.getItem(key);
  if (raw) {
    const previous = JSON.parse(raw) as { requestId: string; fingerprint: string };
    if (previous.fingerprint !== fingerprint)
      throw new Error(
        "上一笔操作结果尚未核实，请先按原内容重试或核对审计，不能改金额后另起请求。操作号：" +
          previous.requestId,
      );
    return previous.requestId;
  }
  const requestId = crypto.randomUUID();
  sessionStorage.setItem(key, JSON.stringify({ requestId, fingerprint }));
  return requestId;
}
export function clearBusinessRequestIdentity(namespace: string, operation: string, target: string) {
  sessionStorage.removeItem(`sacsi:${namespace}-request:v1:${operation}:${target}`);
}
