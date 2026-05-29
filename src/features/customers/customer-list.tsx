"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, UserX, UserCheck, X, Eye, Search, Phone, Home, CreditCard, BedDouble, Star } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import type { CustomerRow } from "@/types/database";
import {
  createCustomer,
  updateCustomer,
  setCustomerBlacklist,
  removeCustomerBlacklist,
} from "./actions";

interface CustomerListProps {
  customers: CustomerRow[];
  customerSegments?: {
    leaseCustomerIds: string[];
    saleCustomerIds: string[];
    dailyCustomerIds: string[];
  };
  customerRooms?: Record<string, string[]>;
  customerLastActivity?: Record<string, string>;
  locale: Locale;
}

type FormMode = { type: "add" } | { type: "edit"; customer: CustomerRow } | null;
type CustomerSegment = "all" | "lease" | "sale" | "daily" | "blacklisted";

export function CustomerList({ customers, customerSegments, customerRooms, customerLastActivity, locale }: CustomerListProps) {
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<CustomerSegment>("all");
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blacklistPanelId, setBlacklistPanelId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formGender, setFormGender] = useState("");
  const [formDocType, setFormDocType] = useState("");
  const [formDocNo, setFormDocNo] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [blReason, setBlReason] = useState("");
  const [blPermanent, setBlPermanent] = useState(true);
  const [blError, setBlError] = useState("");
  const [blSaving, setBlSaving] = useState(false);

  const segmentSets = useMemo(() => {
    const lease = new Set(customerSegments?.leaseCustomerIds ?? []);
    const sale = new Set(customerSegments?.saleCustomerIds ?? []);
    const daily = new Set(customerSegments?.dailyCustomerIds ?? []);
    return { lease, sale, daily };
  }, [customerSegments]);

  const stats = useMemo(() => ({
    lease: customers.filter((c) => segmentSets.lease.has(c.id)).length,
    sale: customers.filter((c) => segmentSets.sale.has(c.id)).length,
    dailyOnly: customers.filter((c) => segmentSets.daily.has(c.id) && !segmentSets.lease.has(c.id) && !segmentSets.sale.has(c.id)).length,
    blacklisted: customers.filter((c) => c.is_blacklisted).length,
    all: customers.length,
  }), [customers, segmentSets]);

  // Stable-first, then by recent activity
  const sorted = useMemo(() => {
    const rooms = customerRooms ?? {};
    const activity = customerLastActivity ?? {};
    return [...customers].sort((a, b) => {
      const aStable = segmentSets.lease.has(a.id) || segmentSets.sale.has(a.id);
      const bStable = segmentSets.lease.has(b.id) || segmentSets.sale.has(b.id);
      if (aStable !== bStable) return aStable ? -1 : 1;
      const aAct = activity[a.id] ?? "";
      const bAct = activity[b.id] ?? "";
      if (aAct !== bAct) return bAct.localeCompare(aAct);
      return a.name.localeCompare(b.name);
    });
  }, [customers, segmentSets, customerRooms, customerLastActivity]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    const rooms = customerRooms ?? {};
    return sorted.filter((c) => {
      if (segment === "lease" && !segmentSets.lease.has(c.id)) return false;
      if (segment === "sale" && !segmentSets.sale.has(c.id)) return false;
      if (segment === "daily" && !segmentSets.daily.has(c.id)) return false;
      if (segment === "blacklisted" && !c.is_blacklisted) return false;
      if (s) {
        const nameMatch = c.name.toLowerCase().includes(s);
        const phoneMatch = c.phone?.includes(s) ?? false;
        const documentMatch = c.encrypted_document_no?.toLowerCase().includes(s) ?? false;
        const roomMatch = (rooms[c.id] ?? []).some((r) => r.toLowerCase().includes(s));
        if (!nameMatch && !phoneMatch && !documentMatch && !roomMatch) return false;
      }
      return true;
    });
  }, [sorted, search, segment, segmentSets, customerRooms]);

  const selected = selectedId ? customers.find((c) => c.id === selectedId) : null;

  const customerTypeLabel = (c: CustomerRow) => {
    if (c.is_blacklisted) return locale === "zh" ? "黑名单" : "Liste noire";
    const tags: string[] = [];
    if (segmentSets.lease.has(c.id)) tags.push(locale === "zh" ? "长租" : "Location");
    if (segmentSets.sale.has(c.id)) tags.push(locale === "zh" ? "购房" : "Achat");
    if (segmentSets.daily.has(c.id)) tags.push(locale === "zh" ? "日租" : "Jour");
    return tags.join(" · ") || (locale === "zh" ? "未分类" : "Non classé");
  };

  const customerTypeTone = (c: CustomerRow): "default" | "secondary" | "destructive" | "outline" => {
    if (c.is_blacklisted) return "destructive";
    if (segmentSets.lease.has(c.id) || segmentSets.sale.has(c.id)) return "default";
    if (segmentSets.daily.has(c.id)) return "secondary";
    return "outline";
  };

  const resetForm = () => {
    setFormName(""); setFormGender(""); setFormDocType(""); setFormDocNo(""); setFormPhone(""); setFormNotes(""); setFormError("");
  };

  const openAdd = () => { resetForm(); setFormMode({ type: "add" }); setSelectedId(null); setBlacklistPanelId(null); };
  const openEdit = (customer: CustomerRow) => {
    setFormName(customer.name); setFormGender(customer.gender ?? ""); setFormDocType(customer.document_type ?? "");
    setFormDocNo(""); setFormPhone(customer.phone ?? ""); setFormNotes(customer.notes ?? ""); setFormError("");
    setFormMode({ type: "edit", customer }); setBlacklistPanelId(null);
  };

  const handleSave = async () => {
    if (!formName.trim() || formName.trim().length < 2) {
      setFormError(locale === "zh" ? "请输入客户姓名（至少2个字符）" : "Le nom doit comporter au moins 2 caractères");
      return;
    }
    setSaving(true); setFormError("");
    if (formMode?.type === "add") {
      const result = await createCustomer({ name: formName.trim(), gender: formGender || null, document_type: formDocType || null, document_no_plain: formDocNo || undefined, phone: formPhone || null, notes: formNotes || null });
      if (result.success) { setFormMode(null); resetForm(); } else setFormError(result.error ?? "Failed");
    } else if (formMode?.type === "edit") {
      const result = await updateCustomer(formMode.customer.id, { name: formName.trim(), gender: formGender || null, document_type: formDocType || null, document_no_plain: formDocNo || undefined, phone: formPhone || null, notes: formNotes || null });
      if (result.success) { setFormMode(null); resetForm(); } else setFormError(result.error ?? "Failed");
    }
    setSaving(false);
  };

  const handleBlacklist = async () => {
    if (!blReason.trim()) { setBlError(locale === "zh" ? "请填写拉黑原因" : "Le motif est obligatoire"); return; }
    setBlSaving(true); setBlError("");
    const result = await setCustomerBlacklist(blacklistPanelId!, blReason, blPermanent);
    if (result.success) { setBlacklistPanelId(null); setBlReason(""); setBlPermanent(true); } else setBlError(result.error ?? "Failed");
    setBlSaving(false);
  };

  const handleUnblacklist = async (id: string) => {
    setBlSaving(true);
    await removeCustomerBlacklist(id);
    setBlSaving(false);
    setBlacklistPanelId(null);
  };

  const isFormOpen = formMode !== null;
  const isBlacklistOpen = blacklistPanelId !== null;

  const inputClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";

  const t = {
    leaseClients: locale === "zh" ? "长租客户" : "Locataires",
    saleClients: locale === "zh" ? "购房客户" : "Acheteurs",
    dailyOnly: locale === "zh" ? "日租住客" : "Journaliers",
    blacklisted: locale === "zh" ? "黑名单" : "Liste noire",
    total: locale === "zh" ? "客户总数" : "Total",
    allTab: locale === "zh" ? "全部" : "Tous",
    leaseTab: locale === "zh" ? "长租客户" : "Locataires",
    saleTab: locale === "zh" ? "购房客户" : "Acheteurs",
    dailyTab: locale === "zh" ? "日租客户" : "Journaliers",
    blacklistTab: locale === "zh" ? "黑名单" : "Liste noire",
    search: locale === "zh" ? "搜索姓名 / 电话 / 证件 / 房号..." : "Rechercher nom / tél / pièce / chambre...",
    add: locale === "zh" ? "新增客户" : "Nouveau client",
    edit: locale === "zh" ? "编辑" : "Modifier",
    save: locale === "zh" ? "保存" : "Enregistrer",
    cancel: locale === "zh" ? "取消" : "Annuler",
    profile: locale === "zh" ? "查看档案" : "Profil",
    name: locale === "zh" ? "姓名" : "Nom",
    gender: locale === "zh" ? "性别" : "Genre",
    docType: locale === "zh" ? "证件类型" : "Pièce",
    docNo: locale === "zh" ? "证件号码" : "N° pièce",
    phone: locale === "zh" ? "手机号码" : "Téléphone",
    notes: locale === "zh" ? "备注" : "Remarques",
    male: locale === "zh" ? "男" : "Homme",
    female: locale === "zh" ? "女" : "Femme",
    other: locale === "zh" ? "其他" : "Autre",
    idCard: locale === "zh" ? "身份证" : "Carte d’identité",
    passport: locale === "zh" ? "护照" : "Passeport",
    driversLicense: locale === "zh" ? "驾照" : "Permis",
    blacklistAdd: locale === "zh" ? "加入黑名单" : "Ajouter à la liste noire",
    blacklistRemove: locale === "zh" ? "解除黑名单" : "Retirer de la liste noire",
    blacklistReason: locale === "zh" ? "拉黑原因" : "Motif",
    blacklistPermanent: locale === "zh" ? "永久" : "Permanent",
    blacklistTemporary: locale === "zh" ? "临时" : "Temporaire",
    blacklistDate: locale === "zh" ? "日期" : "Date",
    blacklistReason2: locale === "zh" ? "原因" : "Raison",
    blacklistWarnTitle: locale === "zh" ? "该客户已被加入黑名单" : "Ce client est sur la liste noire",
    blacklistWarnMessage: locale === "zh" ? "黑名单客户无法创建新的业务单据" : "Clients bloqués pour nouvelles transactions",
    docEncrypted: locale === "zh" ? "证件号将加密存储" : "Stockage chiffré",
    docKeepBlank: locale === "zh" ? "留空则保持原证件号不变" : "Laisser vide pour ne pas modifier",
    filtered: (n: number, total: number) => locale === "zh" ? `${n} / ${total} 位客户` : `${n} / ${total} clients`,
    empty: locale === "zh" ? "暂无客户数据" : "Aucun client",
    leaseTag: locale === "zh" ? "长租" : "Location",
    saleTag: locale === "zh" ? "购房" : "Achat",
    dailyTag: locale === "zh" ? "日租" : "Jour",
    rooms: locale === "zh" ? "关联房源" : "Chambres",
    stableFirst: locale === "zh" ? "稳定客户优先" : "Stables en premier",
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Summary cards ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard title={t.leaseClients} value={String(stats.lease)} tone="indigo" />
        <MetricCard title={t.saleClients} value={String(stats.sale)} tone="purple" />
        <MetricCard title={t.dailyOnly} value={String(stats.dailyOnly)} tone="green" />
        <MetricCard title={t.blacklisted} value={String(stats.blacklisted)} tone={stats.blacklisted > 0 ? "red" : "neutral"} />
        <MetricCard title={t.total} value={String(stats.all)} tone="amber" />
      </div>

      {/* ── Segment tabs + search ── */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["all", t.allTab, stats.all],
              ["lease", t.leaseTab, stats.lease],
              ["sale", t.saleTab, stats.sale],
              ["daily", t.dailyTab, stats.dailyOnly],
              ["blacklisted", t.blacklistTab, stats.blacklisted],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setSegment(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  segment === key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {label} <span className="ml-1 tabular-nums opacity-70">{count}</span>
              </button>
            ))}
            <span className="pl-1 text-xs text-muted-foreground">
              {t.filtered(filtered.length, customers.length)}
              <span className="ml-2 text-[10px] opacity-60">{t.stableFirst}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.search}
                className="h-9 w-64 rounded-md border bg-card pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4" />{t.add}</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Blacklist warning banner ── */}
      {selected?.is_blacklisted && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span className="font-semibold text-red-700">{t.blacklistWarnTitle}</span>
          <span className="text-red-600">— {t.blacklistWarnMessage}</span>
        </div>
      )}

      {/* ── Customer cards list ── */}
      {filtered.length === 0 ? (
        <EmptyState title={t.empty} action={<Button size="sm" onClick={openAdd}><Plus className="h-4 w-4" />{t.add}</Button>} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((c) => {
            const isSelected = selectedId === c.id;
            const hasLease = segmentSets.lease.has(c.id);
            const hasSale = segmentSets.sale.has(c.id);
            const hasDaily = segmentSets.daily.has(c.id);
            const isStable = hasLease || hasSale;
            const rooms = (customerRooms ?? {})[c.id] ?? [];
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedId(isSelected ? null : c.id);
                  setFormMode(null);
                  setBlacklistPanelId(null);
                }}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all hover:shadow-md",
                  c.is_blacklisted && "border-l-[3px] border-l-red-400 bg-red-50/40",
                  isSelected && "ring-2 ring-ring",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 truncate text-sm font-bold">
                      {isStable && <Star className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                      {c.name}
                    </p>
                    {c.gender && (
                      <span className="text-[11px] text-muted-foreground">
                        {c.gender === "male" ? t.male : c.gender === "female" ? t.female : t.other}
                      </span>
                    )}
                  </div>
                  {c.is_blacklisted ? (
                    <Badge variant="destructive" className="shrink-0 text-[10px]">{t.blacklisted}</Badge>
                  ) : (
                    <Badge variant={customerTypeTone(c)} className="shrink-0 text-[10px]">{customerTypeLabel(c)}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {c.phone ? (
                    <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>
                  ) : (
                    <span>-</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {hasLease && <span className="rounded bg-[#7050A0]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#7050A0]"><Home className="mr-0.5 inline h-3 w-3" />{t.leaseTag}</span>}
                  {hasSale && <span className="rounded bg-[#505080]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#505080]"><CreditCard className="mr-0.5 inline h-3 w-3" />{t.saleTag}</span>}
                  {hasDaily && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"><BedDouble className="mr-0.5 inline h-3 w-3" />{t.dailyTag}</span>}
                  {c.is_blacklisted && <AlertTriangle className="h-3 w-3 text-red-500" />}
                </div>
                {rooms.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {rooms.slice(0, 3).map((r) => (
                      <span key={r} className="rounded bg-muted px-1 py-0 text-[10px] text-muted-foreground font-mono">{r}</span>
                    ))}
                    {rooms.length > 3 && <span className="text-[10px] text-muted-foreground">+{rooms.length - 3}</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Selected detail bar ── */}
      {selected && !isFormOpen && !isBlacklistOpen && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5 text-sm">
              <p className="font-bold">{selected.name}</p>
              {selected.phone && <p className="text-muted-foreground"><Phone className="mr-1 inline h-3.5 w-3.5" />{selected.phone}</p>}
              {selected.gender && <p className="text-muted-foreground">{t.gender}: {selected.gender === "male" ? t.male : selected.gender === "female" ? t.female : t.other}</p>}
              {selected.document_type && <p className="text-muted-foreground">{t.docType}: {selected.document_type === "id_card" ? t.idCard : selected.document_type === "passport" ? t.passport : selected.document_type === "drivers_license" ? t.driversLicense : selected.document_type}</p>}
              {selected.notes && <p className="text-xs text-muted-foreground">{selected.notes}</p>}
              {((customerRooms ?? {})[selected.id] ?? []).length > 0 && (
                <p className="text-xs text-muted-foreground">{t.rooms}: {((customerRooms ?? {})[selected.id] ?? []).join(", ")}</p>
              )}
              {selected.is_blacklisted && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-2.5 text-xs">
                  <p className="font-semibold text-red-700">{t.blacklisted}</p>
                  {selected.blacklist_reason && <p className="text-red-600">{t.blacklistReason2}: {selected.blacklist_reason}</p>}
                  {selected.blacklist_date && <p className="text-red-500">{t.blacklistDate}: {selected.blacklist_date} · {selected.blacklist_permanent ? t.blacklistPermanent : t.blacklistTemporary}</p>}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={routeFor(locale, `/customers/${selected.id}`)}><Eye className="h-3.5 w-3.5" />{t.profile}</Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openEdit(selected)}>{t.edit}</Button>
              {selected.is_blacklisted ? (
                <Button size="sm" variant="outline" onClick={() => handleUnblacklist(selected.id)} disabled={blSaving}>
                  <UserCheck className="h-3.5 w-3.5" />{t.blacklistRemove}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => { setBlacklistPanelId(selected.id); setBlReason(""); setBlPermanent(true); setBlError(""); }}
                  className="border-red-200 text-red-700 hover:bg-red-50">
                  <UserX className="h-3.5 w-3.5" />{t.blacklistAdd}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Form Panel ── */}
      {isFormOpen && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={() => setFormMode(null)} />
          <div className="fixed inset-y-0 right-0 z-panel w-full max-w-md overflow-auto border-l bg-card shadow-lg">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-4 backdrop-blur">
              <h3 className="text-sm font-bold">{formMode.type === "add" ? t.add : t.edit}</h3>
              <button onClick={() => setFormMode(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.name} *</label><input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className={inputClass} placeholder={t.name} /></div>
              <div><label className={labelClass}>{t.gender}</label>
                <select value={formGender} onChange={(e) => setFormGender(e.target.value)} className={inputClass}>
                  <option value="">-</option><option value="male">{t.male}</option><option value="female">{t.female}</option><option value="other">{t.other}</option>
                </select>
              </div>
              <div><label className={labelClass}>{t.docType}</label>
                <select value={formDocType} onChange={(e) => setFormDocType(e.target.value)} className={inputClass}>
                  <option value="">-</option><option value="id_card">{t.idCard}</option><option value="passport">{t.passport}</option><option value="drivers_license">{t.driversLicense}</option>
                </select>
              </div>
              <div><label className={labelClass}>{t.docNo}</label>
                <input type="text" value={formDocNo} onChange={(e) => setFormDocNo(e.target.value)} className={inputClass} placeholder={formMode.type === "edit" ? t.docKeepBlank : t.docNo} />
                <p className="mt-1 text-[11px] text-muted-foreground">{formMode.type === "edit" ? t.docKeepBlank : t.docEncrypted}</p>
              </div>
              <div><label className={labelClass}>{t.phone}</label><input type="text" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className={inputClass} placeholder={t.phone} /></div>
              <div><label className={labelClass}>{t.notes}</label><textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={3} className={inputClass} placeholder={t.notes} /></div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving}>{saving ? "..." : t.save}</Button>
                <Button variant="ghost" onClick={() => setFormMode(null)}>{t.cancel}</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Blacklist form panel ── */}
      {isBlacklistOpen && (
        <>
          <div className="fixed inset-0 z-overlay bg-black/20 backdrop-blur-sm" onClick={() => setBlacklistPanelId(null)} />
          <div className="fixed inset-y-0 right-0 z-panel w-full max-w-sm overflow-auto border-l bg-card shadow-lg">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-4 backdrop-blur">
              <h3 className="text-sm font-bold">{t.blacklistAdd}</h3>
              <button onClick={() => setBlacklistPanelId(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div><label className={labelClass}>{t.blacklistReason} *</label><textarea value={blReason} onChange={(e) => setBlReason(e.target.value)} rows={3} className={inputClass} placeholder={t.blacklistReason} /></div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={blPermanent} onChange={(e) => setBlPermanent(e.target.checked)} className="h-4 w-4 rounded border" />{t.blacklistPermanent}
              </label>
              {blError && <p className="text-sm text-red-600">{blError}</p>}
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleBlacklist} disabled={blSaving} variant="destructive"><UserX className="h-4 w-4" />{blSaving ? "..." : t.blacklistAdd}</Button>
                <Button variant="ghost" onClick={() => setBlacklistPanelId(null)}>{t.cancel}</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
