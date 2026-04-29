// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getModelForTask } from "../_shared/ai/task-model-config.ts";
import { requireUser } from "../_shared/auth/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getResponseLanguageInstruction(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (code.startsWith("sr")) {
    return "Write the description in Serbian using Latin script, even if the current description, documents, chats, or context are in another language.";
  }
  return "Write the description in English, even if the current description, documents, chats, or context are in another language.";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireUser(req, corsHeaders);
  if ("response" in auth) return auth.response;

  try {
    const { projectName, currentDescription, documents, chats, responseLanguage } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build context sections
    let contextParts: string[] = [];

    if (projectName) {
      contextParts.push(`Project name: "${projectName}"`);
    }

    if (currentDescription) {
      contextParts.push(`Current description: "${currentDescription}"`);
    }

    if (documents && documents.length > 0) {
      const docList = documents
        .slice(0, 15)
        .map((d: any, i: number) => {
          let entry = `${i + 1}. ${d.fileName}`;
          if (d.summary) entry += ` — ${d.summary}`;
          return entry;
        })
        .join("\n");
      contextParts.push(`Project documents:\n${docList}`);
    }

    if (chats && chats.length > 0) {
      const chatList = chats
        .slice(0, 10)
        .map((c: any, i: number) => {
          let entry = `${i + 1}. ${c.name}`;
          if (c.preview) entry += ` — ${c.preview}`;
          return entry;
        })
        .join("\n");
      contextParts.push(`Project chats:\n${chatList}`);
    }

    const context = contextParts.join("\n\n");

    const systemPrompt = `You are a concise project description writer. Given project context, write an improved project description.

Rules:
- Output ONLY the description text, nothing else
- ${getResponseLanguageInstruction(responseLanguage)}
- 1 to 3 sentences maximum
- Plain text, no markdown, no bullet points, no quotation marks
- Professional and clear
- Reflect the actual project content based on documents and chats
- If the current description has useful intent, preserve it
- Do not start with "This project is about" unless it reads naturally
- Do not be generic; be specific to the project content`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getModelForTask("project_description"),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Improve this project description based on the following context:\n\n${context}` },
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit reached. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI service temporarily unavailable");
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(
      JSON.stringify({ description }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("improve-description error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
