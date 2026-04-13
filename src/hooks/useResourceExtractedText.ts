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

      return {
        extractedText: text,
        ocrUsed: !!data.ocr_used,
        extractorSelected: meta.extractor_selected || null,
        extractorStatus: meta.extractor_status || null,
        qualityReason: meta.quality_reason || null,
        lastCompletedStage: meta.last_completed_stage || null,
        textLength: text ? text.length : 0,
      };
    },
    staleTime: 30_000,
  });
}
