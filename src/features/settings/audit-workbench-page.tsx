import type { Locale } from "@/lib/i18n";
import { initialAuditWorkbench } from "./audit-workbench-service";
import { AuditWorkbenchReadError, parseAuditWorkbenchQuery } from "./audit-workbench-model";
import { AuditWorkbench } from "./audit-workbench";
import type { AuditWorkbenchQuery } from "./audit-workbench-types";

export async function AuditWorkbenchPage({
  params,
  locale,
  viewerKey,
}: {
  params: Record<string, unknown>;
  locale: Locale;
  viewerKey: string;
}) {
  let query: AuditWorkbenchQuery;
  try {
    query = parseAuditWorkbenchQuery(params);
  } catch {
    return (
      <AuditWorkbench
        locale={locale}
        viewerKey={viewerKey}
        initialData={null}
        initialQuery={parseAuditWorkbenchQuery()}
        initialError={400}
      />
    );
  }
  try {
    const initialData = await initialAuditWorkbench({ ...query });
    return <AuditWorkbench locale={locale} viewerKey={viewerKey} initialData={initialData} />;
  } catch (error) {
    return (
      <AuditWorkbench
        locale={locale}
        viewerKey={viewerKey}
        initialData={null}
        initialQuery={query}
        initialError={error instanceof AuditWorkbenchReadError ? error.status : 503}
      />
    );
  }
}
