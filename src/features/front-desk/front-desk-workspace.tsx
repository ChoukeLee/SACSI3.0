"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, LogIn, LogOut, CreditCard, Plus, Copy, ClipboardCheck, AlertTriangle, Check, X, Calendar, Phone, User } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import { checkIn, checkOut as checkoutAction, recordSupplementaryPayment, cancelBooking, confirmBooking } from "@/features/daily-rentals/actions";
import { computeRoomStates, getOccupiedRooms, getTodayCheckouts, getReservedRooms, getCleaningRooms, getAvailableRooms, getOtherRooms, type RoomState } from "@/features/mobile/room-state";

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

const T = (locale: Locale) => locale === "zh" ? {
  today: "今日", checkins: "今日入住", occupied: "在住", checkouts: "今日退房", pending: "待确认",
  cleaning: "待保洁", maintenance: "维修/锁定", newBooking: "新建预订", roomStatus: "房态一览",
  copyShare: "复制发群", copied: "已复制",
  checkin: "办理入住", checkout: "退房", payment: "收款", cancel: "取消", confirm: "确认预订",
  room: "房", guest: "客", nights: "晚", prepaid: "已付", due: "待付", phone: "电话",
  newBookingDesc: "新建日租预订", checkinDesc: "确认办理入住", checkoutDesc: "确认退房，房间将进入保洁",
  cancelDesc: "确认取消预订", paymentDesc: "输入金额", copyDesc: "复制今日房态",
  available: "空闲", reserved: "预订", occupiedLabel: "占用", locked: "锁定",
  noPhone: "无电话", noData: "暂无数据",
  broadcastTitle: "今日发群内容",
  summaryTitle: "今日摘要",
  groupLabel: "层",
} : {
  today: "Aujourd'hui", checkins: "Arrivees", occupied: "Occupes", checkouts: "Departs", pending: "A confirmer",
  cleaning: "Menage", maintenance: "Maintenance", newBooking: "Reserver", roomStatus: "Chambres",
  copyShare: "Copier", copied: "Copie",
  checkin: "Arrivee", checkout: "Depart", payment: "Paiement", cancel: "Annuler", confirm: "Confirmer",
  room: "Ch", guest: "Cli", nights: "n", prepaid: "Paye", due: "Du", phone: "Tel",
  newBookingDesc: "Nouvelle reservation", checkinDesc: "Confirmer l'arrivee", checkoutDesc: "Confirmer le depart",
  cancelDesc: "Annuler la reservation", paymentDesc: "Saisir le montant", copyDesc: "Copier l'etat",
  available: "Dispo", reserved: "Reserve", occupiedLabel: "Occupe", locked: "Bloque",
  noPhone: "Sans tel", noData: "Aucun",
  broadcastTitle: "Message du jour",
  summaryTitle: "Resume",
  groupLabel: "Etage",
};

