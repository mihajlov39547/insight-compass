// @ts-nocheck

export interface PdfRasterizationResult {
  page_images: Uint8Array[];
  page_count: number | null;
  rendered_page_count: number;
  warning?: string;
}

export async function rasterizePdfPagesForOcr(
  pdfBytes: Uint8Array,
  options?: {
    maxPages?: number;
    scale?: number;
  }
): Promise<PdfRasterizationResult> {
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? 8, 50));
  const scale = Math.max(1, Math.min(options?.scale ?? 1.8, 3));

  if (typeof OffscreenCanvas === "undefined") {
    return {
      page_images: [],
      page_count: null,
      rendered_page_count: 0,
      warning: "OffscreenCanvas is unavailable in current Edge runtime",
    };
  }

  let pdfjsLib: any;
  try {
    pdfjsLib = await import("https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs?target=es2022");
  } catch (error) {
    return {
      page_images: [],
      page_count: null,
      rendered_page_count: 0,
      warning: error instanceof Error
        ? `Failed to load pdfjs-dist: ${error.message}`
        : "Failed to load pdfjs-dist",
    };
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytes,
      disableWorker: true,
      useSystemFonts: false,
      isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;
    const totalPages = Number(pdf?.numPages ?? 0);
    const toRender = Math.min(totalPages, maxPages);

    const pageImages: Uint8Array[] = [];

    for (let pageNo = 1; pageNo <= toRender; pageNo++) {
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
    }

    return {
      page_images: pageImages,
      page_count: totalPages,
      rendered_page_count: pageImages.length,
      warning: totalPages > maxPages
        ? `Rendered first ${maxPages} pages only (of ${totalPages}) for OCR budget`
        : undefined,
    };
  } catch (error) {
    return {
      page_images: [],
      page_count: null,
      rendered_page_count: 0,
      warning: error instanceof Error
        ? `PDF rasterization failed: ${error.message}`
        : "PDF rasterization failed",
    };
  }
}
