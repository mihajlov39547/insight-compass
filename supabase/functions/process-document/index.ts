import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple language detection via character frequency heuristics
function detectLanguage(text: string): { language: string; confidence: number } {
  if (!text || text.trim().length < 20) return { language: "unknown", confidence: 0 };

  const sample = text.slice(0, 5000).toLowerCase();

  // Check for Cyrillic (Serbian, Russian, etc.)
  const cyrillicCount = (sample.match(/[\u0400-\u04FF]/g) || []).length;
  if (cyrillicCount > sample.length * 0.2) return { language: "sr", confidence: 0.8 };

  // Check for CJK
  const cjkCount = (sample.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  if (cjkCount > sample.length * 0.1) return { language: "zh", confidence: 0.7 };

  // Check for Arabic
  const arabicCount = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicCount > sample.length * 0.2) return { language: "ar", confidence: 0.8 };

  // Latin-based: check common word frequencies
  const words = sample.split(/\s+/);
  const enWords = new Set(["the", "and", "is", "in", "to", "of", "a", "for", "that", "it", "with", "on", "as", "are", "was", "be", "this", "have", "from", "or", "an", "but", "not", "by", "at", "they", "which", "do", "their", "if", "will", "each", "about", "how", "up", "out", "them", "then", "she", "many", "some", "so", "these", "would", "other"]);
  const deWords = new Set(["der", "die", "und", "ist", "von", "den", "das", "mit", "auf", "für", "ein", "eine", "des", "dem", "nicht", "sich", "auch", "als", "noch", "nach", "bei", "aus", "wie", "aber", "wenn"]);
  const frWords = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "est", "en", "que", "qui", "dans", "pour", "pas", "sur", "ce", "par", "sont", "avec", "au", "aux", "mais", "ou", "ne"]);
  const esWords = new Set(["el", "la", "los", "las", "de", "en", "un", "una", "que", "es", "por", "con", "del", "para", "al", "se", "no", "su", "más", "como", "pero", "sus", "le", "ya", "este"]);

  let enScore = 0, deScore = 0, frScore = 0, esScore = 0;
  for (const w of words) {
    if (enWords.has(w)) enScore++;
    if (deWords.has(w)) deScore++;
    if (frWords.has(w)) frScore++;
    if (esWords.has(w)) esScore++;
  }

  const maxScore = Math.max(enScore, deScore, frScore, esScore);
  if (maxScore < 3) return { language: "en", confidence: 0.3 };

  if (maxScore === enScore) return { language: "en", confidence: Math.min(enScore / words.length * 10, 0.95) };
  if (maxScore === deScore) return { language: "de", confidence: Math.min(deScore / words.length * 10, 0.9) };
  if (maxScore === frScore) return { language: "fr", confidence: Math.min(frScore / words.length * 10, 0.9) };
  if (maxScore === esScore) return { language: "es", confidence: Math.min(esScore / words.length * 10, 0.9) };

  return { language: "en", confidence: 0.3 };
}

function countStats(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return {
    word_count: words.length,
    char_count: text.length,
    line_count: text.split("\n").length,
  };
}

