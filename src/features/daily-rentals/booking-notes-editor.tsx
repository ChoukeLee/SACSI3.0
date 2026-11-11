"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import type { DailyBookingRow } from "@/types/database";
import { saveBookingNotes } from "./booking-notes-action";
import { notifyDailyDataChanged } from "./daily-read-invalidation";

const historicalMarker = "[历史补录]";

type Props = {
  booking: Pick<DailyBookingRow, "id" | "unit_id" | "notes">;
  buildingId?: string;
  locale: Locale;
  readOnly: boolean;
};

export function BookingNotesEditor(props: Props) {
  return <BookingNotes key={`${props.booking.id}:${props.booking.unit_id}`} {...props} />;
}

function editableNotes(notes: string | null) {
  return notes?.startsWith(historicalMarker)
    ? notes.slice(historicalMarker.length).trimStart()
    : (notes ?? "");
}

function BookingNotes({ booking, buildingId, locale, readOnly }: Props) {
  const zh = locale === "zh";
  const router = useRouter();
  const inputId = useId();
  const inFlight = useRef(false);
  const [confirmed, setConfirmed] = useState<{ basedOn: string | null; notes: string | null }>();
  const [edit, setEdit] = useState<{ expected: string | null; draft: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    "conflict" | "forbidden" | "invalid" | "unavailable" | "saved"
  >();
  const persistedNotes = booking.notes ?? null;
  const notes =
    confirmed && confirmed.basedOn === persistedNotes ? confirmed.notes : persistedNotes;
  const historical = (edit ? edit.expected : notes)?.startsWith(historicalMarker);
  const title = zh ? "订单备注" : "Note de réservation";
  const empty = zh ? "暂无备注" : "Aucune note";
  const tooLong = !!edit && Array.from(edit.draft.trim()).length > 4000;

  async function save() {
    if (!edit || readOnly || tooLong || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await saveBookingNotes({
        bookingId: booking.id,
        unitId: booking.unit_id,
        expectedNotes: edit.expected,
        notes: edit.draft,
      });
      if (result.status === "saved" || result.status === "conflict") {
        setConfirmed({ basedOn: persistedNotes, notes: result.notes });
        if (result.status === "conflict") {
          setEdit({ ...edit, expected: result.notes });
        } else {
          setEdit(undefined);
          notifyDailyDataChanged(buildingId);
          router.refresh();
        }
      }
      setMessage(result.status);
    } catch {
      setMessage("unavailable");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-label={title} className="min-w-40 space-y-2">
      {edit && !readOnly ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={inputId} className="block text-xs font-medium text-foreground">
            {title}
          </label>
          {historical && (
            <p className="text-xs text-muted-foreground">{zh ? "历史补录" : "Saisie historique"}</p>
          )}
          <textarea
            id={inputId}
            rows={3}
            autoFocus
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            value={edit.draft}
            disabled={busy}
            aria-invalid={tooLong || message === "invalid"}
            onChange={(event) => setEdit({ ...edit, draft: event.target.value })}
          />
          {message === "conflict" && (
            <div role="alert" className="space-y-1 text-xs text-muted-foreground">
              <p>
                {zh
                  ? "备注已有更新。请核对下方最新内容，再决定是否保存你的修改。"
                  : "La note a changé. Vérifiez la version actuelle avant d’enregistrer votre texte."}
              </p>
              <p className="whitespace-pre-wrap break-words">
                {editableNotes(edit.expected) || empty}
              </p>
            </div>
          )}
          {(tooLong || message === "invalid") && (
            <p role="alert" className="text-xs text-destructive">
              {tooLong
                ? zh
                  ? "备注最多 4000 字。"
                  : "La note est limitée à 4 000 caractères."
                : zh
                  ? "备注格式无效。"
                  : "Le format de la note est invalide."}
            </p>
          )}
          {(message === "unavailable" || message === "forbidden") && (
            <p role="alert" className="text-xs text-destructive">
              {message === "forbidden"
                ? zh
                  ? "当前账号无法修改此订单备注。"
                  : "Vous ne pouvez pas modifier cette note."
                : zh
                  ? "暂时无法保存备注，请重试。"
                  : "Enregistrement indisponible. Réessayez."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || tooLong}>
              {message === "conflict"
                ? zh
                  ? "核对后保存"
                  : "Enregistrer après vérification"
                : zh
                  ? "保存备注"
                  : "Enregistrer la note"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEdit(undefined);
                setMessage(undefined);
              }}
            >
              {zh ? "取消" : "Annuler"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            {!readOnly && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setMessage(undefined);
                  setEdit({ expected: notes, draft: editableNotes(notes) });
                }}
              >
                {editableNotes(notes)
                  ? zh
                    ? "修改备注"
                    : "Modifier la note"
                  : zh
                    ? "添加备注"
                    : "Ajouter une note"}
              </Button>
            )}
          </div>
          {historical && (
            <p className="text-xs text-muted-foreground">{zh ? "历史补录" : "Saisie historique"}</p>
          )}
          <p className="whitespace-pre-wrap break-words text-xs text-foreground/80">
            {editableNotes(notes) || empty}
          </p>
          {message === "saved" && (
            <p role="status" className="text-xs text-muted-foreground">
              {zh ? "备注已保存" : "Note enregistrée"}
            </p>
          )}
        </>
      )}
    </section>
  );
}
