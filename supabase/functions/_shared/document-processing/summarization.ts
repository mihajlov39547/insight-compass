// @ts-nocheck
import { getModelForTask } from "../ai/task-model-config.ts";

export interface SummaryGenerationResult {
  summary: string | null;
  model: string;
  warning?: string;
}

export async function generateDocumentSummary(
  fileName: string,
  effectiveText: string,
  language: string | null,
  script: string | null,
  lovableApiKey?: string | null,
  quality: "fast" | "rich" = "fast"
): Promise<SummaryGenerationResult> {
  const model = getModelForTask(quality === "rich" ? "summarization_rich" : "summarization_fast");

  if (!lovableApiKey) {
    return {
      summary: null,
      model,
      warning: "LOVABLE_API_KEY is missing",
    };
  }

  if (!effectiveText || effectiveText.trim().length <= 50) {
    return {
      summary: null,
      model,
      warning: "Text too short for summary generation",
    };
  }

  try {
    const textForSummary = effectiveText.slice(0, 8000);
    const langHint =
      language === "sr"
        ? `The document is in Serbian (${script || "unknown"} script). Produce the summary in Serbian.`
        : language && language !== "en"
          ? `The document is in ${language}. Produce the summary in that language.`
          : "";

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
              `You are a document summarizer. Produce a concise summary of 2-5 sentences based on the actual content of the document. ` +
              `Be factual, neutral, and informative. No markdown. Focus on the main topics, arguments, or information in the document body. ` +
              `Ignore any structural metadata, XML fragments, or file container information. ${langHint}`,
          },
          {
            role: "user",
            content: `Summarize this document titled "${fileName}":\n\n${textForSummary}`,
          },
        ],
      }),
    });

    if (!aiResp.ok) {
      return {
        summary: null,
        model,
        warning: `Summary API request failed (${aiResp.status})`,
      };
    }

    const aiData = await aiResp.json();
    const summary = (aiData.choices?.[0]?.message?.content || "").trim();

    if (!summary) {
      return {
        summary: null,
        model,
        warning: "Summary API returned empty content",
      };
    }

    return {
      summary,
      model,
    };
  } catch (e) {
    return {
      summary: null,
      model,
      warning: e instanceof Error ? e.message : "Summary generation exception",
    };
  }
}
