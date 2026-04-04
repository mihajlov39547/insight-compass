// @ts-nocheck

export interface OcrResult {
  text: string;
  confidence: number | null;
  engine: string;
  model?: string;
  warning?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function estimateConfidenceFromText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const len = trimmed.length;
  const confidence = Math.min(0.95, 0.35 + len / 5000);
  return Math.round(confidence * 100) / 100;
}

export async function runImageOcrViaGateway(
  imageBytes: Uint8Array,
  mimeType: string,
  lovableApiKey?: string | null
): Promise<OcrResult> {
  if (!lovableApiKey) {
    return {
      text: "",
      confidence: null,
      engine: "ai_gateway",
      model: "google/gemini-2.5-flash-lite",
      warning: "LOVABLE_API_KEY is missing",
    };
  }

  const safeMime = mimeType?.startsWith("image/") ? mimeType : "image/png";
  const imageBase64 = bytesToBase64(imageBytes);
  const imageDataUrl = `data:${safeMime};base64,${imageBase64}`;
  const model = "google/gemini-2.5-flash-lite";

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an OCR extractor. Extract all readable text from the image exactly as seen. " +
              "Return only plain text. No markdown. No explanations.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all readable text from this image.",
              },
              {
                type: "image_url",
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      return {
        text: "",
        confidence: null,
        engine: "ai_gateway",
        model,
        warning: `OCR API request failed (${resp.status})`,
      };
    }

    const data = await resp.json();
    const text = String(data?.choices?.[0]?.message?.content || "").trim();

    return {
      text,
      confidence: estimateConfidenceFromText(text),
      engine: "ai_gateway_multimodal",
      model,
      warning: text ? undefined : "OCR returned empty text",
    };
  } catch (error) {
    return {
      text: "",
      confidence: null,
      engine: "ai_gateway",
      model,
      warning: error instanceof Error ? error.message : "OCR execution error",
    };
  }
}

export async function runPdfOcrViaExternalService(
  pdfBytes: Uint8Array,
  serviceUrl?: string | null,
  serviceToken?: string | null
): Promise<OcrResult> {
  if (!serviceUrl) {
    return {
      text: "",
      confidence: null,
      engine: "external_pdf_ocr",
      warning: "PDF_OCR_SERVICE_URL is not configured",
    };
  }

  const payload = {
    pdf_base64: bytesToBase64(pdfBytes),
  };

  try {
    const resp = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      return {
        text: "",
        confidence: null,
        engine: "external_pdf_ocr",
        warning: `External PDF OCR request failed (${resp.status})`,
      };
    }

    const data = await resp.json();
    const text = String(data?.text || "").trim();
    const confidence = typeof data?.confidence === "number"
      ? data.confidence
      : estimateConfidenceFromText(text);

    return {
      text,
      confidence,
      engine: String(data?.engine || "external_pdf_ocr"),
      model: typeof data?.model === "string" ? data.model : undefined,
      warning: text ? undefined : "External PDF OCR returned empty text",
    };
  } catch (error) {
    return {
      text: "",
      confidence: null,
      engine: "external_pdf_ocr",
      warning: error instanceof Error ? error.message : "External PDF OCR execution error",
    };
  }
}
