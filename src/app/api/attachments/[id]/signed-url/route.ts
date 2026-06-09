import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Generate a signed URL for a receipt image stored in the private receipts bucket. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await params;
    const supabase = await createClient();

    const { data: att, error } = await supabase.from("attachments")
      .select("storage_path, bucket")
      .eq("id", id).single();

    if (error || !att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

    const { data, error: signErr } = await supabase.storage
      .from(att.bucket ?? "receipts")
      .createSignedUrl(att.storage_path, 3600); // 1 hour

    if (signErr || !data?.signedUrl) {
      return NextResponse.json({ error: "Failed to generate signed URL" }, { status: 500 });
    }

    return NextResponse.json({ signedUrl: data.signedUrl });
  } catch (err) {
    console.error("signed-url error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
