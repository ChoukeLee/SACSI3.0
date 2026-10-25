"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function CimacWorkspaceFeedback({
  missing = false,
  reset,
}: {
  missing?: boolean;
  reset?: () => void;
}) {
  const fr = usePathname().startsWith("/fr/");
  return (
    <section role="alert" className="mx-auto max-w-xl rounded-xl border bg-card p-6 text-sm">
      <h1 className="text-lg font-semibold">
        {missing
          ? fr
            ? "Périmètre introuvable ou inaccessible"
            : "记录不存在或无权访问"
          : fr
            ? "Lecture momentanément indisponible"
            : "暂时无法读取工作区"}
      </h1>
      <p className="my-4 leading-6 text-muted-foreground">
        {fr
          ? "Aucune donnée n’a été modifiée. Une erreur de lecture n’est pas présentée comme une activité ou un solde nul."
          : "没有修改任何业务记录，也不会将读取失败显示为空置或零账目。请核对当前账号的项目权限。"}
      </p>
      <div className="flex gap-4">
        {reset && (
          <button type="button" className="rounded-md border px-3 py-2" onClick={reset}>
            {fr ? "Réessayer" : "重试"}
          </button>
        )}
        <Link className="py-2 text-blue-700 underline" href={fr ? "/fr/cimac" : "/cimac"}>
          {fr ? "Accueil CIMAC" : "建材城首页"}
        </Link>
        <Link className="py-2 underline" href={fr ? "/fr/management" : "/management"}>
          {fr ? "Espace SACSI" : "SACSI 工作区"}
        </Link>
      </div>
    </section>
  );
}
