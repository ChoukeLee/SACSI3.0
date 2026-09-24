import {
  businessRequestIdentity,
  clearBusinessRequestIdentity,
} from "@/lib/business-request-identity";

export async function runFinanceRequest<
  T extends { success: boolean; error?: string; rejected?: boolean },
>(
  operation: string,
  target: string,
  payload: unknown,
  submit: (id: string) => Promise<T>,
): Promise<T> {
  const id = await businessRequestIdentity("finance", operation, target, payload);
  try {
    const result = await submit(id);
    if (result.success || result.rejected)
      clearBusinessRequestIdentity("finance", operation, target);
    return result.success || result.rejected
      ? result
      : { ...result, error: `${result.error ?? "结果未知"}；请保留原内容重试。操作号：${id}` };
  } catch {
    throw new Error(`结果未知，请勿另起一笔。按原内容重试或核对审计。操作号：${id}`);
  }
}
