/**
 * Receipt OCR abstraction layer.
 *
 * OCR providers are NOT bundled in the SACIS codebase.
 * Add a real provider (OpenAI Vision, Google Document AI, etc.) by implementing
 * `extractReceiptTextFromImage` with actual API calls.
 *
 * The mock fallback returns a placeholder so the UI pipeline can be tested
 * without a real OCR provider.
 */

export interface OcrResult {
  /** Full extracted text. */
  rawText: string;
  /** Provider name, e.g. "openai-vision", "google-document-ai", "mock". */
  provider: string;
  /** ISO timestamp when OCR ran. */
  processedAt: string;
  /** Error message (if extraction failed), otherwise null. */
  error?: string | null;
}

/**
 * Extract text from a receipt image.
 *
 * @param fileBuffer Raw image bytes
 * @param fileName Original file name (used for MIME detection)
 * @returns Structured OCR result with raw text
 */
export async function extractReceiptTextFromImage(
  fileBuffer: Buffer,
  fileName: string,
): Promise<OcrResult> {
  // ═══════════════════════════════════════════════════════
  // TODO: Replace this mock with a real OCR provider:
  //
  //   OpenAI Vision:
  //     POST https://api.openai.com/v1/chat/completions
  //     { model: "gpt-4o", messages: [{ role: "user",
  //       content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,.." } },
  //                 { type: "text", text: "Extract all text from this receipt image." }]
  //     }]}
  //
  //   Google Document AI:
  //     const client = new DocumentProcessorServiceClient();
  //     const [result] = await client.processDocument({ name, ... });
  //
  //   Azure Document Intelligence:
  //     const client = new DocumentAnalysisClient(endpoint, credential);
  //     const poller = await client.beginAnalyzeDocument("prebuilt-receipt", fileBuffer);
  // ═══════════════════════════════════════════════════════

  const provider = process.env.OCR_PROVIDER ?? "mock";
  const processedAt = new Date().toISOString();

  try {
    if (provider === "openai-vision") {
      const result = await extractWithOpenAiVision(fileBuffer, fileName);
      return { ...result, provider, processedAt };
    }

    // Mock fallback: return placeholder text for UI testing
    return {
      rawText: [
        "=== RECEIPT (MOCK OCR - No OCR provider configured) ===",
        `File: ${fileName}`,
        `Size: ${fileBuffer.length} bytes`,
        "",
        "Set OCR_PROVIDER=openai-vision and OPENAI_API_KEY to enable real OCR.",
        "Or manually paste the receipt text in the UI.",
      ].join("\n"),
      provider,
      processedAt,
      error: null,
    };
  } catch (err) {
    return {
      rawText: "",
      provider,
      processedAt,
      error: err instanceof Error ? err.message : "OCR extraction failed",
    };
  }
}

// ── OpenAI Vision implementation ──────────────────────────

async function extractWithOpenAiVision(
  fileBuffer: Buffer,
  fileName: string,
): Promise<{ rawText: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { rawText: "OPENAI_API_KEY not set. Cannot use openai-vision provider." };
  }

  const mime = detectMime(fileName);
  const base64 = fileBuffer.toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
            {
              type: "text",
              text: [
                "Extract ALL text visible in this receipt image.",
                "Return the raw text exactly as it appears — do not summarize or translate.",
                "Include: receipt number, date, amounts, payer name, period covered, room number if visible.",
                "Preserve line breaks where reasonable.",
              ].join("\n"),
            },
          ],
        },
      ],
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { rawText: `OpenAI Vision error: ${res.status} — ${errText.slice(0, 200)}` };
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { rawText: text };
}

function detectMime(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}