function normalizeForSearch(text: string, fileName: string, summary?: string): string {
  const parts = [fileName, summary || "", text].filter(Boolean);
  return parts.join(" ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Extract text from file bytes based on mime type
function extractText(bytes: Uint8Array, mimeType: string, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // Plain text formats
  if (
    mimeType.startsWith("text/") ||
    ["txt", "md", "csv", "rtf"].includes(ext)
  ) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  // PDF: extract text between stream markers (basic approach)
  if (ext === "pdf" || mimeType === "application/pdf") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Extract text from PDF text objects (Tj and TJ operators)
    const textParts: string[] = [];
    const tjMatches = raw.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const m of tjMatches) {
      textParts.push(m[1]);
    }
    // Also try BT...ET blocks
    const btMatches = raw.matchAll(/BT\s*([\s\S]*?)\s*ET/g);
    for (const m of btMatches) {
      const innerTj = m[1].matchAll(/\(([^)]*)\)\s*Tj/g);
      for (const im of innerTj) {
        textParts.push(im[1]);
      }
    }
    if (textParts.length > 0) {
      return textParts.join(" ").replace(/\\n/g, "\n").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
    }
    // Fallback: extract readable ASCII sequences
    const readable = raw.replace(/[^ -~\n\r\t]/g, " ").replace(/\s{3,}/g, " ");
    // Filter out binary noise - only keep segments with real words
    const segments = readable.split(/\s{2,}/).filter(s => s.length > 10 && /[a-zA-Z]{3,}/.test(s));
    return segments.join("\n").slice(0, 100000);
  }

  // DOCX: extract from XML
  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Find all <w:t> tags
    const matches = raw.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    const parts: string[] = [];
    for (const m of matches) {
      parts.push(m[1]);
    }
    return parts.join(" ");
  }

  // XLSX/XLS: extract readable text
  if (["xlsx", "xls"].includes(ext)) {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Try shared strings from XLSX
    const matches = raw.matchAll(/<t[^>]*>([^<]*)<\/t>/g);
    const parts: string[] = [];
    for (const m of matches) {
      parts.push(m[1]);
    }
    if (parts.length > 0) return parts.join(" ");
    return raw.replace(/[^ -~\n\r\t]/g, " ").replace(/\s+/g, " ").slice(0, 50000);
  }

  // Fallback
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 50000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create service-role client for backend operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch document record
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status: extracting metadata
    await supabase.from("documents").update({ processing_status: "extracting_metadata" }).eq("id", documentId);

    // Download file from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("insight-navigator")
      .download(doc.storage_path);

    if (dlErr || !fileData) {
      await supabase.from("documents").update({
        processing_status: "failed",
        processing_error: `Download failed: ${dlErr?.message || "unknown"}`,
      }).eq("id", documentId);
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());

    // Update status: extracting content
    await supabase.from("documents").update({ processing_status: "extracting_content" }).eq("id", documentId);

    const extractedText = extractText(bytes, doc.mime_type, doc.file_name);
    const stats = countStats(extractedText);

    // Update with metadata
    await supabase.from("documents").update({
      processing_status: "detecting_language",
      word_count: stats.word_count,
      char_count: stats.char_count,
    }).eq("id", documentId);

    // Language detection
    const langResult = detectLanguage(extractedText);

    await supabase.from("documents").update({
      processing_status: "summarizing",
      detected_language: langResult.language,
    }).eq("id", documentId);

    // Generate summary using AI
    let summary = "";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY && extractedText.trim().length > 50) {
      try {
        const textForSummary = extractedText.slice(0, 8000);
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              {
                role: "system",
                content: "You are a document summarizer. Produce a concise summary of 2-5 sentences. Be factual, neutral, and informative. No markdown.",
              },
              {
                role: "user",
                content: `Summarize this document titled "${doc.file_name}":\n\n${textForSummary}`,
              },
            ],
          }),
        });

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          summary = aiData.choices?.[0]?.message?.content || "";
        }
      } catch (e) {
        console.warn("Summary generation failed:", e);
        // Non-blocking - continue without summary
      }
    }

    // Update status: indexing
    await supabase.from("documents").update({
      processing_status: "indexing",
      summary: summary || null,
    }).eq("id", documentId);

    // Create search index
    const searchText = normalizeForSearch(extractedText, doc.file_name, summary);
    const textPreview = extractedText.slice(0, 1000);

    // Upsert document_analysis record
    await supabase.from("document_analysis").upsert({
      document_id: documentId,
      user_id: doc.user_id,
      extracted_text: extractedText.slice(0, 500000), // cap at 500k chars
      normalized_search_text: searchText.slice(0, 500000),
      metadata_json: {
        original_size: doc.file_size,
        mime_type: doc.mime_type,
        word_count: stats.word_count,
        char_count: stats.char_count,
        line_count: stats.line_count,
        detected_language: langResult.language,
        language_confidence: langResult.confidence,
        file_category: categorizeFile(doc.file_type),
      },
      ocr_used: false,
      indexed_at: new Date().toISOString(),
    }, { onConflict: "document_id" });

    // Mark as completed
    await supabase.from("documents").update({
      processing_status: "completed",
      processing_error: null,
    }).eq("id", documentId);

    return new Response(JSON.stringify({
      status: "completed",
      documentId,
      word_count: stats.word_count,
      detected_language: langResult.language,
      summary_length: summary.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-document error:", e);

    // Try to mark as failed
    try {
      const { documentId } = await req.clone().json();
      if (documentId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceKey);
        await supabase.from("documents").update({
          processing_status: "failed",
          processing_error: e instanceof Error ? e.message : "Unknown error",
        }).eq("id", documentId);
      }
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function categorizeFile(fileType: string): string {
  switch (fileType) {
    case "pdf": return "pdf";
    case "doc": case "docx": return "word";
    case "xls": case "xlsx": case "csv": return "spreadsheet";
    case "txt": return "text";
    case "md": return "markdown";
    case "rtf": return "rich_text";
    default: return "other";
  }
}
