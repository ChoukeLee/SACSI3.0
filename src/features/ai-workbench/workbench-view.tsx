"use client";

import { type ClipboardEvent, type DragEvent, type FormEvent, useActionState, useEffect, useRef, useState } from "react";
import { ArrowUp, CheckCircle2, Clock3, Database, ImageIcon, LockKeyhole, Paperclip, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { OperationalPage, StatTile } from "@/components/ui/operational";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import { ReceiptUpload } from "@/features/finance/receipt-upload";
import type { ConversationTurnSummary } from "./conversation-service";
import { askWorkbench, confirmWorkbenchAction, discardWorkbenchProposal } from "./actions";
import { INITIAL_WORKBENCH_STATE, type WorkbenchActionResult, type WorkbenchDraftPreview, type WorkbenchResult, type WorkbenchTone } from "./types";

const ALLOWED_RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

interface ReceiptTurn {
  id: number;
  file: File;
  prompt: string;
}

// Suggestions stay functional for the parser in each locale.
const SUGGESTIONS: Record<Locale, string[]> = {
  zh: [
    "今天日租房态",
    "11#今天退房名单",
    "长租30天内缴租截至",
    "11#长租逾期明细",
    "出售15天内应缴",
    "查看11#503的合同和收款",
    "11#906保洁已完成",
  ],
  fr: [
    "état journalier aujourd'hui",
    "départs du jour 11#",
    "baux expirant sous 30 jours",
    "retards bail 11#",
    "échéances vente sous 15 jours",
    "contrat et paiements du 11#503",
    "ménage terminé 11#906",
  ],
};

const COPY: Record<Locale, Record<string, string>> = {
  zh: {
    eyebrow: "业务查询",
    description: "用自然语言查询系统记录，或从凭证生成受控财务草稿；所有写操作必须人工确认后才会执行。",
    badge: "查询 + 受控执行",
    askTitle: "查询事实或描述要办理的事项",
    askHint: "写明业务、楼栋、房号、日期和动作，系统会先核对再给出结果或草稿。",
    askLabel: "要查询的问题",
    placeholder: "例如：11#长租有哪些逾期？",
    xofNote: "金额统一以 XOF（西非法郎）展示",
    attach: "添加凭证图片",
    attachmentHint: "支持粘贴、拖入或选择 JPEG / PNG / WebP，最大 10 MB",
    invalidImage: "仅支持 JPEG、PNG 或 WebP 图片。",
    imageTooLarge: "图片不能超过 10 MB。",
    removeImage: "移除图片",
    receiptTurn: "财务凭证识别",
    receiptPromptFallback: "请识别这张凭证并生成入账草稿。",
    closeReceiptTurn: "关闭本次凭证处理",
    receiptActive: "请先完成或关闭当前凭证处理，再添加新图片。",
    historyTitle: "最近对话",
    restoredHistory: "已从安全会话记录恢复",
    submitting: "正在核对记录",
    submit: "提交",
    examples: "常用查询",
    examplesNote: "",
    boundaryTitle: "工作台边界",
    boundaryLiveTitle: "系统实时记录",
    boundaryLiveText: "读取当前账号有权查看的数据，不使用模型记忆补数。",
    boundaryRulesTitle: "固定业务口径",
    boundaryRulesText: "应收、未收、逾期和房态沿用系统统一计算规则。",
    boundaryConfirmTitle: "先草稿、后确认",
    boundaryConfirmText: "保洁与财务凭证均先生成不可变草稿，按当前登录身份确认后调用原子 RPC，并自动复查结果。",
    boundaryModelTitle: "最小化模型输入",
    boundaryModelText: "仅在本地规则无法识别时发送问题文字；数据库记录和查询结果不会发送。",
    errorTitle: "查询未完成",
    draftKind: "操作草稿",
    draftTarget: "操作对象",
    draftBefore: "修改前状态",
    draftEffects: "预期影响",
    confirmTitle: "人工确认",
    confirmExecuting: "正在执行并复查…",
    confirm: "确认执行",
    discard: "放弃此草稿",
    discardPending: "正在作废草稿…",
    resultKind: "执行结果",
    actionTarget: "操作对象",
    verifyTitle: "执行后复查（重新查询数据库）",
    nextTitle: "下一步",
    nextText: "已执行的 L1 操作会写入真实操作人的审计记录。可直接在上方输入框继续查询或办理其他事项。",
    loadingTitle: "正在核对业务记录与统计口径…",
    queryKind: "查询结果",
    emptyRows: "没有符合当前口径的记录",
    evidenceTitle: "本次口径与证据",
  },
  fr: {
    eyebrow: "Consultation métier",
    description: "Interrogez les enregistrements ou créez un brouillon financier depuis un reçu ; toute écriture exige une confirmation humaine.",
    badge: "Consultation + exécution contrôlée",
    askTitle: "Interrogez les faits ou décrivez l'opération",
    askHint: "Indiquez le secteur, le bâtiment, la chambre, la date et l'action ; le système vérifie avant de répondre ou de proposer un brouillon.",
    askLabel: "Votre question",
    placeholder: "Ex. : 11#长租有哪些逾期 ?",
    xofNote: "Montants affichés en XOF (franc CFA)",
    attach: "Ajouter une image",
    attachmentHint: "Collez, déposez ou choisissez un JPEG / PNG / WebP de 10 Mo maximum",
    invalidImage: "Seules les images JPEG, PNG et WebP sont acceptées.",
    imageTooLarge: "L’image ne doit pas dépasser 10 Mo.",
    removeImage: "Retirer l’image",
    receiptTurn: "Analyse du justificatif",
    receiptPromptFallback: "Analysez ce justificatif et préparez un brouillon comptable.",
    closeReceiptTurn: "Fermer ce traitement",
    receiptActive: "Terminez ou fermez le justificatif en cours avant d’ajouter une autre image.",
    historyTitle: "Conversation récente",
    restoredHistory: "Restaurée depuis l’historique sécurisé",
    submitting: "Vérification en cours…",
    submit: "Envoyer",
    examples: "Exemples de requêtes",
    examplesNote: "",
    boundaryTitle: "Limites du poste",
    boundaryLiveTitle: "Enregistrements réels",
    boundaryLiveText: "Lit uniquement les données visibles par votre profil ; jamais de mémoire du modèle.",
    boundaryRulesTitle: "Règles métier fixes",
    boundaryRulesText: "Créances, reste dû, retards et états suivent les calculs unifiés du système.",
    boundaryConfirmTitle: "Brouillon puis confirmation",
    boundaryConfirmText: "Le ménage et les reçus financiers créent un brouillon immuable, confirmé avec votre session, exécuté par RPC atomique puis vérifié.",
    boundaryModelTitle: "Entrée modèle minimale",
    boundaryModelText: "Seul le texte de la question est envoyé quand les règles locales échouent ; jamais les enregistrements ni les résultats.",
    errorTitle: "Requête non aboutie",
    draftKind: "Brouillon d'action",
    draftTarget: "Cible",
    draftBefore: "État avant",
    draftEffects: "Effets attendus",
    confirmTitle: "Confirmation",
    confirmExecuting: "Exécution et vérification…",
    confirm: "Confirmer et exécuter",
    discard: "Abandonner ce brouillon",
    discardPending: "Abandon en cours…",
    resultKind: "Résultat",
    actionTarget: "Cible",
    verifyTitle: "Vérification après exécution (base relue)",
    nextTitle: "Suite",
    nextText: "L'opération L1 est écrite dans l'audit avec l'opérateur réel. Continuez à interroger dans le champ ci-dessus.",
    loadingTitle: "Vérification des enregistrements et des règles…",
    queryKind: "Résultat",
    emptyRows: "Aucune ligne selon le périmètre actuel",
    evidenceTitle: "Périmètre et preuves",
  },
};

const toneBorder: Record<WorkbenchTone, string> = {
  neutral: "border-border",
  blue: "border-l-accentBlue-500",
  green: "border-l-accentGreen-500",
  amber: "border-l-accentAmber-500",
  red: "border-l-accentRed-500",
  purple: "border-l-accentPurple-500",
  teal: "border-l-[#5CC4B8]",
};

export function AiWorkbenchView({
  locale = "zh",
  conversationId,
  initialHistory = [],
  canRecordFinance = false,
}: {
  locale?: Locale;
  conversationId: string;
  initialHistory?: ConversationTurnSummary[];
  canRecordFinance?: boolean;
}) {
  const t = COPY[locale];
  const suggestions = SUGGESTIONS[locale];
  const [query, setQuery] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState("");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [receiptTurn, setReceiptTurn] = useState<ReceiptTurn | null>(null);
  const [state, formAction, pending] = useActionState(askWorkbench, INITIAL_WORKBENCH_STATE);
  const resultRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!attachment) {
      setAttachmentPreview("");
      return;
    }
    const objectUrl = URL.createObjectURL(attachment);
    setAttachmentPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [attachment]);

  useEffect(() => {
    if (state.status !== "idle") {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }, [state]);

  const acceptAttachment = (file: File) => {
    if (!canRecordFinance) return;
    if (receiptTurn) {
      setAttachmentError(t.receiptActive);
      return;
    }
    if (!ALLOWED_RECEIPT_TYPES.has(file.type)) {
      setAttachmentError(t.invalidImage);
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      setAttachmentError(t.imageTooLarge);
      return;
    }
    setAttachment(file);
    setAttachmentError(null);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (!image) return;
    acceptAttachment(image);
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const image = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/"));
    if (image) acceptAttachment(image);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!attachment) return;
    event.preventDefault();
    setReceiptTurn({ id: Date.now(), file: attachment, prompt: query.trim() });
    setAttachment(null);
    setAttachmentError(null);
    setQuery("");
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  return (
    <OperationalPage
      eyebrow={t.eyebrow}
      title="AI Workbench"
      description={t.description}
      action={
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accentGreen-100 bg-accentGreen-50 px-3 text-xs font-semibold text-accentGreen-700">
          <LockKeyhole className="h-3.5 w-3.5" />{t.badge}
        </span>
      }
      className="mx-auto max-w-[1500px]"
    >
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <form action={formAction} onSubmit={handleSubmit} className="p-5 sm:p-7">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="conversation_id" value={conversationId} />
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold">{t.askTitle}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.askHint}</p>
              </div>
            </div>

            <label htmlFor="ai-workbench-query" className="sr-only">{t.askLabel}</label>
            <div
              className={cn("rounded-xl border border-border-strong bg-background/55 p-2 transition-all focus-within:border-ring focus-within:shadow-glow", dragging && "border-accentBlue-500 bg-accentBlue-50/45 shadow-glow")}
              onDragEnter={(event) => { if (canRecordFinance) { event.preventDefault(); setDragging(true); } }}
              onDragOver={(event) => { if (canRecordFinance) event.preventDefault(); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={handleDrop}
            >
              <textarea
                id="ai-workbench-query"
                name="query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onPaste={handlePaste}
                rows={3}
                maxLength={500}
                placeholder={t.placeholder}
                className="min-h-[92px] w-full resize-none bg-transparent px-2.5 py-2 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-[15px]"
              />
              {attachment && (
                <div className="mx-1 mb-2 flex items-center gap-3 rounded-lg border border-border bg-card p-2 shadow-xs">
                  {attachmentPreview
                    ? <img src={attachmentPreview} alt="" className="h-12 w-12 rounded-md border border-border object-cover" />
                    : <span className="flex h-12 w-12 items-center justify-center rounded-md bg-muted"><ImageIcon className="h-5 w-5 text-muted-foreground" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{attachment.name}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{(attachment.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button type="button" onClick={() => setAttachment(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t.removeImage}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              {attachmentError && <p className="mx-2 mb-2 text-xs text-accentRed-700" role="alert">{attachmentError}</p>}
              <div className="flex items-center justify-between gap-3 border-t border-border/70 px-1 pt-2">
                <div className="flex min-w-0 items-center gap-2">
                  {canRecordFinance && !receiptTurn && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) acceptAttachment(file);
                          event.target.value = "";
                        }}
                      />
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={t.attach} title={t.attachmentHint}>
                        <Paperclip className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{attachment ? t.attachmentHint : t.xofNote}</span>
                </div>
                <button
                  type="submit"
                  disabled={pending || (!attachment && query.trim().length < 2)}
                  className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {pending ? <Clock3 className="h-4 w-4 animate-pulse" /> : <ArrowUp className="h-4 w-4" />}
                  {pending ? t.submitting : t.submit}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex flex-wrap gap-2" aria-label={t.examples}>
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
              {t.examplesNote && <p className="mt-2 text-[11px] text-muted-foreground">{t.examplesNote}</p>}
            </div>
          </form>

          <aside className="border-t border-border bg-muted/35 p-5 lg:border-l lg:border-t-0" aria-label={t.boundaryTitle}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t.boundaryTitle}</p>
            <div className="mt-4 space-y-4">
              <Boundary icon={Database} title={t.boundaryLiveTitle} text={t.boundaryLiveText} />
              <Boundary icon={ShieldCheck} title={t.boundaryRulesTitle} text={t.boundaryRulesText} />
              <Boundary icon={LockKeyhole} title={t.boundaryConfirmTitle} text={t.boundaryConfirmText} />
              <Boundary icon={Sparkles} title={t.boundaryModelTitle} text={t.boundaryModelText} />
            </div>
          </aside>
        </div>
      </section>

      <div ref={resultRef} className="scroll-mt-16">
        {initialHistory.length > 0 && <ConversationHistory turns={initialHistory} t={t} />}
        {receiptTurn && (
          <ReceiptConversation
            key={receiptTurn.id}
            locale={locale}
            turn={receiptTurn}
            t={t}
            conversationId={conversationId}
            onClose={() => setReceiptTurn(null)}
          />
        )}
        {pending && <LoadingResult t={t} />}
        {!pending && state.status === "error" && (
          <section className="rounded-xl border border-accentRed-100 bg-accentRed-50 p-5 text-sm text-accentRed-700" role="status" aria-atomic="true">
            <p className="font-semibold">{t.errorTitle}</p>
            <p className="mt-1 leading-6">{state.error}</p>
          </section>
        )}
        {!pending && state.result?.kind === "query_result" && <WorkbenchResultView t={t} result={state.result} />}
        {!pending && state.result?.kind === "action_draft" && <WorkbenchDraftFlow key={state.result.execution.taskId} t={t} locale={locale} draft={state.result} />}
      </div>
    </OperationalPage>
  );
}

function ConversationHistory({ turns, t }: { turns: ConversationTurnSummary[]; t: Record<string, string> }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-labelledby="conversation-history-title">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3 sm:px-6">
        <h2 id="conversation-history-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.historyTitle}</h2>
        <span className="text-[11px] text-muted-foreground">{t.restoredHistory}</span>
      </div>
      <div className="max-h-[420px] space-y-4 overflow-y-auto p-4 sm:p-6">
        {turns.map((turn) => (
          <article key={turn.id} className="space-y-2">
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground">{turn.userText}</div>
            <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-muted/35 px-4 py-2.5 text-sm leading-6 text-foreground/85">{turn.assistantText}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReceiptConversation({ locale, turn, t, conversationId, onClose }: { locale: Locale; turn: ReceiptTurn; t: Record<string, string>; conversationId: string; onClose: () => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-labelledby={`receipt-turn-${turn.id}`}>
      <div className="border-b border-border bg-muted/25 px-4 py-4 sm:px-6">
        <div className="ml-auto max-w-xl rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/12"><ImageIcon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{turn.file.name}</p>
              <p className="mt-1 text-xs leading-5 text-primary-foreground/75">{turn.prompt || t.receiptPromptFallback}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accentGreen-50 text-accentGreen-700"><Sparkles className="h-4 w-4" /></span>
            <h2 id={`receipt-turn-${turn.id}`} className="text-sm font-semibold">{t.receiptTurn}</h2>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={t.closeReceiptTurn}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <ReceiptUpload
          locale={locale}
          conversationId={conversationId}
          initialFile={turn.file}
          initialText={turn.prompt}
          autoScan
          onClose={onClose}
        />
      </div>
    </section>
  );
}

function WorkbenchDraftFlow({ t, locale, draft }: { t: Record<string, string>; locale: Locale; draft: WorkbenchDraftPreview }) {
  const [state, formAction, pending] = useActionState(confirmWorkbenchAction, INITIAL_WORKBENCH_STATE);
  const [discardState, discardFormAction, discardPending] = useActionState(discardWorkbenchProposal, INITIAL_WORKBENCH_STATE);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (discardState.status === "success") setDismissed(true);
  }, [discardState.status]);
  if (dismissed) return null;
  if (state.status === "success" && state.result?.kind === "action_result") {
    return <WorkbenchActionResultView t={t} result={state.result} />;
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-accentAmber-100 bg-card shadow-card">
        <div className="border-b border-border px-5 py-5 sm:px-6" role="status" aria-atomic="true">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentAmber-50 text-accentAmber-600"><Sparkles className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium text-muted-foreground">{t.draftKind}</p><span className="rounded-full border border-accentAmber-100 bg-accentAmber-50 px-2 py-0.5 text-[11px] font-semibold text-accentAmber-700">{draft.risk}</span></div>
              <h2 className="mt-1 text-lg font-semibold">{draft.title}</h2>
              <p className="mt-2 text-sm leading-7 text-foreground/85">{draft.summary}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <EvidenceGroup title={t.draftTarget} items={draft.target} />
          <EvidenceGroup title={t.draftBefore} items={draft.beforeState} />
        </div>
        <div className="border-t border-border px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold text-muted-foreground">{t.draftEffects}</p>
          <ol className="mt-3 space-y-2">{draft.expectedEffects.map((effect, index) => <li key={effect} className="flex gap-2 text-sm leading-6"><span className="text-muted-foreground">{index + 1}.</span><span>{effect}</span></li>)}</ol>
        </div>
      </section>

      <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t.confirmTitle}</p>
        <div className="mt-4 rounded-lg border border-accentAmber-100 bg-accentAmber-50 p-3 text-xs leading-5 text-accentAmber-700">{draft.confirmationNote}</div>
        {draft.warnings.map((warning) => <p key={warning} className="mt-3 text-xs leading-5 text-muted-foreground">{warning}</p>)}
        {state.status === "error" && (
          <p className="mt-4 rounded-lg border border-accentRed-100 bg-accentRed-50 p-3 text-xs leading-5 text-accentRed-700" role="alert">{state.error}</p>
        )}
        <form action={formAction} className="mt-5 space-y-2.5">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="execution_action" value={draft.execution.action} />
          <input type="hidden" name="task_id" value={draft.execution.taskId} />
          <input type="hidden" name="unit_id" value={draft.execution.unitId} />
          <input type="hidden" name="building_code" value={draft.execution.buildingCode} />
          <input type="hidden" name="unit_no" value={draft.execution.unitNo} />
          <input type="hidden" name="proposal_id" value={draft.execution.proposalId ?? ""} />
          <input type="hidden" name="proposal_version" value={String(draft.execution.proposalVersion ?? "")} />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {pending ? <Clock3 className="h-4 w-4 animate-pulse" /> : <CheckCircle2 className="h-4 w-4" />}
            {pending ? t.confirmExecuting : t.confirm}
          </button>
        </form>
        {discardState.status === "error" && (
          <p className="mt-4 rounded-lg border border-accentRed-100 bg-accentRed-50 p-3 text-xs leading-5 text-accentRed-700" role="alert">{discardState.error}</p>
        )}
        <form action={discardFormAction} className="mt-2.5">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="proposal_id" value={draft.execution.proposalId ?? ""} />
          <input type="hidden" name="proposal_version" value={String(draft.execution.proposalVersion ?? "")} />
          <button
            type="submit"
            disabled={discardPending}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
          >
            {discardPending ? t.discardPending : t.discard}
          </button>
        </form>
      </aside>
    </div>
  );
}

function WorkbenchActionResultView({ t, result }: { t: Record<string, string>; result: WorkbenchActionResult }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-accentGreen-100 bg-card shadow-card">
        <div className="border-b border-border px-5 py-5 sm:px-6" role="status" aria-atomic="true">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentGreen-50 text-accentGreen-600"><CheckCircle2 className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium text-muted-foreground">{t.resultKind}</p><span className="rounded-full border border-accentGreen-100 bg-accentGreen-50 px-2 py-0.5 text-[11px] font-semibold text-accentGreen-700">{result.risk}</span></div>
              <h2 className="mt-1 text-lg font-semibold">{result.title}</h2>
              <p className="mt-2 text-sm leading-7 text-foreground/85">{result.summary}</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <EvidenceGroup title={t.actionTarget} items={result.target} />
          <div className="mt-5">
            <p className="text-xs font-semibold text-muted-foreground">{t.verifyTitle}</p>
            <dl className="mt-3 divide-y divide-border/70 rounded-lg border border-border px-3">
              {result.verification.map((item) => <div key={`${item.label}-${item.value}`} className="flex items-start justify-between gap-4 py-3"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="text-right text-xs font-medium leading-5">{item.value}</dd></div>)}
            </dl>
          </div>
          {result.warnings.length > 0 && <div className="mt-4 rounded-lg border border-accentRed-100 bg-accentRed-50 p-3">{result.warnings.map((warning) => <p key={warning} className="text-xs leading-5 text-accentRed-700">{warning}</p>)}</div>}
        </div>
      </section>
      <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t.nextTitle}</p>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{t.nextText}</p>
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

function LoadingResult({ t }: { t: Record<string, string> }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-card" role="status">
      <div className="flex items-center gap-3"><Search className="h-4 w-4 animate-pulse text-accentBlue-500" /><p className="text-sm font-semibold">{t.loadingTitle}</p></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-20 animate-pulse rounded-lg bg-muted" /></div>
    </section>
  );
}

function WorkbenchResultView({ t, result }: { t: Record<string, string>; result: WorkbenchResult }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="border-b border-border px-5 py-5 sm:px-6" role="status" aria-atomic="true">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accentGreen-50 text-accentGreen-600"><CheckCircle2 className="h-4 w-4" /></span>
            <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{t.queryKind}</p><h2 className="mt-1 text-lg font-semibold">{result.title}</h2><p className="mt-2 text-sm leading-7 text-foreground/85">{result.answer}</p></div>
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
                )) : <tr><td colSpan={result.table.columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">{t.emptyRows}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t.evidenceTitle}</p>
        <dl className="mt-4 divide-y divide-border/70">
          {result.evidence.map((item) => <div key={`${item.label}-${item.value}`} className="py-3 first:pt-0"><dt className="text-[11px] font-medium text-muted-foreground">{item.label}</dt><dd className="mt-1 text-xs font-medium leading-5 text-foreground">{item.value}</dd></div>)}
        </dl>
        {result.warnings.length > 0 && <div className="mt-4 rounded-lg border border-accentAmber-100 bg-accentAmber-50 p-3">{result.warnings.map((warning) => <p key={warning} className="text-xs leading-5 text-accentAmber-700">{warning}</p>)}</div>}
      </aside>
    </div>
  );
}
