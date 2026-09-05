import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractReceiptTextFromImage } from "@/lib/receipt-ocr";

const ORIGINAL_ENV = {
  OCR_PROVIDER: process.env.OCR_PROVIDER,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  DEEPSEEK_VISION_MODEL: process.env.DEEPSEEK_VISION_MODEL,
};

function restoreEnv(name: keyof typeof ORIGINAL_ENV) {
  const value = ORIGINAL_ENV[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe.sequential("receipt OCR providers", () => {
  beforeEach(() => {
    process.env.OCR_PROVIDER = "deepseek-vision-exp";
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv("OCR_PROVIDER");
    restoreEnv("DEEPSEEK_API_KEY");
    restoreEnv("DEEPSEEK_BASE_URL");
    restoreEnv("DEEPSEEK_VISION_MODEL");
  });

  it("returns an explicit configuration error instead of treating it as OCR text", async () => {
    const result = await extractReceiptTextFromImage(Buffer.from("image"), "receipt.png");
    expect(result).toMatchObject({ provider: "deepseek-vision-exp", rawText: "", error: "DEEPSEEK_API_KEY not set." });
  });

  it("uses the experimental vision model without changing the text classifier model", async () => {
    process.env.DEEPSEEK_API_KEY = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        raw_text: "房号 906 金额 80000",
        room_no: "906",
        amount_xof: 80000,
        currency: "XOF",
        warnings: [],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractReceiptTextFromImage(Buffer.from("image"), "receipt.jpg");

    expect(result.error).toBeUndefined();
    expect(result.structured).toMatchObject({ room_no: "906", amount_xof: 80000, currency: "XOF" });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("deepseek-v4-flash-vision-exp");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[0].content.map((part: { type: string }) => part.type)).toEqual(["text", "image_url"]);
  });

  it("rejects PDFs before any external request is sent", async () => {
    process.env.DEEPSEEK_API_KEY = "test-only-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractReceiptTextFromImage(Buffer.from("pdf"), "receipt.pdf");
    expect(result.error).toContain("only accepts PNG, JPEG, WebP, or GIF");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown provider", async () => {
    process.env.OCR_PROVIDER = "unknown-provider";
    const result = await extractReceiptTextFromImage(Buffer.from("image"), "receipt.png");
    expect(result).toMatchObject({ provider: "unknown-provider", rawText: "" });
    expect(result.error).toContain("Unsupported OCR provider");
  });
});
