import { describe, expect, it } from "vitest";
import { extractDocxRawTextWithMammoth } from "../../supabase/functions/_shared/document-processing/docx-mammoth";

describe("extractDocxRawTextWithMammoth", () => {
  it("extracts Serbian Cyrillic text with raw method", async () => {
    const source = "Ово је тест документ на српској ћирилици.";

    const result = await extractDocxRawTextWithMammoth(new Uint8Array([1, 2, 3]), {
      timeoutMs: 500,
      extractRawText: async () => ({ value: source }),
    });

    expect(result.method).toBe("docx_mammoth_raw");
    expect(result.text).toBe(source);
  });

  it("extracts Serbian Latin text with raw method", async () => {
    const source = "Ovo je test dokument na srpskom latinici.";

    const result = await extractDocxRawTextWithMammoth(new Uint8Array([4, 5, 6]), {
      timeoutMs: 500,
      extractRawText: async () => ({ value: source }),
    });

    expect(result.method).toBe("docx_mammoth_raw");
    expect(result.text).toBe(source);
  });

  it("returns controlled timeout result", async () => {
    const result = await extractDocxRawTextWithMammoth(new Uint8Array([7, 8, 9]), {
      timeoutMs: 20,
      extractRawText: async () => {
        await new Promise(() => {
          // never resolves
        });
        return { value: "" };
      },
    });

    expect(result.method).toBe("docx_mammoth_timeout");
    expect(result.text).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns controlled error result", async () => {
    const result = await extractDocxRawTextWithMammoth(new Uint8Array([10]), {
      timeoutMs: 500,
      extractRawText: async () => {
        throw new Error("boom");
      },
    });

    expect(result.method).toBe("docx_mammoth_error");
    expect(result.text).toBe("");
    expect(result.error).toContain("boom");
  });
});
