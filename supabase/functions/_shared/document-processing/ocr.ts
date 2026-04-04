// @ts-nocheck

import { rasterizePdfPagesForOcr } from "./pdf-rasterization.ts";
import { inspectPdfTextLayerDetailed } from "./pdf-rasterization.ts";

export interface OcrResult {
  text: string;
  confidence: number | null;
  engine: string;
  model?: string;
  warning?: string;
  languages?: string;
  page_count?: number | null;
  processed_page_count?: number;
  processed_page_numbers?: number[];
  pdf_text_status?: "HAS_SELECTABLE_TEXT" | "LIKELY_SCANNED";
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

function resolveTesseractLanguages(): string {
  const raw = String(Deno.env.get("DOCUMENT_OCR_LANGS") || "srp_latn+srp+eng").trim();
  if (!raw) return "eng";
  return raw.replace(/,/g, "+").replace(/\s+/g, "");
}

let createWorkerCache: ((...args: any[]) => Promise<any>) | null = null;

async function getCreateWorker(): Promise<(...args: any[]) => Promise<any>> {
  if (createWorkerCache) return createWorkerCache;

  const mod = await import("https://esm.sh/tesseract.js@5.1.1?target=es2022");
  if (typeof mod.createWorker !== "function") {
    throw new Error("tesseract.js createWorker export not available");
  }

  createWorkerCache = mod.createWorker;
  return createWorkerCache;
}

async function runTesseractSingleImage(
  imageBytes: Uint8Array,
  mimeType: string,
  languages: string
): Promise<OcrResult> {
  let worker: any = null;
  try {
    const createWorker = await getCreateWorker();
    worker = await createWorker(languages);

    const imageDataUrl = `data:${mimeType || "image/png"};base64,${bytesToBase64(imageBytes)}`;
    const ret = await worker.recognize(imageDataUrl);
    const text = String(ret?.data?.text || "").trim();
    const confidence = typeof ret?.data?.confidence === "number"
      ? Math.round(ret.data.confidence * 100) / 100
      : estimateConfidenceFromText(text);

    return {
      text,
      confidence,
      engine: "tesseract.js",
      model: "tesseract.js@5",
      languages,
      warning: text ? undefined : "Tesseract OCR returned empty text",
    };
  } catch (error) {
    return {
      text: "",
      confidence: null,
      engine: "tesseract.js",
      model: "tesseract.js@5",
      languages,
      warning: error instanceof Error ? error.message : "Tesseract OCR execution error",
    };
  } finally {
    try {
      if (worker) await worker.terminate();
    } catch {
      // ignore terminate failures
    }
  }
}

async function runTesseractImageBatch(
  pageImages: Uint8Array[],
  languages: string
): Promise<OcrResult> {
  if (pageImages.length === 0) {
    return {
      text: "",
      confidence: null,
      engine: "tesseract.js",
      model: "tesseract.js@5",
      languages,
      page_count: 0,
      processed_page_count: 0,
      warning: "No page images were provided for OCR",
    };
  }

  let worker: any = null;
  try {
    const createWorker = await getCreateWorker();
    worker = await createWorker(languages);

    const parts: string[] = [];
    const confidences: number[] = [];

    for (const pageImage of pageImages) {
      const imageDataUrl = `data:image/png;base64,${bytesToBase64(pageImage)}`;
      const ret = await worker.recognize(imageDataUrl);
      const text = String(ret?.data?.text || "").trim();
      if (text) parts.push(text);
      if (typeof ret?.data?.confidence === "number") {
        confidences.push(ret.data.confidence);
      }
    }

    const joined = parts.join("\n\n").trim();
    const avgConfidence = confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : estimateConfidenceFromText(joined);

    return {
      text: joined,
      confidence: avgConfidence,
      engine: "tesseract.js",
      model: "tesseract.js@5",
      languages,
      page_count: pageImages.length,
      processed_page_count: pageImages.length,
      warning: joined ? undefined : "Tesseract OCR returned empty text for rasterized PDF pages",
    };
  } catch (error) {
    return {
      text: "",
      confidence: null,
      engine: "tesseract.js",
      model: "tesseract.js@5",
      languages,
      page_count: pageImages.length,
      processed_page_count: 0,
      warning: error instanceof Error ? error.message : "Tesseract batch OCR execution error",
    };
  } finally {
    try {
      if (worker) await worker.terminate();
    } catch {
      // ignore terminate failures
    }
  }
}

export async function runImageOcrViaTesseract(
  imageBytes: Uint8Array,
  mimeType: string,
  languages?: string | null
): Promise<OcrResult> {
  return runTesseractSingleImage(imageBytes, mimeType, languages || resolveTesseractLanguages());
}

export async function runPdfOcrViaTesseract(
  pdfBytes: Uint8Array,
  options?: {
    languages?: string | null;
    maxPages?: number;
    scale?: number;
    minCharsPerPage?: number;
    forceOcrAllPages?: boolean;
  }
): Promise<OcrResult> {
  const languages = options?.languages || resolveTesseractLanguages();
  const inspection = await inspectPdfTextLayerDetailed(pdfBytes, {
    minCharsPerPage: options?.minCharsPerPage,
    maxPages: options?.maxPages,
  });

  const pagesForOcr = options?.forceOcrAllPages
    ? Array.from({ length: Math.max(inspection.page_count, 0) }, (_, i) => i + 1)
    : (inspection.pages_without_text.length > 0
      ? inspection.pages_without_text
      : Array.from({ length: Math.max(inspection.page_count, 0) }, (_, i) => i + 1));

  const rasterized = await rasterizePdfPagesForOcr(pdfBytes, {
    maxPages: options?.maxPages,
    scale: options?.scale,
    pageNumbers: pagesForOcr,
  });

  if (!rasterized.page_images.length) {
    return {
      text: "",
      confidence: null,
      engine: "tesseract.js",
      model: "tesseract.js@5",
      languages,
      page_count: inspection.page_count || rasterized.page_count,
      processed_page_count: 0,
      processed_page_numbers: [],
      pdf_text_status: inspection.pdf_text_status,
      warning: [
        inspection.warning,
        rasterized.warning,
        "No rasterized PDF pages were available for Tesseract OCR",
      ].filter(Boolean).join(" | "),
    };
  }

  const result = await runTesseractImageBatch(
    rasterized.page_images,
    languages
  );

  return {
    ...result,
    page_count: inspection.page_count || rasterized.page_count,
    processed_page_count: rasterized.rendered_page_count,
    processed_page_numbers: rasterized.rendered_page_numbers,
    pdf_text_status: inspection.pdf_text_status,
    warning: [
      inspection.warning,
      rasterized.warning,
      result.warning,
    ].filter(Boolean).join(" | ") || undefined,
  };
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
