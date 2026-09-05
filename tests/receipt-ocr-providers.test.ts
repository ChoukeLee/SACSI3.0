import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractReceiptTextFromImage } from "@/lib/receipt-ocr";

const ORIGINAL_ENV = {
  OCR_PROVIDER: process.env.OCR_PROVIDER,
  QWEN_API_KEY: process.env.QWEN_API_KEY,
  QWEN_BASE_URL: process.env.QWEN_BASE_URL,
  QWEN_VISION_MODEL: process.env.QWEN_VISION_MODEL,
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
    process.env.OCR_PROVIDER = "qwen-vl-plus";
    process.env.QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    process.env.QWEN_VISION_MODEL = "qwen-vl-plus";
    delete process.env.QWEN_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const name of Object.keys(ORIGINAL_ENV) as Array<keyof typeof ORIGINAL_ENV>) restoreEnv(name);
  });

  it("returns an explicit missing-key error instead of treating it as OCR text", async () => {
    const result = await extractReceiptTextFromImage(Buffer.from("image"), "receipt.png");
    expect(result).toMatchObject({ provider: "qwen-vl-plus", rawText: "", error: "QWEN_API_KEY not set." });
  });

  it("parses structured fields from the configured visual provider", async () => {
    process.env.QWEN_API_KEY = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ building_code: "SACSI11", room_no: "906", amount_xof: 80000, currency: "XOF", warnings: [] }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractReceiptTextFromImage(Buffer.from("image"), "receipt.jpg");

    expect(result.error).toBeUndefined();
    expect(result.structured).toMatchObject({ building_code: "SACSI11", room_no: "906", amount_xof: 80000, currency: "XOF" });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("qwen-vl-plus");
    expect(body.messages[0].content.map((part: { type: string }) => part.type)).toEqual(["image_url", "text"]);
  });

  it("uses the dedicated DeepSeek vision model without changing the text model", async () => {
    process.env.OCR_PROVIDER = "deepseek-vision-exp";
    process.env.DEEPSEEK_API_KEY = "test-only-key";
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ raw_text: "11号楼 906 金额80000", building_code: "SACSI11", room_no: "906", amount_xof: 80000, currency: "XOF", warnings: [] }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractReceiptTextFromImage(Buffer.from("image"), "receipt.png");
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ provider: "deepseek-vision-exp", rawText: "11号楼 906 金额80000" });
    expect(result.structured).toMatchObject({ building_code: "SACSI11", room_no: "906", amount_xof: 80000 });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("deepseek-v4-flash-vision-exp");
    expect(body.messages[0].content.map((part: { type: string }) => part.type)).toEqual(["text", "image_url"]);
  });

  it("fails closed for any unknown provider", async () => {
    process.env.OCR_PROVIDER = "unknown-provider";
    const result = await extractReceiptTextFromImage(Buffer.from("image"), "receipt.png");
    expect(result).toMatchObject({ provider: "unknown-provider", rawText: "" });
    expect(result.error).toContain("Unsupported OCR provider");
  });
});
