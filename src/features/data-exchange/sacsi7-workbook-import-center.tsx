"use client";

import { useState, useTransition } from "react";
import { applySacsi7WorkbookImport, previewSacsi7WorkbookImport, type Sacsi7ImportResult } from "./sacsi7-workbook-import";

export function Sacsi7WorkbookImportCenter() {
  const [result, setResult] = useState<Sacsi7ImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = (mode: "preview" | "apply") => startTransition(async () => {
    try {
      setResult(mode === "preview" ? await previewSacsi7WorkbookImport() : await applySacsi7WorkbookImport());
    } catch (error) {
      setResult({ success: false, mode, message: error instanceof Error ? error.message : String(error), summary: {} });
    }
  });
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">来源：7号公寓.xlsx。覆盖72套公寓的真实租售资料，新增1间空闲底商（120万/月），并导入明确的正数收款。</p>
      <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={pending} onClick={() => run("preview")}>预览校验</button>
      {result && <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs">{JSON.stringify(result, null, 2)}</pre>}
      {result?.success && result.mode === "preview" && <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我确认按预览结果覆盖7号楼数据</label>
        <button className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50" disabled={pending || !confirmed} onClick={() => run("apply")}>执行7号楼覆盖导入</button>
      </>}
    </div>
  );
}
