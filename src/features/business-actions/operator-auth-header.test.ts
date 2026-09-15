import { describe, expect, it } from "vitest";
import { extractBearerToken } from "./operator-auth-header";

describe("operator bearer header", () => {
  it("reads one bearer token without logging or decoding it", () => {
    expect(extractBearerToken("Bearer header.payload.signature")).toBe("header.payload.signature");
    expect(extractBearerToken("bearer token-value")).toBe("token-value");
  });

  it("rejects malformed, blank and oversized values", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("Bearer one two")).toBeNull();
    expect(extractBearerToken(`Bearer ${"x".repeat(8_193)}`)).toBeNull();
  });
});

