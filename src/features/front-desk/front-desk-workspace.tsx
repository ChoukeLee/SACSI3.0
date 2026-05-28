"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BedDouble, LogIn, LogOut, CreditCard, Plus, Copy,
  ClipboardCheck, AlertTriangle, Check, X, Calendar, Phone, User,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import {
  checkIn, checkOut as checkoutAction, recordSupplementaryPayment,
  cancelBooking, confirmBooking,
} from "@/features/daily-rentals/actions";
import {
  computeRoomStates, getOccupiedRooms, getTodayCheckouts,
  getReservedRooms, getCleaningRooms, getAvailableRooms,
  type RoomState,
} from "@/features/mobile/room-state";

const todayStr = new Date().toISOString().slice(0, 10);

interface Props {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  locale: Locale;
  buildingName?: string;
}

type PopupAction = "checkin" | "checkout" | "payment" | "cancel" | "confirm" | null;
type MainTab = "checkins" | "occupied" | "checkouts" | "pending";

export function FrontDeskWorkspace({ dailyUnits, bookings, customers, payments, cleaningTasks, locale, buildingName = "SASCI11" }: Props) {
  const router = useRouter();
  const t = locale === "zh"
    ? { today: "今日", checkins: "今日入住", occupied: "当前在住", checkouts: "今日退房", pending: "待确认", newBooking: "新建预订", checkin: "办理入住", checkout: "退房", payment: "收款", cancel: "取消", confirm: "确认预订", roomStatus: "房态", copyShare: "复制发群", copied: "已复制", allCopy: "全部发送", room: "房", guest: "客", nights: "晚", prepaid: "已付", due: "待付", date: "日期", amount: "金额", receiptNo: "收据号", reason: "原因", save: "保存", loading: "处理中...", success: "成功", error: "失败", noData: "暂无数据", newBookingDesc: "新建日租预订", checkinDesc: "确认办理入住？", checkoutDesc: "确认退房？退房后房间进入保洁", cancelDesc: "确认取消预订？", paymentDesc: "输入补缴金额", copyDesc: "复制今日房态到剪贴板", available: "空闲", reserved: "预订", occupiedLabel: "占用", cleaning: "保洁", maintenance: "维修", locked: "锁定", noPhone: "无电话", modalTitle: "操作", closeModal: "关闭", }
    : { today: "Aujourd'hui", checkins: "Arrivees", occupied: "Occupes", checkouts: "Departs", pending: "A confirmer", newBooking: "Reserver", checkin: "Arrivee", checkout: "Depart", payment: "Paiement", cancel: "Annuler", confirm: "Confirmer", roomStatus: "Chambres", copyShare: "Copier", copied: "Copie", allCopy: "Tout", room: "Ch", guest: "Cli", nights: "n", prepaid: "Paye", due: "Du", date: "Date", amount: "Montant", receiptNo: "Recu", reason: "Motif", save: "OK", loading: "...", success: "OK", error: "Erreur", noData: "Aucun", newBookingDesc: "Nouvelle reservation", checkinDesc: "Confirmer l'arrivee?", checkoutDesc: "Confirmer le depart?", cancelDesc: "Annuler la reservation?", paymentDesc: "Saisir le montant", copyDesc: "Copier l'etat des chambres", available: "Dispo", reserved: "Reserve", occupiedLabel: "Occupe", cleaning: "Menage", maintenance: "Maint", locked: "Bloque", noPhone: "Sans tel", modalTitle: "Action", closeModal: "Fermer", }
  ;

  const roomStates = useMemo(
    () => computeRoomStates(dailyUnits, bookings, customers, cleaningTasks, payments, todayStr),
    [dailyUnits, bookings, customers, cleaningTasks, payments],
  );

  const occupied = useMemo(() => getOccupiedRooms(roomStates), [roomStates]);
  const todayCheckouts = useMemo(() => getTodayCheckouts(roomStates), [roomStates]);
  const reserved = useMemo(() => getReservedRooms(roomStates), [roomStates]);
  const available = useMemo(() => getAvailableRooms(roomStates), [roomStates]);
  const cleaning = useMemo(() => getCleaningRooms(roomStates), [roomStates]);

  // Today's checkins (bookings where check_in = today, in pending_review/confirmed status)
  const todayCheckins = useMemo(() => {
    return bookings.filter(b =>
      b.check_in === todayStr &&
      (b.status === "pending_review" || b.status === "confirmed")
    );
  }, [bookings]);

  const pendingBookings = useMemo(() => bookings.filter(b => b.status === "pending_review"), [bookings]);

  const [mainTab, setMainTab] = useState<MainTab>("checkins");
  const [selectedRoom, setSelectedRoom] = useState<RoomState | null>(null);
  const [popupAction, setPopupAction] = useState<PopupAction>(null);
  const [popupAmount, setPopupAmount] = useState(0);
  const [popupReceiptNo, setPopupReceiptNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Copy share content ──
  const handleCopyShare = useCallback(() => {
    const lines: string[] = [];
    const dateStr = new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR", { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
    lines.push(`SACIS3.0 ${buildingName} — ${dateStr}`);
    lines.push("");

    if (occupied.length > 0) {
      lines.push(locale === "zh" ? `【占用中 ${occupied.length}间】` : `【${occupied.length} occupees】`);
      for (const r of occupied) lines.push(`${r.unit.unit_no}`);
      lines.push("");
    }
    if (todayCheckouts.length > 0) {
      lines.push(locale === "zh" ? `【今日退房 ${todayCheckouts.length}间】` : `【${todayCheckouts.length} departs】`);
      for (const r of todayCheckouts) lines.push(`${r.unit.unit_no}`);
      lines.push("");
    }
    if (cleaning.length > 0) {
      lines.push(locale === "zh" ? `【待保洁 ${cleaning.length}间】` : `【${cleaning.length} menages】`);
      for (const r of cleaning) lines.push(`${r.unit.unit_no}`);
      lines.push("");
    }
    if (available.length > 0) {
      lines.push(locale === "zh" ? `【空闲 ${available.length}间】` : `【${available.length} dispo】`);
      lines.push("");
    }

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [occupied, todayCheckouts, cleaning, available, locale, buildingName]);

  // ── Room color ──
  const roomColor = (rs: RoomState) => {
    switch (rs.displayStatus) {
      case "occupied": return "bg-brand-indigo-100 text-brand-indigo-700 border-brand-indigo-300";
      case "checking_out_today": return "bg-brand-amber-100 text-brand-amber-700 border-brand-amber-200";
      case "reserved": return "bg-brand-amber-100 text-brand-amber-700 border-brand-amber-200";
      case "cleaning": return "bg-brand-cyan-100 text-brand-cyan-700 border-brand-cyan-200";
      case "available": return "bg-brand-green-50 text-brand-green-700 border-brand-green-200";
      default: return "bg-brand-neutral-100 text-brand-neutral-600 border-brand-neutral-300";
    }
  };

  // ── Action handlers ──
  const openRoomAction = (room: RoomState, action: PopupAction) => {
    setSelectedRoom(room);
    setPopupAction(action);
    setMsg("");
    if (action === "payment") {
      const unpaid = room.billing ? room.billing.finalAmount - room.totalPaid : 0;
      setPopupAmount(unpaid > 0 ? unpaid : 0);
    } else {
      setPopupAmount(0);
    }
    setPopupReceiptNo("");
  };

  const doAction = async () => {
    if (!selectedRoom?.booking) return;
    setLoading(true); setMsg("");
    let result: { success: boolean; error?: string } = { success: false };

    try {
      switch (popupAction) {
        case "checkin":
          result = await checkIn(selectedRoom.booking.id, popupAmount);
          break;
        case "checkout":
          result = await checkoutAction(selectedRoom.booking.id, {});
          break;
        case "payment":
          result = await recordSupplementaryPayment({ bookingId: selectedRoom.booking.id, amount: popupAmount, receiptNo: popupReceiptNo || undefined });
          break;
        case "cancel":
          result = await cancelBooking(selectedRoom.booking.id);
          break;
        case "confirm":
          result = await confirmBooking(selectedRoom.booking.id);
          break;
      }
    } catch (e) { setMsg(String(e)); }

    setLoading(false);
    if (result.success) {
      setPopupAction(null);
      setSelectedRoom(null);
      setMsg(t.success);
    } else {
      setMsg(result.error ?? t.error);
    }
  };

  const btnClass = "flex items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-xs font-semibold active:scale-95 transition-all";

  // ── Render ──
  return (
    <div className="max-w-lg mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[13px] font-bold text-brand-ink-900">{buildingName}</p>
          <p className="text-xs text-brand-ink-500">
            {new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR", { weekday: "short", month: "short", day: "numeric" })}
          </p>
        </div>
        <button onClick={handleCopyShare}
          className={cn("flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", copied ? "bg-brand-green-100 text-brand-green-700" : "bg-brand-warm-100 text-brand-ink-600")}>
          {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t.copied : t.copyShare}
        </button>
      </div>

      {/* Quick action buttons */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <button onClick={() => router.push("/daily-rentals")} className={cn(btnClass, "bg-brand-indigo-500 text-white")}>
          <Plus className="h-4 w-4" />{t.newBooking}
        </button>
        <button onClick={() => setMainTab("checkins")} className={cn(btnClass, "bg-brand-cyan-50 text-brand-cyan-700 border border-brand-cyan-200")}>
          <LogIn className="h-4 w-4" />{t.checkins} ({todayCheckins.length})
        </button>
        <button onClick={() => setMainTab("checkouts")} className={cn(btnClass, "bg-brand-amber-50 text-brand-amber-700 border border-brand-amber-200")}>
          <LogOut className="h-4 w-4" />{t.checkouts} ({todayCheckouts.length})
        </button>
        <button onClick={() => setMainTab("occupied")} className={cn(btnClass, "bg-brand-indigo-50 text-brand-indigo-700 border border-brand-indigo-200")}>
          <BedDouble className="h-4 w-4" />{t.occupied} ({occupied.length})
        </button>
        <button onClick={() => setMainTab("pending")} className={cn(btnClass, "bg-brand-warm-100 text-brand-ink-600 border border-brand-warm-200")}>
          <AlertTriangle className="h-4 w-4" />{t.pending} ({pendingBookings.length})
        </button>
        <button onClick={() => router.push("/daily-rentals")} className={cn(btnClass, "bg-brand-green-50 text-brand-green-700 border border-brand-green-200")}>
          <Calendar className="h-4 w-4" />{t.roomStatus}
        </button>
      </div>

      {/* Room matrix — apartments only, compact */}
      <div className="mb-4 rounded-xl border border-brand-warm-200 bg-white p-3">
        <h3 className="text-xs font-bold text-brand-ink-600 mb-2">{t.roomStatus} ({roomStates.length})</h3>
        <div className="flex flex-wrap gap-1.5">
          {roomStates.map(rs => (
            <button
              key={rs.unit.id}
              onClick={() => setSelectedRoom(rs)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded text-xs font-semibold border transition-all active:scale-90",
                roomColor(rs),
              )}
              title={`${rs.unit.unit_no} — ${rs.customer?.name ?? ""}`}
            >
              {rs.unit.unit_no}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-brand-ink-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-brand-green-500" />{t.available} ({available.length})</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-brand-red-500" />{t.occupied} ({occupied.length})</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-brand-amber-500" />{t.checkouts} ({todayCheckouts.length})</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-brand-cyan-400" />{t.reserved} ({reserved.length})</span>
        </div>
      </div>

      {/* Tab lists */}
      <div className="rounded-xl border border-brand-warm-200 bg-white overflow-hidden">
        <div className="flex border-b border-brand-neutral-200 text-xs font-medium">
          {(["checkins", "occupied", "checkouts", "pending"] as MainTab[]).map(tab => (
            <button key={tab}
              onClick={() => setMainTab(tab)}
              className={cn("flex-1 py-2.5 text-center transition-colors", mainTab === tab ? "bg-brand-indigo-50 text-brand-indigo-700 border-b-2 border-brand-indigo" : "text-brand-ink-500")}>
              {t[tab]} ({tab === "checkins" ? todayCheckins.length : tab === "occupied" ? occupied.length : tab === "checkouts" ? todayCheckouts.length : pendingBookings.length})
            </button>
          ))}
        </div>
        <div className="divide-y divide-brand-neutral-100 max-h-[320px] overflow-auto">
          {(mainTab === "checkins" ? todayCheckins :
            mainTab === "occupied" ? [...occupied, ...todayCheckouts].map(r => r.booking!).filter(Boolean) :
            mainTab === "checkouts" ? todayCheckouts.map(r => r.booking!).filter(Boolean) :
            pendingBookings
          ).map(b => {
            const unit = dailyUnits.find(u => u.id === b.unit_id);
            const cust = customers.find(c => c.id === b.customer_id);
            const rs = roomStates.find(r => r.booking?.id === b.id);
            const nights = b.check_out ? Math.ceil((new Date(b.check_out).getTime() - new Date(b.check_in).getTime()) / 86400000) : "?";
            return (
              <div key={b.id} className="flex items-center gap-2 px-3 py-2.5 text-xs">
                <span className="font-mono font-bold text-slate-800 min-w-[32px]">{unit?.unit_no ?? "?"}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-brand-ink-800 truncate">{cust?.name ?? "?"}</p>
                  <p className="text-xs text-brand-ink-500 truncate">
                    {b.check_in} · {nights}{locale === "zh" ? "晚" : "n"} · {formatXof(Number(b.total_amount_xof))}
                    {cust?.phone && <span className="ml-1">· {cust.phone}</span>}
                  </p>
                </div>
                <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-semibold",
                  b.status === "checked_in" ? "bg-brand-red-100 text-brand-red-700" :
                  b.status === "confirmed" ? "bg-brand-cyan-100 text-brand-cyan-700" :
                  b.status === "pending_review" ? "bg-brand-amber-100 text-brand-amber-700" :
                  "bg-brand-warm-100 text-brand-ink-500"
                )}>
                  {b.status === "checked_in" ? (locale === "zh" ? "在住" : "Occupe") :
                   b.status === "confirmed" ? (locale === "zh" ? "已确认" : "Confirme") :
                   b.status === "pending_review" ? (locale === "zh" ? "待审" : "Attente") : b.status}
                </span>
                <div className="flex gap-1">
                  {b.status === "pending_review" && (
                    <button onClick={() => openRoomAction(rs!, "confirm")}
                      className="rounded bg-brand-cyan-500 px-2 py-1 text-xs font-semibold text-white">{t.confirm}</button>
                  )}
                  {b.status === "confirmed" && b.check_in === todayStr && (
                    <button onClick={() => openRoomAction(rs!, "checkin")}
                      className="rounded bg-brand-green-500 px-2 py-1 text-xs font-semibold text-white">{t.checkin}</button>
                  )}
                  {b.status === "checked_in" && (
                    <button onClick={() => openRoomAction(rs!, "checkout")}
                      className="rounded bg-brand-amber-500 px-2 py-1 text-xs font-semibold text-white">{t.checkout}</button>
                  )}
                </div>
              </div>
            );
          })}
          {((mainTab === "checkins" && todayCheckins.length === 0) ||
            (mainTab === "occupied" && occupied.length === 0 && todayCheckouts.length === 0) ||
            (mainTab === "checkouts" && todayCheckouts.length === 0) ||
            (mainTab === "pending" && pendingBookings.length === 0)) && (
            <div className="py-10 text-center text-xs text-brand-ink-400">{t.noData}</div>
          )}
        </div>
      </div>

      {/* Room detail popup */}
      {selectedRoom && !popupAction && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setSelectedRoom(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm max-h-[70vh] overflow-auto shadow-xl border border-brand-warm-200 p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-brand-ink-900">{selectedRoom.unit.unit_no} · {selectedRoom.unit.floor_label}</h3>
              <button onClick={() => setSelectedRoom(null)} className="p-1 rounded hover:bg-brand-warm-100"><X className="h-4 w-4 text-brand-ink-500" /></button>
            </div>
            {selectedRoom.customer && (
              <div className="space-y-1 text-xs mb-3">
                <p className="flex items-center gap-1"><User className="h-3 w-3 text-brand-ink-500" />{selectedRoom.customer.name}</p>
                {selectedRoom.customer.phone && <p className="flex items-center gap-1"><Phone className="h-3 w-3 text-brand-ink-500" />{selectedRoom.customer.phone}</p>}
              </div>
            )}
            {selectedRoom.booking ? (
              <div className="space-y-1 text-xs mb-3">
                <p><span className="text-brand-ink-500">{t.date}:</span> {selectedRoom.booking.check_in} → {selectedRoom.booking.check_out ?? (locale === "zh" ? "未定" : "?")}</p>
                <p><span className="text-brand-ink-500">{t.amount}:</span> {formatXof(Number(selectedRoom.booking.total_amount_xof))}</p>
                <p><span className="text-brand-ink-500">{t.prepaid}:</span> <span className="text-brand-green-600">{formatXof(selectedRoom.totalPaid)}</span></p>
                {selectedRoom.billing && selectedRoom.billing.finalAmount > selectedRoom.totalPaid && (
                  <p><span className="text-brand-ink-500">{t.due}:</span> <span className="text-brand-red-600 font-semibold">{formatXof(selectedRoom.billing.finalAmount - selectedRoom.totalPaid)}</span></p>
                )}
              </div>
            ) : (
              <p className="text-xs text-brand-ink-400 mb-3">{t.available}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {(!selectedRoom.booking || selectedRoom.booking.status === "pending_review") && (
                <button onClick={() => openRoomAction(selectedRoom, "confirm")} className={cn(btnClass, "bg-brand-cyan-50 text-brand-cyan-700")}>{t.confirm}</button>
              )}
              {(!selectedRoom.booking || selectedRoom.booking.status === "confirmed") && selectedRoom.booking?.check_in === todayStr && (
                <button onClick={() => openRoomAction(selectedRoom, "checkin")} className={cn(btnClass, "bg-brand-green-500 text-white")}>{t.checkin}</button>
              )}
              {selectedRoom.booking?.status === "checked_in" && (
                <>
                  <button onClick={() => openRoomAction(selectedRoom, "checkout")} className={cn(btnClass, "bg-brand-amber-500 text-white")}>{t.checkout}</button>
                  <button onClick={() => openRoomAction(selectedRoom, "payment")} className={cn(btnClass, "bg-brand-indigo-50 text-brand-indigo-700")}>{t.payment}</button>
                </>
              )}
              {selectedRoom.booking?.status && ["pending_review", "confirmed"].includes(selectedRoom.booking.status) && (
                <button onClick={() => openRoomAction(selectedRoom, "cancel")} className={cn(btnClass, "bg-brand-red-50 text-brand-red-600")}>{t.cancel}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action popup */}
      {popupAction && selectedRoom && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => { setPopupAction(null); setSelectedRoom(null); }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm shadow-xl border border-brand-warm-200 p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-brand-ink-900 mb-3">
              {popupAction === "checkin" ? t.checkin : popupAction === "checkout" ? t.checkout : popupAction === "payment" ? t.payment : popupAction === "cancel" ? t.cancel : t.confirm}
              {" — "}{selectedRoom.unit.unit_no}
            </h3>
            <p className="text-xs text-brand-ink-600 mb-3">
              {popupAction === "checkin" ? t.checkinDesc : popupAction === "checkout" ? t.checkoutDesc : popupAction === "payment" ? t.paymentDesc : popupAction === "cancel" ? t.cancelDesc : t.confirm}
            </p>

            {popupAction === "checkin" && (
              <div className="space-y-2 mb-3">
                <label className="text-xs text-brand-ink-500">{t.prepaid}</label>
                <input type="number" value={popupAmount} onChange={e => setPopupAmount(Number(e.target.value))}
                  className="w-full rounded-lg border border-brand-warm-200 px-3 py-2 text-sm" />
              </div>
            )}
            {popupAction === "payment" && (
              <div className="space-y-2 mb-3">
                <label className="text-xs text-brand-ink-500">{t.amount}</label>
                <input type="number" value={popupAmount} onChange={e => setPopupAmount(Number(e.target.value))}
                  className="w-full rounded-lg border border-brand-warm-200 px-3 py-2 text-sm" />
                <label className="text-xs text-brand-ink-500">{t.receiptNo}</label>
                <input type="text" value={popupReceiptNo} onChange={e => setPopupReceiptNo(e.target.value)}
                  className="w-full rounded-lg border border-brand-warm-200 px-3 py-2 text-sm" />
              </div>
            )}

            {msg && <p className={cn("text-xs mb-2", msg === t.success ? "text-brand-green-600" : "text-brand-red-600")}>{msg}</p>}

            <div className="flex gap-2">
              <button onClick={() => { setPopupAction(null); setSelectedRoom(null); }}
                className="flex-1 rounded-lg border border-brand-warm-200 py-2.5 text-sm font-semibold text-brand-ink-600">{t.closeModal}</button>
              <button onClick={doAction} disabled={loading}
                className="flex-1 rounded-lg bg-brand-indigo-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {loading ? t.loading : popupAction === "checkin" ? t.checkin : popupAction === "checkout" ? t.checkout : popupAction === "payment" ? t.save : popupAction === "cancel" ? t.cancel : t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast for copy */}
      {copied && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-brand-indigo-500 text-white rounded-full px-5 py-2 text-xs font-semibold shadow-lg animate-pulse">
          <ClipboardCheck className="inline h-3.5 w-3.5 mr-1" />{t.copied}
        </div>
      )}
    </div>
  );
}
