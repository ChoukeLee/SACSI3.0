import "server-only";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { confirmationsEnabled, confirmationIdValid } from "./operator-confirmation-http";
import { collectionPreview, parseCollectionRequest } from "./operator-batch";
import { buildPaymentPreview } from "./operator-payment-preview";
import { isBookingOperation } from "./booking-operation-contract";
import { OperatorConfirmationPanel } from "./operator-confirmation-panel";
import { OperatorCollectionPanel } from "./operator-collection-panel";
import { DailyWorkflowPanel, type DailyWorkflowDisplay } from "./operator-daily-workflow-panel";
import { BookingOperationPanel } from "./operator-booking-operation-panel";
import type { OperatorInboxKind } from "./operator-inbox-model";
import type { OperatorLocale } from "./operator-inbox-panel-labels";
function validDailyPlan(raw: unknown): raw is DailyWorkflowDisplay {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  return (
    ["extend_and_collect", "checkout_and_collect"].includes(String(p.operation)) &&
    [
      "unitCode",
      "checkIn",
      "scheduledCheckOutBefore",
      "scheduledCheckOutAfter",
      "paymentDate",
      "paymentMethod",
    ].every((key) => typeof p[key] === "string") &&
    ["totalBefore", "totalAfter", "paidBefore", "paidAfter", "outstandingAfter", "amountXof"].every(
      (key) => typeof p[key] === "number" && Number.isSafeInteger(p[key]) && Number(p[key]) >= 0,
    ) &&
    (p.guestName === null || typeof p.guestName === "string") &&
    (p.actualCheckOutAfter === null || typeof p.actualCheckOutAfter === "string") &&
    typeof p.cleaningRequired === "boolean"
  );
}
export async function OperatorInboxDetailPage({
  id,
  kind,
  locale,
}: {
  id: string;
  kind: OperatorInboxKind;
  locale: OperatorLocale;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr),
    base = locale === "fr" ? "/fr" : "";
  if (!confirmationIdValid(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`${base}/operator/${kind}/${id}`)}`);
  let content;
  if (!confirmationsEnabled())
    content = (
      <p role="status">
        {text(
          "确认功能尚未启用，请保留原操作号联系维护者。",
          "Les confirmations ne sont pas activées. Conservez l’identifiant d’origine et contactez l’assistance.",
        )}
      </p>
    );
  else {
    const db = await createClient();
    const target =
      kind === "confirmations"
        ? ["get_operator_payment_confirmation", { p_id: id }]
        : kind === "collections"
          ? ["get_operator_collection", { p_id: id }]
          : kind === "daily-workflows"
            ? ["get_daily_workflow", { p_id: id }]
            : ["operator_booking_operation", { p_mode: "get", p_id: id }];
    try {
      const { data, error } = await db.rpc(
        target[0] as string,
        target[1] as Record<string, string>,
      );
      if (
        error ||
        !data ||
        typeof data !== "object" ||
        !["pending", "completed", "superseded"].includes(data.status)
      )
        throw new Error("InvalidConfirmation");
      const expiry = kind === "confirmations" ? data.expiresAt : data.expires_at;
      if (typeof expiry !== "string" || !Number.isFinite(Date.parse(expiry)))
        throw new Error("InvalidExpiry");
      const actor = user.email || user.id;
      if (kind === "confirmations") {
        if (data.status === "superseded")
          content = (
            <section className="space-y-3 rounded-xl border bg-card p-6">
              <h1 className="text-xl font-semibold">
                {text("此确认单已作废", "Cette confirmation a été remplacée")}
              </h1>
              <p>
                {text(
                  "内容已重新准备。旧页面不能再入账，请打开新单并重新核对。",
                  "Le contenu a été préparé à nouveau. L’ancien document ne peut plus être exécuté ; ouvrez le nouveau document pour le vérifier.",
                )}
              </p>
              {confirmationIdValid(data.replacementId) && (
                <Link
                  href={`${base}/operator/confirmations/${data.replacementId}`}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {text("查看新确认单", "Ouvrir la nouvelle confirmation")}
                </Link>
              )}
            </section>
          );
        else {
          const preview = buildPaymentPreview(data.request, data.snapshot);
          if (!preview.success) throw new Error("InvalidPreview");
          content = (
            <OperatorConfirmationPanel
              id={id}
              preview={preview.preview}
              actor={actor}
              expiresAt={expiry}
              completed={data.status === "completed"}
              locale={locale}
            />
          );
        }
      } else if (kind === "collections") {
        const request = parseCollectionRequest(data.request_data);
        content = (
          <OperatorCollectionPanel
            id={id}
            rows={collectionPreview(request, data.expected_snapshot)}
            totalXof={request.totalXof}
            actor={actor}
            requestId={request.requestId}
            expiresAt={expiry}
            status={data.status}
            locale={locale}
          />
        );
      } else if (kind === "daily-workflows") {
        if (
          !validDailyPlan(data.expected_snapshot?.plan) ||
          typeof data.request_id !== "string" ||
          typeof data.request_data?.originalInstruction !== "string"
        )
          throw new Error("InvalidPlan");
        content = (
          <DailyWorkflowPanel
            id={id}
            plan={data.expected_snapshot.plan}
            actor={actor}
            requestId={data.request_id}
            originalInstruction={data.request_data.originalInstruction}
            expiresAt={expiry}
            status={data.status}
            locale={locale}
          />
        );
      } else {
        if (
          !data.expected_snapshot?.plan ||
          !isBookingOperation(data.expected_snapshot.plan.operation) ||
          typeof data.request_id !== "string" ||
          typeof data.request_data?.originalInstruction !== "string"
        )
          throw new Error("InvalidPlan");
        content = (
          <BookingOperationPanel
            id={id}
            plan={data.expected_snapshot.plan}
            requestId={data.request_id}
            actor={actor}
            originalInstruction={data.request_data.originalInstruction}
            expiresAt={expiry}
            status={data.status}
            locale={locale}
          />
        );
      }
    } catch {
      content = (
        <section role="alert" className="space-y-3 rounded-xl border bg-card p-6">
          <h1 className="text-lg font-semibold">
            {text("确认单暂时无法安全展示", "Confirmation impossible à afficher en sécurité")}
          </h1>
          <p className="text-sm leading-7 text-muted-foreground">
            {text(
              "请使用创建此单的 SACSI 账号登录。读取失败、未知状态或内容不完整均不会显示为可执行；请保留原请求编号联系核对，不要重新创建收款。",
              "Connectez-vous avec le compte SACSI qui a créé ce document. Une lecture échouée, un état inconnu ou un contenu incomplet n’autorise aucune exécution. Conservez l’identifiant pour vérification, sans recréer de paiement.",
            )}
          </p>
        </section>
      );
    }
  }
  return (
    <main className="space-y-5">
      <nav
        aria-label={text("确认单导航", "Navigation de confirmation")}
        className="flex flex-wrap justify-between gap-4 text-sm"
      >
        <Link
          className="inline-flex min-h-11 items-center text-blue-700 dark:text-blue-300"
          href={`${base}/operator`}
        >
          {text("← 返回我的待办", "← Revenir à mes opérations")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-muted-foreground"
          href={`${locale === "zh" ? "/fr" : ""}/operator/${kind}/${id}`}
        >
          {locale === "zh" ? "Français" : "中文"}
        </Link>
      </nav>
      {content}
    </main>
  );
}
