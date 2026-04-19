// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getModelForTask } from "../_shared/ai/task-model-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, previousUserMessage, previousAssistantMessage } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    let contextSection = "";
    if (previousUserMessage || previousAssistantMessage) {
      contextSection = "\n\nRecent conversation context:";
      if (previousUserMessage) contextSection += `\nPrevious user message: "${previousUserMessage}"`;
      if (previousAssistantMessage) contextSection += `\nPrevious assistant response: "${previousAssistantMessage.slice(0, 500)}"`;
    }

    const systemPrompt = `You are a prompt editor. Rewrite the user's draft message to be clearer, more coherent, and well-formed.

Rules:
- Output ONLY the improved prompt text, nothing else
- Fix typos, grammar, and clarity issues
- Preserve the original intent and meaning exactly
- Keep a natural, conversational tone
- Do not over-expand short prompts
- Do not add markdown, bullets, or formatting
- Do not answer the prompt
- Do not add unnecessary detail
- If the prompt is already clear and well-written, return it mostly unchanged${contextSection}`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getModelForTask("prompt_improvement"),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Improve this prompt:\n\n${prompt}` },
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
    const improved = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(
      JSON.stringify({ improved }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("improve-prompt error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
