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

export async function runImageOcrViaExternalService(
  imageBytes: Uint8Array,
  mimeType: string,
  serviceUrl?: string | null,
  serviceToken?: string | null
): Promise<OcrResult> {
  if (!serviceUrl) {
    return {
      text: "",
      confidence: null,
      engine: "external_image_ocr",
      warning: "IMAGE_OCR_SERVICE_URL or NON_AI_OCR_SERVICE_URL is not configured",
    };
  }

  try {
    const resp = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      },
      body: JSON.stringify({
        image_base64: bytesToBase64(imageBytes),
        mime_type: mimeType,
      }),
    });

    if (!resp.ok) {
      return {
        text: "",
        confidence: null,
        engine: "external_image_ocr",
        warning: `External image OCR request failed (${resp.status})`,
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
      engine: String(data?.engine || "external_image_ocr"),
      model: typeof data?.model === "string" ? data.model : undefined,
      warning: text ? undefined : "External image OCR returned empty text",
    };
  } catch (error) {
    return {
      text: "",
      confidence: null,
      engine: "external_image_ocr",
      warning: error instanceof Error ? error.message : "External image OCR execution error",
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