export function FrontDeskWorkspace({ dailyUnits, bookings, customers, payments, cleaningTasks, locale, buildingName = "SASCI11" }: Props) {
  const router = useRouter();
  const t = T(locale);

  const roomStates = useMemo(() => computeRoomStates(dailyUnits, bookings, customers, cleaningTasks, payments, todayStr), [dailyUnits, bookings, customers, cleaningTasks, payments]);
  const occupied = useMemo(() => getOccupiedRooms(roomStates), [roomStates]);
  const todayCheckouts = useMemo(() => getTodayCheckouts(roomStates), [roomStates]);
  const reserved = useMemo(() => getReservedRooms(roomStates), [roomStates]);
  const available = useMemo(() => getAvailableRooms(roomStates), [roomStates]);
  const cleaning = useMemo(() => getCleaningRooms(roomStates), [roomStates]);
  const others = useMemo(() => getOtherRooms(roomStates), [roomStates]);

  const todayCheckins = useMemo(() => bookings.filter(b => b.check_in === todayStr && (b.status === "pending_review" || b.status === "confirmed")), [bookings]);
  const pendingBookings = useMemo(() => bookings.filter(b => b.status === "pending_review"), [bookings]);
  const customerMap = useMemo(() => { const m = new Map<string, CustomerRow>(); for (const c of customers) m.set(c.id, c); return m; }, [customers]);

  const [selectedRoom, setSelectedRoom] = useState<RoomState | null>(null);
  const [popupAction, setPopupAction] = useState<PopupAction>(null);
  const [popupAmount, setPopupAmount] = useState(0);
  const [popupReceiptNo, setPopupReceiptNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Floor groups for matrix ──
  const floorGroups = useMemo(() => {
    const g = new Map<string, RoomState[]>();
    const apartments = roomStates.filter(r => r.unit.kind === "apartment");
    for (const r of apartments) {
      const f = r.unit.floor_label ?? "?";
      if (!g.has(f)) g.set(f, []);
      g.get(f)!.push(r);
    }
    return Array.from(g.entries()).sort((a,b) => {const an=parseInt(a[0],10),bn=parseInt(b[0],10); return !isNaN(an)&&!isNaN(bn)?an-bn:a[0].localeCompare(b[0]);});
  }, [roomStates]);

  // ── Broadcast message ──
  const broadcastText = useMemo(() => {
    const lines: string[] = [];
    const date = new Date().toLocaleDateString(locale==="zh"?"zh-CN":"fr-FR",{weekday:"short",month:"2-digit",day:"2-digit"});
    lines.push(`${buildingName} — ${date}`);
    if (occupied.length>0) { lines.push(`${locale==="zh"?"【占用":"【Occupe"} ${occupied.length}${locale==="zh"?"间】":"】"}`); for(const r of occupied) lines.push(r.unit.unit_no); }
    if (todayCheckouts.length>0) { lines.push(`${locale==="zh"?"【今日退房":"【Depart"} ${todayCheckouts.length}${locale==="zh"?"间】":"】"}`); for(const r of todayCheckouts) lines.push(r.unit.unit_no); }
    if (cleaning.length>0) { lines.push(`${locale==="zh"?"【待保洁":"【Menage"} ${cleaning.length}${locale==="zh"?"间】":"】"}`); for(const r of cleaning) lines.push(r.unit.unit_no); }
    if (available.length>0) { lines.push(`${locale==="zh"?"【空闲":"【Dispo"} ${available.length}${locale==="zh"?"间】":"】"}`); }
    return lines.join("\n");
  }, [occupied, todayCheckouts, cleaning, available, locale, buildingName]);

  const handleCopyShare = useCallback(() => {
    navigator.clipboard.writeText(broadcastText).then(() => { setCopied(true); setTimeout(()=>setCopied(false),2000); });
  }, [broadcastText]);

  // ── Room color (girlfriend palette) ──
  const roomTileClass = (rs: RoomState): string => {
    switch (rs.displayStatus) {
      case "occupied": case "checking_out_today": return "bg-[#5090C0] text-white";
      case "reserved": return "bg-[#A0C0E0] text-[#1F4564]";
      case "cleaning": return "bg-[#5AB5B8] text-white";
      case "available": return "bg-[#F0E0D0] text-[#4F4238]";
      default: return "bg-[#F0A080] text-[#673522]";
    }
  };

  // ── Action handlers ──
  const openRoomAction = (room: RoomState, action: PopupAction) => {
    setSelectedRoom(room); setPopupAction(action); setMsg("");
    if (action === "payment") { const unpaid = room.billing ? room.billing.finalAmount - room.totalPaid : 0; setPopupAmount(unpaid>0?unpaid:0); }
    else setPopupAmount(0);
    setPopupReceiptNo("");
  };

  const doAction = async () => {
    if (!selectedRoom?.booking) return;
    setLoading(true); setMsg("");
    let result: {success:boolean;error?:string} = {success:false};
    try {
      switch(popupAction) {
        case "checkin": result=await checkIn(selectedRoom.booking.id,popupAmount); break;
        case "checkout": result=await checkoutAction(selectedRoom.booking.id,{}); break;
        case "payment": result=await recordSupplementaryPayment({bookingId:selectedRoom.booking.id,amount:popupAmount,receiptNo:popupReceiptNo||undefined}); break;
        case "cancel": result=await cancelBooking(selectedRoom.booking.id); break;
        case "confirm": result=await confirmBooking(selectedRoom.booking.id); break;
      }
    } catch(e) { setMsg(String(e)); }
    setLoading(false);
    if(result.success) { setPopupAction(null); setSelectedRoom(null); setMsg(locale==="zh"?"成功":"OK"); }
    else setMsg(result.error??(locale==="zh"?"失败":"Erreur"));
  };

  const roomCustomer = (rs: RoomState): string => rs.customer?.name ?? (rs.displayStatus==="available"?locale==="zh"?"可安排入住":"Disponible":locale==="zh"?"暂无":"-");

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-bold">{buildingName}</p>
          <p className="text-xs text-muted-foreground">{new Date().toLocaleDateString(locale==="zh"?"zh-CN":"fr-FR",{weekday:"short",month:"short",day:"numeric"})}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={()=>router.push("/daily-rentals")}><Plus className="h-4 w-4"/>{t.newBooking}</Button>
          <Button size="sm" variant="secondary" onClick={handleCopyShare}>{copied?<ClipboardCheck className="h-4 w-4"/>:<Copy className="h-4 w-4"/>}{copied?t.copied:t.copyShare}</Button>
        </div>
      </div>

      {/* ── Today summary ── */}
      <div className="grid grid-cols-5 gap-2">
        <SummaryCard icon={<LogIn className="h-4 w-4 text-blue-600"/>} label={t.checkins} count={todayCheckins.length} />
        <SummaryCard icon={<LogOut className="h-4 w-4 text-amber-600"/>} label={t.checkouts} count={todayCheckouts.length} />
        <SummaryCard icon={<BedDouble className="h-4 w-4 text-[#5090C0]"/>} label={t.occupied} count={occupied.length} />
        <SummaryCard icon={<AlertTriangle className="h-4 w-4 text-amber-500"/>} label={t.pending} count={pendingBookings.length} />
        <SummaryCard icon={<Check className="h-4 w-4 text-emerald-600"/>} label={t.cleaning} count={cleaning.length} />
      </div>

      {/* ── Broadcast message ── */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t.broadcastTitle}</CardTitle></CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">{broadcastText}</pre>
        </CardContent>
      </Card>

      {/* ── Room matrix by floor ── */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t.roomStatus} ({roomStates.length})</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {floorGroups.map(([floor, rooms]) => (
            <div key={floor}>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-semibold text-muted-foreground">{floor}{locale==="zh"?"层":""}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{rooms.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {rooms.map(rs => (
                  <button key={rs.unit.id} onClick={()=>setSelectedRoom(rs)}
                    className={cn("flex h-[72px] w-[110px] flex-col items-center justify-center gap-0.5 rounded-xl text-center shadow-sm transition-shadow hover:shadow-md", roomTileClass(rs))}>
                    <span className="font-mono text-xs font-bold">{rs.unit.unit_no}</span>
                    <span className="text-[11px] font-medium leading-tight px-1 truncate max-w-full">{roomCustomer(rs)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground border-t pt-3">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#5090C0]"/> {t.occupiedLabel} ({occupied.length})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#A0C0E0]"/> {t.reserved} ({reserved.length})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#5AB5B8]"/> {t.cleaning} ({cleaning.length})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#F0E0D0]"/> {t.available} ({available.length})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#F0A080]"/> {t.maintenance} ({others.length})</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Room detail popup ── */}
      {selectedRoom && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/30" onClick={()=>{setSelectedRoom(null);setPopupAction(null);}} />
          <div className="fixed inset-x-4 bottom-4 z-panel mx-auto max-w-lg rounded-2xl border bg-card p-5 shadow-lg">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-lg font-bold font-mono">{selectedRoom.unit.unit_no}</p>
                <p className="text-sm text-muted-foreground">{roomCustomer(selectedRoom)}</p>
                {selectedRoom.booking && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedRoom.booking.check_in} → {selectedRoom.booking.check_out ?? (locale==="zh"?"未定":"?")}
                    {" · "}{formatXof(Number(selectedRoom.booking.total_amount_xof))}
                  </p>
                )}
              </div>
              <button onClick={()=>{setSelectedRoom(null);setPopupAction(null);}} className="rounded-md p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>

            {!popupAction ? (
              <div className="flex flex-wrap gap-2">
                {selectedRoom.booking && (<>
                  {selectedRoom.booking.status==="confirmed" && <><Button size="sm" onClick={()=>openRoomAction(selectedRoom,"checkin")}><LogIn className="h-4 w-4"/>{t.checkin}</Button>
                    <Button size="sm" variant="ghost" onClick={()=>openRoomAction(selectedRoom,"cancel")}><X className="h-4 w-4"/>{t.cancel}</Button></>}
                  {selectedRoom.booking.status==="checked_in" && <><Button size="sm" onClick={()=>openRoomAction(selectedRoom,"checkout")}><LogOut className="h-4 w-4"/>{t.checkout}</Button>
                    <Button size="sm" variant="secondary" onClick={()=>openRoomAction(selectedRoom,"payment")}><CreditCard className="h-4 w-4"/>{t.payment}</Button></>}
                  {selectedRoom.booking.status==="pending_review" && <><Button size="sm" onClick={()=>openRoomAction(selectedRoom,"confirm")}><Check className="h-4 w-4"/>{t.confirm}</Button>
                    <Button size="sm" variant="ghost" onClick={()=>openRoomAction(selectedRoom,"cancel")}><X className="h-4 w-4"/>{t.cancel}</Button></>}
                </>)}
                {selectedRoom.customer?.phone && <p className="w-full text-xs text-muted-foreground mt-1"><Phone className="h-3 w-3 inline"/>{selectedRoom.customer.phone}</p>}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-semibold">{popupAction==="checkin"?t.checkinDesc:popupAction==="checkout"?t.checkoutDesc:popupAction==="cancel"?t.cancelDesc:t.paymentDesc}</p>
                {(popupAction==="checkin"||popupAction==="payment") && <div><input type="number" value={popupAmount} onChange={e=>setPopupAmount(Number(e.target.value))} className="w-full rounded-md border px-3 py-2 text-sm" placeholder={t.paymentDesc}/></div>}
                {popupAction==="payment" && <div><input type="text" value={popupReceiptNo} onChange={e=>setPopupReceiptNo(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" placeholder={locale==="zh"?"收据号":"Recu"}/></div>}
                {msg && <p className="text-xs text-red-600">{msg}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={doAction} disabled={loading}>{loading ? "..." : actionLabel(popupAction, t)}</Button>
                  <Button size="sm" variant="ghost" onClick={()=>setPopupAction(null)}>{locale==="zh"?"返回":"Retour"}</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function actionLabel(action: PopupAction, t: ReturnType<typeof T>): string {
  switch (action) { case "checkin": return t.checkin; case "checkout": return t.checkout; case "payment": return t.payment; case "cancel": return t.cancel; case "confirm": return t.confirm; default: return ""; }
}

function SummaryCard({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border bg-card p-3 shadow-sm">
      {icon}
      <span className="text-lg font-bold tabular-nums">{count}</span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
