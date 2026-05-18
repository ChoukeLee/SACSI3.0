"use client";

import { useState, useMemo } from "react";
import { Search, Plus, AlertTriangle, UserX, UserCheck, GitMerge, X, ChevronDown } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CustomerRow } from "@/types/database";
import {
  createCustomer,
  updateCustomer,
  setCustomerBlacklist,
  removeCustomerBlacklist,
} from "./actions";

interface CustomerListProps {
  customers: CustomerRow[];
  locale: Locale;
}

type FormMode = { type: "add" } | { type: "edit"; customer: CustomerRow } | null;

export function CustomerList({ customers, locale }: CustomerListProps) {
  const t = dictionaries[locale].customers;
  const [search, setSearch] = useState("");
  const [showBlacklistedOnly, setShowBlacklistedOnly] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blacklistPanelId, setBlacklistPanelId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formGender, setFormGender] = useState("");
  const [formDocType, setFormDocType] = useState("");
  const [formDocNo, setFormDocNo] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Blacklist form state
  const [blReason, setBlReason] = useState("");
  const [blPermanent, setBlPermanent] = useState(true);
  const [blError, setBlError] = useState("");
  const [blSaving, setBlSaving] = useState(false);

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (showBlacklistedOnly && !c.is_blacklisted) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [customers, search, showBlacklistedOnly]);

  const selected = selectedId ? customers.find((c) => c.id === selectedId) : null;

  const resetForm = () => {
    setFormName("");
    setFormGender("");
    setFormDocType("");
    setFormDocNo("");
    setFormPhone("");
    setFormNotes("");
    setFormError("");
  };

  const openAdd = () => {
    resetForm();
    setFormMode({ type: "add" });
    setSelectedId(null);
    setBlacklistPanelId(null);
  };

  const openEdit = (customer: CustomerRow) => {
    setFormName(customer.name);
    setFormGender(customer.gender ?? "");
    setFormDocType(customer.document_type ?? "");
    setFormDocNo("");
    setFormPhone(customer.phone ?? "");
    setFormNotes(customer.notes ?? "");
    setFormError("");
    setFormMode({ type: "edit", customer });
    setBlacklistPanelId(null);
  };

  const handleSave = async () => {
    if (!formName.trim() || formName.trim().length < 2) {
      setFormError(t.validation.nameRequired);
      return;
    }
    setSaving(true);
    setFormError("");

    if (formMode?.type === "add") {
      const result = await createCustomer({
        name: formName.trim(),
        gender: formGender || null,
        document_type: formDocType || null,
        document_no_plain: formDocNo || undefined,
        phone: formPhone || null,
        notes: formNotes || null,
      });
      if (result.success) {
        setFormMode(null);
        resetForm();
      } else {
        setFormError(result.error ?? "Failed to create customer.");
      }
    } else if (formMode?.type === "edit") {
      const result = await updateCustomer(formMode.customer.id, {
        name: formName.trim(),
        gender: formGender || null,
        document_type: formDocType || null,
        document_no_plain: formDocNo || undefined,
        phone: formPhone || null,
        notes: formNotes || null,
      });
      if (result.success) {
        setFormMode(null);
        resetForm();
      } else {
        setFormError(result.error ?? "Failed to update customer.");
      }
    }
    setSaving(false);
  };

  const handleBlacklist = async () => {
    if (!blReason.trim()) {
      setBlError(t.blacklist.reasonRequired);
      return;
    }
    setBlSaving(true);
    setBlError("");
    const result = await setCustomerBlacklist(blacklistPanelId!, blReason, blPermanent);
    if (result.success) {
      setBlacklistPanelId(null);
      setBlReason("");
      setBlPermanent(true);
    } else {
      setBlError(result.error ?? "Failed to blacklist.");
    }
    setBlSaving(false);
  };

  const handleUnblacklist = async (id: string) => {
    setBlSaving(true);
    await removeCustomerBlacklist(id);
    setBlSaving(false);
    setBlacklistPanelId(null);
  };

  const inputClass =
    "w-full rounded border border-black/15 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-orange/30";
  const labelClass = "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";

  const isFormOpen = formMode !== null;
  const isBlacklistOpen = blacklistPanelId !== null;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={showBlacklistedOnly}
              onChange={(e) => setShowBlacklistedOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            {t.blacklist.title}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled
            className="inline-flex items-center gap-1.5 rounded border border-black/15 bg-white px-3 py-1.5 text-xs font-medium text-slate-400"
            title={t.actions.mergePlaceholder}
          >
            <GitMerge className="h-3.5 w-3.5" />
            {t.actions.merge}
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.actions.add}
          </button>
        </div>
      </div>

      {/* Blacklist warning banner */}
      {selected?.is_blacklisted && (
        <div className="mb-4 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span className="font-semibold text-red-700">{t.blacklist.warnTitle}</span>
          <span className="text-red-600">— {t.blacklist.warnMessage}</span>
        </div>
      )}

      {/* Table / Empty */}
      {filtered.length === 0 && !isFormOpen ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-black/10 bg-white py-16 shadow-soft">
          <p className="text-sm text-slate-400">{t.empty}</p>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.actions.add}
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-black/10 bg-white shadow-soft">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t.fields.name}</th>
                <th className="px-4 py-3">{t.fields.phone}</th>
                <th className="px-4 py-3">{t.fields.documentType}</th>
                <th className="px-4 py-3">{t.blacklist.title}</th>
                <th className="px-4 py-3 sr-only">{t.actions.edit}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={cn(
                    "cursor-pointer transition",
                    c.is_blacklisted
                      ? "bg-red-50/50 hover:bg-red-50"
                      : "hover:bg-orange-50/50",
                    selectedId === c.id && "ring-1 ring-inset ring-brand-orange"
                  )}
                  onClick={() => {
                    setSelectedId(selectedId === c.id ? null : c.id);
                    setFormMode(null);
                    setBlacklistPanelId(null);
                  }}
                >
                  <td className="px-4 py-3">
                    <span className="font-semibold text-brand-ink">{c.name}</span>
                    {c.gender && (
                      <span className="ml-1.5 text-xs text-slate-400">
                        {t.gender[c.gender as keyof typeof t.gender] ?? c.gender}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.phone ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.document_type
                      ? t.documentTypes[c.document_type as keyof typeof t.documentTypes] ?? c.document_type
                      : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {c.is_blacklisted ? (
                      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        {c.blacklist_permanent ? t.blacklist.permanent : t.blacklist.temporary}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(c);
                      }}
                      className="text-xs font-medium text-brand-orange transition hover:underline"
                    >
                      {t.actions.edit}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        {filtered.length} / {customers.length} {locale === "fr" ? "clients" : "位客户"}
      </p>

      {/* Add/Edit Form Panel */}
      {isFormOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setFormMode(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto border-l border-black/10 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-5 py-4">
              <h3 className="text-lg font-bold text-brand-ink">
                {formMode.type === "add" ? t.actions.add : t.actions.edit}
              </h3>
              <button
                onClick={() => setFormMode(null)}
                className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              {/* Name */}
              <div>
                <label className={labelClass}>{t.fields.name} *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className={inputClass}
                  placeholder={t.fields.name}
                />
              </div>

              {/* Gender */}
              <div>
                <label className={labelClass}>{t.fields.gender}</label>
                <select
                  value={formGender}
                  onChange={(e) => setFormGender(e.target.value)}
                  className={inputClass}
                >
                  <option value="">-</option>
                  <option value="male">{t.gender.male}</option>
                  <option value="female">{t.gender.female}</option>
                  <option value="other">{t.gender.other}</option>
                </select>
              </div>

              {/* Document type */}
              <div>
                <label className={labelClass}>{t.fields.documentType}</label>
                <select
                  value={formDocType}
                  onChange={(e) => setFormDocType(e.target.value)}
                  className={inputClass}
                >
                  <option value="">-</option>
                  <option value="id_card">{t.documentTypes.id_card}</option>
                  <option value="passport">{t.documentTypes.passport}</option>
                  <option value="drivers_license">{t.documentTypes.drivers_license}</option>
                </select>
              </div>

              {/* Document number */}
              <div>
                <label className={labelClass}>{t.fields.documentNumber}</label>
                <input
                  type="text"
                  value={formDocNo}
                  onChange={(e) => setFormDocNo(e.target.value)}
                  className={inputClass}
                  placeholder={
                    formMode.type === "edit" ? "留空则不修改" : t.fields.documentNumber
                  }
                />
                <p className="mt-1 text-xs text-slate-400">
                  {formMode.type === "edit" ? "留空则保持原证件号不变" : "证件号将加密存储"}
                </p>
              </div>

              {/* Phone */}
              <div>
                <label className={labelClass}>{t.fields.phone}</label>
                <input
                  type="text"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className={inputClass}
                  placeholder={t.fields.phone}
                />
              </div>

              {/* Notes */}
              <div>
                <label className={labelClass}>{t.fields.notes}</label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={3}
                  className={inputClass}
                  placeholder={t.fields.notes}
                />
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
                >
                  {saving ? "..." : t.actions.save}
                </button>
                <button
                  onClick={() => setFormMode(null)}
                  className="rounded px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  {t.actions.cancel}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Selected row detail + blacklist controls */}
      {selected && !isFormOpen && !isBlacklistOpen && (
        <div className="mt-4 rounded-md border border-black/10 bg-white p-4 shadow-soft">
          <div className="flex items-start justify-between">
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-slate-400">{t.fields.name}:</span>{" "}
                <span className="font-semibold text-brand-ink">{selected.name}</span>
              </p>
              {selected.gender && (
                <p>
                  <span className="text-slate-400">{t.fields.gender}:</span>{" "}
                  {t.gender[selected.gender as keyof typeof t.gender] ?? selected.gender}
                </p>
              )}
              {selected.phone && (
                <p>
                  <span className="text-slate-400">{t.fields.phone}:</span> {selected.phone}
                </p>
              )}
              {selected.document_type && (
                <p>
                  <span className="text-slate-400">{t.fields.documentType}:</span>{" "}
                  {t.documentTypes[selected.document_type as keyof typeof t.documentTypes] ??
                    selected.document_type}
                </p>
              )}
              {selected.notes && (
                <p>
                  <span className="text-slate-400">{t.fields.notes}:</span> {selected.notes}
                </p>
              )}
              {selected.is_blacklisted && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-700">{t.blacklist.title}</p>
                  {selected.blacklist_reason && (
                    <p className="text-xs text-red-600">
                      {t.blacklist.reason}: {selected.blacklist_reason}
                    </p>
                  )}
                  {selected.blacklist_date && (
                    <p className="text-xs text-red-600">
                      {t.blacklist.date}: {selected.blacklist_date}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openEdit(selected)}
                className="rounded border border-black/15 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {t.actions.edit}
              </button>
              {selected.is_blacklisted ? (
                <button
                  onClick={() => handleUnblacklist(selected.id)}
                  disabled={blSaving}
                  className="inline-flex items-center gap-1.5 rounded border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition hover:bg-green-100 disabled:opacity-50"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  {t.blacklist.remove}
                </button>
              ) : (
                <button
                  onClick={() => {
                    setBlacklistPanelId(selected.id);
                    setBlReason("");
                    setBlPermanent(true);
                    setBlError("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
                >
                  <UserX className="h-3.5 w-3.5" />
                  {t.blacklist.add}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Blacklist form panel */}
      {isBlacklistOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setBlacklistPanelId(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-auto border-l border-black/10 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-5 py-4">
              <h3 className="text-lg font-bold text-brand-ink">{t.blacklist.add}</h3>
              <button
                onClick={() => setBlacklistPanelId(null)}
                className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div>
                <label className={labelClass}>{t.blacklist.reason} *</label>
                <textarea
                  value={blReason}
                  onChange={(e) => setBlReason(e.target.value)}
                  rows={3}
                  className={inputClass}
                  placeholder={t.blacklist.reason}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={blPermanent}
                  onChange={(e) => setBlPermanent(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-orange focus:ring-brand-orange"
                />
                {t.blacklist.permanent}
              </label>
              {blError && <p className="text-sm text-red-600">{blError}</p>}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleBlacklist}
                  disabled={blSaving}
                  className="inline-flex items-center gap-1.5 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  <UserX className="h-4 w-4" />
                  {blSaving ? "..." : t.blacklist.add}
                </button>
                <button
                  onClick={() => setBlacklistPanelId(null)}
                  className="rounded px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  {t.actions.cancel}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
