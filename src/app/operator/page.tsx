import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export default async function OperatorInbox() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=%2Foperator");
  const db = await createClient();
  const { data, error } = await db.rpc("operator_task_inbox");
  if (error || !data) throw new Error("OperatorInboxUnavailable");
  const inbox = data as {
    pending: number;
    items: {
      id: string;
      request_id: string;
      kind: string;
      status: string;
      expired: boolean;
      created_at: string;
      expires_at: string;
    }[];
  };
  const labels: Record<string, string> = {
    confirmations: "日租收款",
    collections: "截图分账",
    "daily-workflows": "日租流程",
    "booking-operations": "预订/更正/退款",
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-5">
      <div className="flex justify-between gap-4">
        <h1 className="text-xl font-semibold">我的业务待办 · {inbox.pending}</h1>
        <Link href="/operator" className="rounded-md border p-2">
          刷新
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        只显示本人账号的确认单。过期单需要回到原对话重新核对；结果未知请保留原请求编号，不要另起一笔。最多展示最近
        100 单。
      </p>
      {!inbox.items.length && (
        <p className="rounded-xl border p-6">
          暂无确认单。可以继续在外部 AI 对话中整理信息、生成草稿。
        </p>
      )}
      {inbox.items.map((item) => (
        <article
          key={item.kind + item.id}
          className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:justify-between"
        >
          <div>
            <h2 className="font-medium">
              {labels[item.kind] || item.kind} ·{" "}
              {item.expired
                ? "已过期（未执行）"
                : item.status === "completed"
                  ? "已完成"
                  : "待本人确认"}
            </h2>
            <p className="mt-2 break-all text-xs text-muted-foreground">
              操作号：{item.request_id}
            </p>
            <time className="text-xs text-muted-foreground">
              {new Date(item.created_at).toLocaleString("zh-CN", { timeZone: "Africa/Abidjan" })}
            </time>
          </div>
          <Link
            href={`/operator/${item.kind}/${item.id}`}
            className="self-start rounded-md border p-2 text-sm"
          >
            {item.status === "completed" ? "查看结果" : "打开核对"}
          </Link>
        </article>
      ))}
    </div>
  );
}
