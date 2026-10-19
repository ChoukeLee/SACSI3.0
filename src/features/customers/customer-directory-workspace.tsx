import { createClient } from "@/lib/supabase/server";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import {
  CustomerDirectoryError,
  customerDirectoryId,
  customerDirectoryQueryKey,
  parseCustomerDirectoryQuery,
} from "./customer-directory-model";
import { readCustomerDirectory } from "./customer-directory-service";
import { CustomerWorkbench } from "./customer-workbench";

export async function CustomerDirectoryWorkspace({
  searchParams,
  locale,
  canEdit,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  locale: "zh" | "fr";
  canEdit: boolean;
}) {
  try {
    const keys = ["project", "building", "q", "filter", "page", "customer", "returnTo"];
    if (keys.some((key) => Array.isArray(searchParams[key]))) throw new CustomerDirectoryError(400);
    const query = parseCustomerDirectoryQuery(
      Object.fromEntries([
        ["projectId", searchParams.project ?? ""],
        ["buildingId", searchParams.building ?? ""],
        ["search", searchParams.q ?? ""],
        ["filter", searchParams.filter ?? "all"],
        ["page", searchParams.page ?? "1"],
      ]),
    );
    const customer = searchParams.customer;
    if (customer && !customerDirectoryId(customer)) throw new CustomerDirectoryError(400);
    const data = await readCustomerDirectory(await createClient(), query);
    return (
      <CustomerWorkbench
        key={`${customerDirectoryQueryKey(query)}:${typeof customer === "string" ? customer : ""}`}
        data={data}
        locale={locale}
        canEdit={canEdit}
        initialSelectedId={typeof customer === "string" ? customer : null}
        returnTo={safeWorkbenchReturnTo(searchParams.returnTo)}
      />
    );
  } catch (error) {
    const zh = locale === "zh";
    const status = error instanceof CustomerDirectoryError ? error.status : 503;
    return (
      <section role="alert" className="rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">
          {zh ? "客户名册暂时无法显示" : "Répertoire clients indisponible"}
        </h1>
        <p className="my-3 text-sm text-muted-foreground">
          {status === 400 || status === 403
            ? zh
              ? "筛选条件无效或不在当前授权范围内。没有自动扩大范围。"
              : "Filtres invalides ou hors périmètre autorisé. Le périmètre n'a pas été élargi."
            : zh
              ? "读取失败不代表没有客户。请重新加载，或稍后再试。"
              : "Un échec de lecture ne signifie pas qu'aucun client n'existe. Réessayez."}
        </p>
        <a href={locale === "fr" ? "/fr/customers" : "/customers"} className="text-sm underline">
          {zh ? "重置筛选并重新读取" : "Réinitialiser et recharger"}
        </a>
      </section>
    );
  }
}
