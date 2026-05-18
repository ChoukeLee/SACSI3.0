"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CustomerRow } from "@/types/database";

// ── Form input types (only the fields a user can fill in) ──

export interface CustomerFormInput {
  name: string;
  gender?: string | null;
  document_type?: string | null;
  document_no_plain?: string;
  phone?: string | null;
  notes?: string | null;
}

// ── Encryption placeholders ──
// Centralized here so no page hardcodes encryption logic.
// Replace with pgcrypto or app-layer encryption when ready.

export async function encryptDocumentNo(plaintext: string): Promise<string> {
  // TODO: replace with real encryption (pgcrypto or libsodium)
  return plaintext;
}

export async function decryptDocumentNo(encrypted: string): Promise<string> {
  // TODO: replace with real decryption
  return encrypted;
}

// ── CRUD ──

export async function createCustomer(
  input: CustomerFormInput
): Promise<{ success: boolean; data?: CustomerRow; error?: string }> {
  const supabase = await createClient();

  if (!input.name || input.name.trim().length < 2) {
    return { success: false, error: "Name is required (min 2 characters)." };
  }

  const encrypted = input.document_no_plain
    ? await encryptDocumentNo(input.document_no_plain)
    : null;

  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: input.name.trim(),
      gender: input.gender ?? null,
      document_type: input.document_type ?? null,
      encrypted_document_no: encrypted,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/customers");
  revalidatePath("/fr/customers");

  return { success: true, data };
}

export async function updateCustomer(
  id: string,
  input: CustomerFormInput
): Promise<{ success: boolean; data?: CustomerRow; error?: string }> {
  const supabase = await createClient();

  const update: Record<string, unknown> = {};

  if (input.name !== undefined) {
    if (!input.name || input.name.trim().length < 2) {
      return { success: false, error: "Name is required (min 2 characters)." };
    }
    update.name = input.name.trim();
  }
  if (input.gender !== undefined) update.gender = input.gender;
  if (input.document_type !== undefined) update.document_type = input.document_type;
  if (input.document_no_plain !== undefined) {
    update.encrypted_document_no = input.document_no_plain
      ? await encryptDocumentNo(input.document_no_plain)
      : null;
  }
  if (input.phone !== undefined) update.phone = input.phone;
  if (input.notes !== undefined) update.notes = input.notes;

  const { data, error } = await supabase
    .from("customers")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/customers");
  revalidatePath("/fr/customers");

  // audit log
  await supabase.from("audit_logs").insert({
    action: "update",
    entity_type: "customer",
    entity_id: id,
    metadata: { updated_fields: Object.keys(update) },
  });

  return { success: true, data };
}

// ── Blacklist ──

export async function setCustomerBlacklist(
  id: string,
  reason: string,
  permanent: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!reason || reason.trim().length === 0) {
    return { success: false, error: "Blacklist reason is required." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("customers")
    .update({
      is_blacklisted: true,
      blacklist_reason: reason.trim(),
      blacklist_date: new Date().toISOString().slice(0, 10),
      blacklist_permanent: permanent,
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  await supabase.from("audit_logs").insert({
    action: "blacklist_add",
    entity_type: "customer",
    entity_id: id,
    metadata: { reason: reason.trim(), permanent },
  });

  revalidatePath("/customers");
  revalidatePath("/fr/customers");

  return { success: true };
}

export async function removeCustomerBlacklist(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("customers")
    .update({
      is_blacklisted: false,
      blacklist_reason: null,
      blacklist_date: null,
      blacklist_permanent: false,
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  await supabase.from("audit_logs").insert({
    action: "blacklist_remove",
    entity_type: "customer",
    entity_id: id,
    metadata: {},
  });

  revalidatePath("/customers");
  revalidatePath("/fr/customers");

  return { success: true };
}
