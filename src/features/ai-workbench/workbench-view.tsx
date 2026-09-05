"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowUp, CheckCircle2, Clock3, Database, LockKeyhole, Search, ShieldCheck, Sparkles } from "lucide-react";
import { OperationalPage, StatTile } from "@/components/ui/operational";
import { cn } from "@/lib/utils";
import { askWorkbench } from "./actions";
import { INITIAL_WORKBENCH_STATE, type WorkbenchDraftPreview, type WorkbenchResult, type WorkbenchTone } from "./types";

const suggestions = [
  "今天日租房态",
  "11#长租逾期明细",
  "出售15天内应缴",
  "查看11#503的合同和收款",
  "11#906保洁已完成",
];

const toneBorder: Record<WorkbenchTone, string> = {
  neutral: "border-border",
  blue: "border-l-accentBlue-500",
  green: "border-l-accentGreen-500",
  amber: "border-l-accentAmber-500",
  red: "border-l-accentRed-500",
  purple: "border-l-accentPurple-500",
  teal: "border-l-[#5CC4B8]",
};

export function AiWorkbenchView() {
  const [query, setQuery] = useState("");
  const [state, formAction, pending] = useActionState(askWorkbench, INITIAL_WORKBENCH_STATE);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle") {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }, [state]);

  return (
    <OperationalPage
      eyebrow="业务查询"
      title="AI 工作台"
      description="用自然语言查询系统记录并生成受控操作草稿；当前阶段不会直接执行修改。"
      action={
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accentGreen-100 bg-accentGreen-50 px-3 text-xs font-semibold text-accentGreen-700">
          <LockKeyhole className="h-3.5 w-3.5" />查询 + 草稿预览
        </span>
      }
      className="mx-auto max-w-[1500px]"
    >
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <form action={formAction} className="p-5 sm:p-7">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold">查询事实或描述要办理的事项</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">写明业务、楼栋、房号、日期和动作，系统会先核对再给出结果或草稿。</p>
              </div>
            </div>

            <label htmlFor="ai-workbench-query" className="sr-only">要查询的问题</label>
            <div className="rounded-xl border border-border-strong bg-background/55 p-2 transition-shadow focus-within:border-ring focus-within:shadow-glow">
              <textarea
                id="ai-workbench-query"
                name="query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="例如：11#长租有哪些逾期？"
                className="min-h-[92px] w-full resize-none bg-transparent px-2.5 py-2 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-[15px]"
              />
              <div className="flex items-center justify-between gap-3 border-t border-border/70 px-1 pt-2">
                <span className="hidden text-[11px] text-muted-foreground sm:inline">金额统一以 XOF（西非法郎）展示</span>
                <button
                  type="submit"
                  disabled={pending || query.trim().length < 2}
                  className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {pending ? <Clock3 className="h-4 w-4 animate-pulse" /> : <ArrowUp className="h-4 w-4" />}
                  {pending ? "正在核对记录" : "提交"}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2" aria-label="常用查询">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuery(suggestion)}
                  className="min-h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </form>

          <aside className="border-t border-border bg-muted/35 p-5 lg:border-l lg:border-t-0" aria-label="工作台边界">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">工作台边界</p>
            <div className="mt-4 space-y-4">
              <Boundary icon={Database} title="系统实时记录" text="读取当前账号有权查看的数据，不使用模型记忆补数。" />
              <Boundary icon={ShieldCheck} title="固定业务口径" text="应收、未收、逾期和房态沿用系统统一计算规则。" />
              <Boundary icon={LockKeyhole} title="先草稿、后确认" text="当前只开放完成保洁草稿预览，尚未连接执行按钮，不会修改数据。" />
              <Boundary icon={Sparkles} title="最小化模型输入" text="仅在本地规则无法识别时发送问题文字；数据库记录和查询结果不会发送。" />
            </div>
          </aside>
        </div>
      </section>

      <div ref={resultRef} className="scroll-mt-16">
        {pending && <LoadingResult />}
        {!pending && state.status === "error" && (
          <section className="rounded-xl border border-accentRed-100 bg-accentRed-50 p-5 text-sm text-accentRed-700" role="status" aria-atomic="true">
            <p className="font-semibold">查询未完成</p>
            <p className="mt-1 leading-6">{state.error}</p>
          </section>
        )}
        {!pending && state.result?.kind === "query_result" && <WorkbenchResultView result={state.result} />}
        {!pending && state.result?.kind === "action_draft" && <WorkbenchDraftView draft={state.result} />}
      </div>
    </OperationalPage>
  );
}

