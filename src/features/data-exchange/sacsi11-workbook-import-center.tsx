"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { applySacsi11WorkbookImport, previewSacsi11WorkbookImport, type Sacsi11ImportResult } from "./sacsi11-workbook-import";

export function Sacsi11WorkbookImportCenter() {
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState<Sacsi11ImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run(mode: "preview" | "apply") {
    setLoading(true); setError("");
    try {
      const next = mode === "preview" ? await previewSacsi11WorkbookImport(payload) : await applySacsi11WorkbookImport(payload);
      setResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  return <div className="max-w-4xl space-y-5">
    <Card>
      <CardHeader><CardTitle>11号公寓 Excel 专项覆盖</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">仅供管理员执行。保留日租订单、保洁、附件和车位；更新72套住宅档案、长租、销售及销售累计应收。</p>
        <textarea aria-label="SACSI11覆盖数据" value={payload} onChange={(e) => { setPayload(e.target.value); setResult(null); }} rows={12} className="w-full rounded-md border bg-card p-3 font-mono text-xs" placeholder="粘贴经过校验的JSON数据" />
        <div className="flex gap-2"><Button onClick={() => run("preview")} disabled={loading || !payload.trim()}>预览校验</Button></div>
        {result && <pre className="overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
        {result?.mode === "preview" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我确认已创建更新前备份，并按预览结果覆盖11号公寓数据</label>}
        {result?.mode === "preview" && <Button onClick={() => run("apply")} disabled={loading || !confirmed} className="bg-rose-600 hover:bg-rose-700">执行覆盖</Button>}
        {error && <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      </CardContent>
    </Card>
  </div>;
}
