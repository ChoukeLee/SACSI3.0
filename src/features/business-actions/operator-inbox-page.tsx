import "server-only";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { parseOperatorInboxQuery } from "./operator-inbox-model";
import { readOperatorInbox } from "./operator-inbox-read";
import { OperatorInboxWorkbench } from "./operator-inbox-workbench";
export async function OperatorInboxPage({
  params,
  locale,
}: {
  params: Record<string, string | string[] | undefined>;
  locale: "zh" | "fr";
}) {
  const user = await getCurrentUser();
  if (!user)
    redirect(
      `/login?redirect=${encodeURIComponent(locale === "fr" ? "/fr/operator" : "/operator")}`,
    );
  let query;
  try {
    query = parseOperatorInboxQuery(params);
  } catch {
    return (
      <section role="alert" className="rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">
          {locale === "zh" ? "筛选条件无效" : "Filtres invalides"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {locale === "zh"
            ? "请核对操作号、日期和分页。没有忽略错误条件或把它显示为空待办。"
            : "Vérifiez l’identifiant, les dates et la page. Les filtres invalides ne sont ni ignorés ni présentés comme une liste vide."}
        </p>
        <Link
          href={locale === "fr" ? "/fr/operator" : "/operator"}
          className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm"
        >
          {locale === "zh" ? "重新选择筛选" : "Choisir de nouveaux filtres"}
        </Link>
      </section>
    );
  }
  let result = null;
  try {
    result = await readOperatorInbox(query);
  } catch {
    /* A failed read is not zero tasks. */
  }
  return (
    <OperatorInboxWorkbench
      key={`${user.id}:${JSON.stringify(query)}`}
      query={query}
      result={result}
      locale={locale}
      actorLabel={user.email || user.id}
    />
  );
}