function WorkbenchDraftView({ draft }: { draft: WorkbenchDraftPreview }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-accentAmber-100 bg-card shadow-card">
        <div className="border-b border-border px-5 py-5 sm:px-6" role="status" aria-atomic="true">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentAmber-50 text-accentAmber-600"><Sparkles className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium text-muted-foreground">操作草稿</p><span className="rounded-full border border-accentAmber-100 bg-accentAmber-50 px-2 py-0.5 text-[11px] font-semibold text-accentAmber-700">{draft.risk}</span></div>
              <h2 className="mt-1 text-lg font-semibold">{draft.title}</h2>
              <p className="mt-2 text-sm leading-7 text-foreground/85">{draft.summary}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <EvidenceGroup title="操作对象" items={draft.target} />
          <EvidenceGroup title="修改前状态" items={draft.beforeState} />
        </div>
        <div className="border-t border-border px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold text-muted-foreground">预期影响</p>
          <ol className="mt-3 space-y-2">{draft.expectedEffects.map((effect, index) => <li key={effect} className="flex gap-2 text-sm leading-6"><span className="text-muted-foreground">{index + 1}.</span><span>{effect}</span></li>)}</ol>
        </div>
      </section>

      <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">人工确认</p>
        <div className="mt-4 rounded-lg border border-accentAmber-100 bg-accentAmber-50 p-3 text-xs leading-5 text-accentAmber-700">{draft.confirmationNote}</div>
        {draft.warnings.map((warning) => <p key={warning} className="mt-3 text-xs leading-5 text-muted-foreground">{warning}</p>)}
        <button type="button" disabled className="mt-5 inline-flex min-h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground opacity-45"><LockKeyhole className="h-4 w-4" />确认执行（暂未开放）</button>
      </aside>
    </div>
  );
}

function EvidenceGroup({ title, items }: { title: string; items: Array<{ label: string; value: string }> }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <dl className="mt-3 divide-y divide-border/70 rounded-lg border border-border px-3">
        {items.map((item) => <div key={`${item.label}-${item.value}`} className="flex items-start justify-between gap-4 py-3"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="text-right text-xs font-medium leading-5">{item.value}</dd></div>)}
      </dl>
    </div>
  );
}

function Boundary({ icon: Icon, title, text }: { icon: typeof Database; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"><Icon className="h-3.5 w-3.5" /></span>
      <div><p className="text-xs font-semibold text-foreground">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>
    </div>
  );
}

function LoadingResult() {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-card" role="status">
      <div className="flex items-center gap-3"><Search className="h-4 w-4 animate-pulse text-accentBlue-500" /><p className="text-sm font-semibold">正在核对业务记录与统计口径…</p></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-20 animate-pulse rounded-lg bg-muted" /></div>
    </section>
  );
}

function WorkbenchResultView({ result }: { result: WorkbenchResult }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="border-b border-border px-5 py-5 sm:px-6" role="status" aria-atomic="true">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentGreen-50 text-accentGreen-600"><CheckCircle2 className="h-4 w-4" /></span>
            <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">查询结果</p><h2 className="mt-1 text-lg font-semibold">{result.title}</h2><p className="mt-2 text-sm leading-7 text-foreground/85">{result.answer}</p></div>
          </div>
        </div>

        {result.metrics.length > 0 && (
          <div className="grid gap-3 border-b border-border bg-muted/25 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {result.metrics.map((metric) => <StatTile key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} className={cn("min-h-[82px] border-l-[3px]", toneBorder[metric.tone])} />)}
          </div>
        )}

        {result.table && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="border-b border-border bg-muted/55">
                <tr>{result.table.columns.map((column) => <th key={column.key} className={cn("px-4 py-3 text-left text-xs font-semibold text-muted-foreground", column.align === "right" && "text-right")}>{column.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {result.table.rows.length ? result.table.rows.map((row, index) => (
                  <tr key={index} className="hover:bg-muted/35">{result.table!.columns.map((column) => <td key={column.key} className={cn("max-w-[260px] px-4 py-3 align-top", column.align === "right" && "text-right tabular-nums font-medium")}>{row[column.key] ?? "—"}</td>)}</tr>
                )) : <tr><td colSpan={result.table.columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">没有符合当前口径的记录</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">本次口径与证据</p>
        <dl className="mt-4 divide-y divide-border/70">
          {result.evidence.map((item) => <div key={`${item.label}-${item.value}`} className="py-3 first:pt-0"><dt className="text-[11px] font-medium text-muted-foreground">{item.label}</dt><dd className="mt-1 text-xs font-medium leading-5 text-foreground">{item.value}</dd></div>)}
        </dl>
        {result.warnings.length > 0 && <div className="mt-4 rounded-lg border border-accentAmber-100 bg-accentAmber-50 p-3">{result.warnings.map((warning) => <p key={warning} className="text-xs leading-5 text-accentAmber-700">{warning}</p>)}</div>}
      </aside>
    </div>
  );
}
