// @ts-nocheck

export interface PdfRasterizationResult {
  page_images: Uint8Array[];
  page_count: number | null;
  rendered_page_count: number;
  rendered_page_numbers: number[];
  warning?: string;
}

export interface PdfTextLayerInspectionResult {
  page_count: number;
  pages_with_text_count: number;
  pages_without_text_count: number;
  pages_with_text: number[];
  pages_without_text: number[];
  has_selectable_text: boolean;
  pdf_text_status: "HAS_SELECTABLE_TEXT" | "LIKELY_SCANNED";
  warning?: string;
}

let pdfjsLibCache: any | null = null;

async function getPdfJsLib(): Promise<any> {
  if (pdfjsLibCache) return pdfjsLibCache;
  pdfjsLibCache = await import("https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs?target=es2022");
  return pdfjsLibCache;
}

async function loadPdfDocument(pdfBytes: Uint8Array): Promise<any> {
  const pdfjsLib = await getPdfJsLib();
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes,
    disableWorker: true,
    useSystemFonts: false,
    isEvalSupported: false,
  });
  return loadingTask.promise;
}

function extractPageTextLength(textContent: any): number {
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  let total = 0;
  for (const item of items) {
    const s = typeof item?.str === "string" ? item.str : "";
    total += s.trim().length;
  }
  return total;
}

export async function inspectPdfTextLayerDetailed(
  pdfBytes: Uint8Array,
  options?: {
    minCharsPerPage?: number;
    maxPages?: number;
  }
): Promise<PdfTextLayerInspectionResult> {
  const minCharsPerPage = Math.max(1, Math.min(options?.minCharsPerPage ?? 20, 500));

  try {
    const pdf = await loadPdfDocument(pdfBytes);
    const totalPages = Number(pdf?.numPages ?? 0);
    const toInspect = options?.maxPages
      ? Math.min(totalPages, Math.max(1, options.maxPages))
      : totalPages;

    const pagesWithText: number[] = [];
    const pagesWithoutText: number[] = [];

    for (let pageNo = 1; pageNo <= toInspect; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const textContent = await page.getTextContent();
      const textLen = extractPageTextLength(textContent);

      if (textLen >= minCharsPerPage) {
        pagesWithText.push(pageNo);
      } else {
        pagesWithoutText.push(pageNo);
      }
    }

    const hasSelectableText = pagesWithText.length > 0;
    return {
      page_count: totalPages,
      pages_with_text_count: pagesWithText.length,
      pages_without_text_count: pagesWithoutText.length,
      pages_with_text: pagesWithText,
      pages_without_text: pagesWithoutText,
      has_selectable_text: hasSelectableText,
      pdf_text_status: hasSelectableText ? "HAS_SELECTABLE_TEXT" : "LIKELY_SCANNED",
      warning: totalPages > toInspect
        ? `Inspected first ${toInspect} pages out of ${totalPages}`
        : undefined,
    };
  } catch (error) {
    return {
      page_count: 0,
      pages_with_text_count: 0,
      pages_without_text_count: 0,
      pages_with_text: [],
      pages_without_text: [],
      has_selectable_text: false,
      pdf_text_status: "LIKELY_SCANNED",
      warning: error instanceof Error
        ? `PDF text-layer inspection failed: ${error.message}`
        : "PDF text-layer inspection failed",
    };
  }
}

export async function rasterizePdfPagesForOcr(
  pdfBytes: Uint8Array,
  options?: {
    maxPages?: number;
    scale?: number;
    pageNumbers?: number[];
  }
): Promise<PdfRasterizationResult> {
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? 8, 50));
  const scale = Math.max(1, Math.min(options?.scale ?? 1.8, 3));

  if (typeof OffscreenCanvas === "undefined") {
    return {
      page_images: [],
      page_count: null,
      rendered_page_count: 0,
      rendered_page_numbers: [],
      warning: "OffscreenCanvas is unavailable in current Edge runtime",
    };
  }

  try {
    await getPdfJsLib();
  } catch (error) {
    return {
      page_images: [],
      page_count: null,
      rendered_page_count: 0,
      rendered_page_numbers: [],
      warning: error instanceof Error
        ? `Failed to load pdfjs-dist: ${error.message}`
        : "Failed to load pdfjs-dist",
    };
  }

  try {
    const pdf = await loadPdfDocument(pdfBytes);
    const totalPages = Number(pdf?.numPages ?? 0);

    const requestedPages = Array.isArray(options?.pageNumbers)
      ? options!.pageNumbers
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= totalPages)
          .map((n) => Math.floor(n))
      : [];

    const pageNumbers = requestedPages.length > 0
      ? Array.from(new Set(requestedPages)).slice(0, maxPages)
      : Array.from({ length: Math.min(totalPages, maxPages) }, (_, i) => i + 1);

    const pageImages: Uint8Array[] = [];
    const renderedPageNumbers: number[] = [];

    for (const pageNo of pageNumbers) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale });

      const canvas = new OffscreenCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height))
      );
      const context = canvas.getContext("2d");
      if (!context) {
        return {
          page_images: pageImages,
          page_count: totalPages,
          rendered_page_count: pageImages.length,
          rendered_page_numbers: renderedPageNumbers,
          warning: "2D canvas context is unavailable for PDF rasterization",
        };
      }

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      const blob = await canvas.convertToBlob({ type: "image/png" });
      const arr = new Uint8Array(await blob.arrayBuffer());
      pageImages.push(arr);
      renderedPageNumbers.push(pageNo);
    }

    return {
      page_images: pageImages,
      page_count: totalPages,
      rendered_page_count: pageImages.length,
      rendered_page_numbers: renderedPageNumbers,
      warning: totalPages > pageImages.length
        ? `Rendered ${pageImages.length} page(s) out of ${totalPages} for OCR budget`
        : undefined,
    };
  } catch (error) {
    return {
      page_images: [],
      page_count: null,
      rendered_page_count: 0,
      rendered_page_numbers: [],
      warning: error instanceof Error
        ? `PDF rasterization failed: ${error.message}`
        : "PDF rasterization failed",
    };
  }
}
