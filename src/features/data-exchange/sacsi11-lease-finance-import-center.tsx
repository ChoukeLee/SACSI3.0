"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { applySacsi11LeaseFinanceImport, previewSacsi11LeaseFinanceImport, type Sacsi11LeaseFinanceResult } from "./sacsi11-lease-finance-import";

export function Sacsi11LeaseFinanceImportCenter() {
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState<Sacsi11LeaseFinanceResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run(mode: "preview" | "apply") {
    setLoading(true); setError("");
    try {
      const next = mode === "preview" ? await previewSacsi11LeaseFinanceImport(payload) : await applySacsi11LeaseFinanceImport(payload);
      setResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  return <div className="max-w-4xl space-y-5">
    <Card>
      <CardHeader><CardTitle>11号公寓当前长租财务明细</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">仅供管理员执行。只导入当前30份有效长租的明确押金和租金，跳过销售、日租、中介、物业、家具、退款及无法唯一拆分的金额；同时关闭503日租业务标记。</p>
        <textarea aria-label="SACSI11长租财务数据" value={payload} onChange={(e) => { setPayload(e.target.value); setResult(null); }} rows={12} className="w-full rounded-md border bg-card p-3 font-mono text-xs" placeholder="粘贴经过校验的JSON数据" />
        <Button onClick={() => run("preview")} disabled={loading || !payload.trim()}>预览校验</Button>
        {result && <pre className="overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
        {result?.mode === "preview" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我确认仅录入当前有效长租的明确收款，并按预览结果执行</label>}
        {result?.mode === "preview" && <Button onClick={() => run("apply")} disabled={loading || !confirmed} className="bg-rose-600 hover:bg-rose-700">执行长租财务导入</Button>}
        {error && <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      </CardContent>
    </Card>
  </div>;
}
