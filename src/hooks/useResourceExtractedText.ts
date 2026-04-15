import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ExtractedTextResult {
  extractedText: string | null;
  ocrUsed: boolean;
  extractorSelected: string | null;
  extractorStatus: string | null;
  qualityReason: string | null;
  lastCompletedStage: string | null;
  textLength: number;
  debug: DocumentProcessingDebugPayload | null;
}

export interface DocumentProcessingDebugPayload {
  normalizedFileCategory: string | null;
  extractorSelected: string | null;
  extractorStatus: string | null;
  lastCompletedStage: string | null;
  qualityScore: number | null;
  qualityReason: string | null;
  extractedCharCount: number | null;
  extractionWarnings: string | null;
  structuralNoiseFiltered: boolean | null;
  structuralNoiseRatio: number | null;
  pdfTextStatus: string | null;
  inspectionMethod: string | null;
  inspectionWarning: string | null;
  ocrPdfStatus: string | null;
  ocrPdfEngine: string | null;
  ocrPdfConfidence: number | null;
  ocrPdfWarning: string | null;
  ocrImageStatus: string | null;
  ocrImageEngine: string | null;
  ocrImageWarning: string | null;
}

/**
 * Fetches extracted text and analysis metadata for a document resource.
 * Only works for document-type resources (not links/videos).
 */
export function useResourceExtractedText(documentId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['resource-extracted-text', documentId],
    enabled: enabled && !!documentId,
    queryFn: async (): Promise<ExtractedTextResult | null> => {
      if (!documentId) return null;

      const { data, error } = await supabase
        .from('document_analysis')
        .select('extracted_text, ocr_used, metadata_json')
        .eq('document_id', documentId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const meta = (data.metadata_json as Record<string, any>) || {};
      const text = data.extracted_text || null;
      const toNumber = (value: unknown): number | null => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };

      const debug: DocumentProcessingDebugPayload = {
        normalizedFileCategory: meta.file_type_category || null,
        extractorSelected: meta.extractor_selected || null,
        extractorStatus: meta.extractor_status || null,
        lastCompletedStage: meta.last_completed_stage || null,
        qualityScore: toNumber(meta.quality_score),
        qualityReason: meta.quality_reason || null,
        extractedCharCount: toNumber(meta.extracted_char_count),
        extractionWarnings: meta.extraction_warnings || null,
        structuralNoiseFiltered: typeof meta.structural_noise_filtered === 'boolean' ? meta.structural_noise_filtered : null,
        structuralNoiseRatio: toNumber(meta.structural_noise_ratio),
        pdfTextStatus: meta.pdf_text_status || null,
        inspectionMethod: meta.inspection_method || null,
        inspectionWarning: meta.inspection_warning || null,
        ocrPdfStatus: meta.ocr_pdf_status || null,
        ocrPdfEngine: meta.ocr_pdf_engine || null,
        ocrPdfConfidence: toNumber(meta.ocr_pdf_confidence),
        ocrPdfWarning: meta.ocr_pdf_warning || null,
        ocrImageStatus: meta.ocr_image_status || null,
        ocrImageEngine: meta.ocr_image_engine || null,
        ocrImageWarning: meta.ocr_image_warning || null,
      };

      return {
        extractedText: text,
        ocrUsed: !!data.ocr_used,
        extractorSelected: meta.extractor_selected || null,
        extractorStatus: meta.extractor_status || null,
        qualityReason: meta.quality_reason || null,
        lastCompletedStage: meta.last_completed_stage || null,
        textLength: text ? text.length : 0,
        debug,
      };
    },
    staleTime: 30_000,
  });
}
