"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, History, Lightbulb, Loader2, MessageSquareText, RotateCcw, Send, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BusinessTable,
  BusinessTbody,
  BusinessTd,
  BusinessTh,
  BusinessThead,
  BusinessRow,
  businessEmptyCell,
} from "@/components/ui/business-table";
import { StatTile, controlClass } from "@/components/ui/operational";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";

type RiskLevel = "low" | "medium" | "high" | "blocked";

interface OperationChange {
  table: string;
  type: "insert" | "update" | "delete";
  entityId?: string | null;
  label?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

interface OperationDraft {
  id: string;
  action: string;
  summary: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  executable: boolean;
  roomNumbers: string[];
  changes: OperationChange[];
  missing: string[];
  warnings: string[];
  permissions: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface OperationInsight {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  roomNo?: string | null;
  actionHint: string;
}

interface OperationValidation {
  ok: boolean;
  riskLevel: RiskLevel;
  missing: string[];
  warnings: string[];
  changes: OperationChange[];
}

interface OperationResult {
  success: boolean;
  message: string;
  affectedRecords: OperationChange[];
  metadata?: Record<string, unknown>;
}

interface AuditOperation {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  actor_email: string | null;
  actor_role: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

const copy = {
  zh: {
    title: "业务助手",
    description: "把日常业务话术转换成可确认的操作草稿。支持清洁完成、日租退房、日租收款、合同编号整理和入住补录草稿。",
    inputLabel: "业务指令",
    placeholder: "例如：1201 已清洁完毕 / 1201 今日退房 / 1201 收了30000 / 103 整理合同编号",
    generate: "生成草稿",
    validate: "重新校验",
    confirm: "确认执行",
    draft: "操作草稿",
    noDraft: "输入清洁完成类指令后，系统会在这里展示草稿和风险。",
    result: "执行结果",
    history: "最近操作",
    capabilityTitle: "当前可处理的业务",
    capabilityHint: "信息完整时可确认执行；关键字段缺失时只生成待补草稿，不写入数据库。",
    askBackTitle: "缺失信息处理规则",
    askBackBody: "预订、补录、收款等写入型业务会校验必填字段。你只知道一部分也可以先说，助手会保留已识别的信息，并列出需要补充的客户、日期、金额或房间状态。",
    conversation: "对话上下文",
    noConversation: "还没有对话。你可以先输入一条业务需求，再继续补充信息。",
    clearContext: "清空上下文",
    insights: "运营洞察",
    noInsights: "当前没有需要优先处理的事项。",
    useHint: "填入指令",
    changes: "影响记录",
    missing: "缺少信息",
    warnings: "风险提示",
    supported: "当前指令暂未接入业务操作。",
    executable: "可执行",
    blocked: "不可执行",
    noHistory: "暂无 AI 操作记录。",
    role: "当前角色",
    risk: "风险等级",
    rooms: "房间",
    permission: "所需权限",
    source: "来源",
    before: "修改前",
    after: "修改后",
    action: "动作",
    table: "数据表",
    record: "记录",
    time: "时间",
    actor: "操作人",
  },
  fr: {
    title: "Assistant opérations",
    description: "Convertit les demandes métier en brouillons contrôlables: ménage, départ, paiement, nettoyage de numéro de contrat et brouillon d'arrivée.",
    inputLabel: "Instruction métier",
    placeholder: "Ex. 1201 ménage terminé / 1201 départ / 1201 paiement 30000 / nettoyer contrat 103",
    generate: "Préparer",
    validate: "Revalider",
    confirm: "Confirmer",
    draft: "Brouillon",
    noDraft: "Saisissez une instruction de ménage terminé pour voir le brouillon et les risques.",
    result: "Résultat",
    history: "Opérations récentes",
    capabilityTitle: "Opérations prises en charge",
    capabilityHint: "Si les informations clés sont complètes, l'action peut être confirmée. Sinon, seul un brouillon bloqué est créé.",
    askBackTitle: "Règle des informations manquantes",
    askBackBody: "Pour les écritures comme réservation, arrivée, paiement ou départ, l'assistant garde les infos reconnues et liste les champs à compléter avant toute écriture.",
    conversation: "Contexte",
    noConversation: "Aucun échange. Entrez une demande, puis complétez les infos manquantes.",
    clearContext: "Réinitialiser",
    insights: "Priorités opérationnelles",
    noInsights: "Aucune priorité immédiate.",
    useHint: "Utiliser",
    changes: "Enregistrements affectés",
    missing: "Infos manquantes",
    warnings: "Alertes",
    supported: "Cette instruction n'est pas encore prise en charge.",
    executable: "Exécutable",
    blocked: "Bloqué",
    noHistory: "Aucune opération IA récente.",
    role: "Rôle",
    risk: "Risque",
    rooms: "Chambres",
    permission: "Permission",
    source: "Source",
    before: "Avant",
    after: "Après",
    action: "Action",
    table: "Table",
    record: "Enregistrement",
    time: "Date",
    actor: "Acteur",
  },
} satisfies Record<Locale, Record<string, string>>;

const capabilities = {
  zh: [
    { name: "清洁完成", status: "可执行", fields: "房号；存在待完成清洁任务" },
    { name: "日租退房", status: "可执行", fields: "房号；存在已入住订单；退房日期可省略为今天" },
    { name: "日租收款", status: "可执行", fields: "房号；金额；存在已入住订单" },
    { name: "取消日租预订", status: "高风险确认", fields: "房号；存在待确认/已确认订单；管理员权限" },
    { name: "房态维修/锁定/恢复", status: "高风险确认", fields: "房号；目标房态；无活动订单冲突" },
    { name: "合同编号整理", status: "可执行", fields: "房号；存在 LEGACY 合同编号" },
    { name: "日租预订/入住补录", status: "信息齐全后可执行", fields: "房号、入住日期、客户、退房日期或开放式、房价/默认价" },
  ],
  fr: [
    { name: "Ménage terminé", status: "Exécutable", fields: "Chambre; tâche de ménage ouverte" },
    { name: "Départ journalier", status: "Exécutable", fields: "Chambre; séjour en cours; date par défaut aujourd'hui" },
    { name: "Paiement journalier", status: "Exécutable", fields: "Chambre; montant; séjour en cours" },
    { name: "Annuler réservation", status: "Risque élevé", fields: "Chambre; réservation en attente/confirmée; admin" },
    { name: "Maintenance / blocage", status: "Risque élevé", fields: "Chambre; statut cible; pas de conflit actif" },
    { name: "Nettoyage numéro contrat", status: "Exécutable", fields: "Chambre; numéro LEGACY existant" },
    { name: "Réservation / arrivée", status: "Exécutable si complet", fields: "Chambre, arrivée, client, départ ou ouvert, prix/default" },
  ],
} satisfies Record<Locale, Array<{ name: string; status: string; fields: string }>>;

const riskVariant: Record<RiskLevel, "success" | "warning" | "destructive" | "secondary"> = {
  low: "success",
  medium: "warning",
  high: "destructive",
  blocked: "destructive",
};

function safeJson(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function AssistantOperationsCenter({ locale, userRole }: { locale: Locale; userRole: UserRole }) {
  const t = copy[locale];
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<OperationDraft | null>(null);
  const [validation, setValidation] = useState<OperationValidation | null>(null);
  const [result, setResult] = useState<OperationResult | null>(null);
  const [history, setHistory] = useState<AuditOperation[]>([]);
  const [insights, setInsights] = useState<OperationInsight[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState<"draft" | "validate" | "confirm" | "history" | "insights" | null>(null);
  const [error, setError] = useState("");

  const canConfirm = Boolean(draft && validation?.ok && draft.executable);
  const visibleRisk = validation?.riskLevel ?? draft?.riskLevel ?? "blocked";

  const stats = useMemo(() => [
    { label: t.risk, value: visibleRisk, tone: visibleRisk === "low" ? "green" : visibleRisk === "blocked" ? "red" : "amber", icon: ShieldCheck },
    { label: t.rooms, value: draft?.roomNumbers.length ? draft.roomNumbers.join(", ") : "-", tone: "blue", icon: ClipboardCheck },
    { label: t.permission, value: draft?.permissions.join(", ") || "-", tone: "neutral", icon: CheckCircle2 },
  ] as const, [draft, t, visibleRisk]);

  const loadHistory = async () => {
    setLoading("history");
    try {
      const res = await fetch("/api/assistant/operations/history?limit=12");
      const data = await res.json();
      setHistory(data.operations ?? []);
    } finally {
      setLoading(null);
    }
  };

  const loadInsights = async () => {
    setLoading("insights");
    try {
      const res = await fetch(`/api/assistant/operations/insights?locale=${locale}`);
      const data = await res.json();
      setInsights(data.insights ?? []);
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    void loadHistory();
    void loadInsights();
  }, [locale]);

  const generateDraft = async () => {
    const text = message.trim();
    if (!text) return;
    setError("");
    setResult(null);
    setValidation(null);
    setLoading("draft");
    try {
      const res = await fetch("/api/assistant/operations/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, locale, previousDraft: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "draftFailed");
      if (!data.draft) {
        setDraft(null);
        setError(t.supported);
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: "user", content: text }, { id: crypto.randomUUID(), role: "assistant", content: t.supported }]);
        return;
      }
      setDraft(data.draft);
      const nextMissing = data.draft.missing?.length ? `${t.missing}: ${data.draft.missing.join(", ")}` : t.executable;
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: "user", content: text }, { id: crypto.randomUUID(), role: "assistant", content: `${data.draft.summary}\n${nextMissing}` }]);
      setMessage("");
      await validateDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "draftFailed");
    } finally {
      setLoading(null);
    }
  };

  const validateDraft = async (target = draft) => {
    if (!target) return;
    setLoading("validate");
    try {
      const res = await fetch("/api/assistant/operations/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "validateFailed");
      setValidation(data.validation ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "validateFailed");
    } finally {
      setLoading(null);
    }
  };

  const confirmDraft = async () => {
    if (!draft) return;
    setLoading("confirm");
    setError("");
    try {
      const res = await fetch("/api/assistant/operations/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.result?.message ?? data.error ?? "confirmFailed");
      setResult(data.result);
      await loadHistory();
      await loadInsights();
    } catch (err) {
      setError(err instanceof Error ? err.message : "confirmFailed");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        description={t.description}
        action={<Badge variant="outline">{t.role}: {userRole}</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        {stats.map((item) => (
          <StatTile key={item.label} label={item.label} value={item.value} tone={item.tone} icon={item.icon} />
        ))}
      </div>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <label className="mb-2 block text-xs font-semibold text-muted-foreground">{t.inputLabel}</label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t.placeholder}
              rows={4}
              className={cn(controlClass, "h-auto min-h-[112px] w-full resize-none overflow-y-auto text-sm leading-6")}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={generateDraft} disabled={loading != null || !message.trim()}>
                {loading === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t.generate}
              </Button>
              <Button variant="secondary" onClick={() => validateDraft()} disabled={!draft || loading != null}>
                <ShieldCheck className="h-4 w-4" />
                {t.validate}
              </Button>
              <Button onClick={confirmDraft} disabled={!canConfirm || loading != null}>
                {loading === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t.confirm}
              </Button>
              <Button variant="ghost" onClick={() => { setDraft(null); setValidation(null); setResult(null); setMessages([]); }} disabled={loading != null}>
                <RotateCcw className="h-4 w-4" />
                {t.clearContext}
              </Button>
            </div>
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-accentRed-100 bg-accentRed-50 px-3 py-2 text-xs text-accentRed-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <ConversationPanel messages={messages} locale={locale} />
          <DraftPanel draft={draft} validation={validation} locale={locale} />
          <ResultPanel result={result} locale={locale} />
        </div>

        <div className="space-y-4">
          <InsightPanel insights={insights} loading={loading === "insights"} locale={locale} onUse={(text) => setMessage(text)} />
          <CapabilityPanel locale={locale} />
          <HistoryPanel history={history} loading={loading === "history"} locale={locale} />
        </div>
      </section>
    </div>
  );
}

function ConversationPanel({ messages, locale }: { messages: ChatMessage[]; locale: Locale }) {
  const t = copy[locale];
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <MessageSquareText className="h-4 w-4 text-muted-foreground" />
        {t.conversation}
      </h2>
      {messages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{t.noConversation}</p>
      ) : (
        <div className="space-y-2">
          {messages.slice(-8).map((item) => (
            <div key={item.id} className={cn(
              "max-w-[92%] whitespace-pre-line rounded-lg border px-3 py-2 text-sm leading-6",
              item.role === "user" ? "ml-auto border-foreground bg-foreground text-background" : "border-border bg-muted/40 text-foreground",
            )}>
              {item.content}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InsightPanel({ insights, loading, locale, onUse }: { insights: OperationInsight[]; loading: boolean; locale: Locale; onUse: (text: string) => void }) {
  const t = copy[locale];
  const variant: Record<OperationInsight["severity"], "destructive" | "warning" | "secondary"> = {
    high: "destructive",
    medium: "warning",
    low: "secondary",
  };
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
          {t.insights}
        </h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-2">
        {insights.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">{t.noInsights}</p>
        ) : insights.slice(0, 8).map((item) => (
          <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{item.title}</span>
              <Badge variant={variant[item.severity]}>{item.severity}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            <Button variant="ghost" size="sm" className="mt-2 h-8 px-2 text-xs" onClick={() => onUse(item.actionHint)}>
              <Send className="h-3.5 w-3.5" />
              {t.useHint}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CapabilityPanel({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-semibold">{t.capabilityTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.capabilityHint}</p>
      </div>
      <div className="space-y-2">
        {capabilities[locale].map((item) => (
          <div key={item.name} className="rounded-lg border border-border/70 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{item.name}</span>
              <Badge variant={item.status.includes("可执行") || item.status.includes("Exécutable") ? "success" : "warning"}>{item.status}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.fields}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-accentBlue-100 bg-accentBlue-50 px-3 py-2 text-xs leading-5 text-accentBlue-800">
        <p className="font-semibold">{t.askBackTitle}</p>
        <p className="mt-1">{t.askBackBody}</p>
      </div>
    </section>
  );
}

function DraftPanel({ draft, validation, locale }: { draft: OperationDraft | null; validation: OperationValidation | null; locale: Locale }) {
  const t = copy[locale];
  if (!draft) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-card">
        {t.noDraft}
      </section>
    );
  }

  const missing = validation?.missing ?? draft.missing;
  const warnings = validation?.warnings ?? draft.warnings;
  const changes = validation?.changes ?? draft.changes;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t.draft}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{draft.summary}</p>
        </div>
        <Badge variant={riskVariant[validation?.riskLevel ?? draft.riskLevel]}>
          {validation?.ok ? t.executable : t.blocked}
        </Badge>
      </div>

      {(missing.length > 0 || warnings.length > 0) && (
        <div className="grid gap-2 md:grid-cols-2">
          {missing.length > 0 && <InfoBox title={t.missing} items={missing} tone="red" />}
          {warnings.length > 0 && <InfoBox title={t.warnings} items={warnings} tone="amber" />}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t.changes}</h3>
        <BusinessTable minWidth="min-w-[720px]">
          <BusinessThead>
            <tr>
              <BusinessTh>{t.table}</BusinessTh>
              <BusinessTh>{t.action}</BusinessTh>
              <BusinessTh>{t.record}</BusinessTh>
              <BusinessTh>{t.before}</BusinessTh>
              <BusinessTh>{t.after}</BusinessTh>
            </tr>
          </BusinessThead>
          <BusinessTbody>
            {changes.length === 0 ? (
              <tr><td colSpan={5} className={businessEmptyCell}>{t.noDraft}</td></tr>
            ) : changes.map((change, index) => (
              <BusinessRow key={`${change.entityId ?? index}`}>
                <BusinessTd>{change.table}</BusinessTd>
                <BusinessTd><Badge variant="secondary">{change.type}</Badge></BusinessTd>
                <BusinessTd className="font-mono text-xs">{change.label ?? change.entityId ?? "-"}</BusinessTd>
                <BusinessTd className="max-w-[180px] truncate text-xs text-muted-foreground">{safeJson(change.before)}</BusinessTd>
                <BusinessTd className="max-w-[180px] truncate text-xs text-muted-foreground">{safeJson(change.after)}</BusinessTd>
              </BusinessRow>
            ))}
          </BusinessTbody>
        </BusinessTable>
      </div>
    </section>
  );
}

function ResultPanel({ result, locale }: { result: OperationResult | null; locale: Locale }) {
  if (!result) return null;
  const t = copy[locale];
  return (
    <section className="rounded-xl border border-accentGreen-100 bg-accentGreen-50/60 p-4 shadow-card">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-accentGreen-700" />
        <div>
          <h2 className="text-sm font-semibold text-accentGreen-800">{t.result}</h2>
          <p className="mt-1 text-sm text-accentGreen-800/85">{result.message}</p>
          <p className="mt-2 text-xs text-accentGreen-800/70">
            {t.changes}: {result.affectedRecords.length}
          </p>
        </div>
      </div>
    </section>
  );
}

function HistoryPanel({ history, loading, locale }: { history: AuditOperation[]; loading: boolean; locale: Locale }) {
  const t = copy[locale];
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <History className="h-4 w-4 text-muted-foreground" />
          {t.history}
        </h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-2">
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">{t.noHistory}</p>
        ) : history.map((item) => (
          <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{item.entity_label ?? item.action}</span>
              <Badge variant="success">{item.action}</Badge>
            </div>
            <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
              <span>{t.time}: {String(item.created_at).slice(0, 16).replace("T", " ")}</span>
              <span>{t.actor}: {item.actor_email ?? item.actor_role ?? "-"}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InfoBox({ title, items, tone }: { title: string; items: string[]; tone: "amber" | "red" }) {
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2 text-xs",
      tone === "amber" ? "border-accentAmber-100 bg-accentAmber-50 text-accentAmber-800" : "border-accentRed-100 bg-accentRed-50 text-accentRed-700",
    )}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
