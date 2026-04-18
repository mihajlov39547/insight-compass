// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { userMessage, assistantMessage } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages: [
            {
              role: "system",
              content:
                "Generate a short chat title (3-6 words) based on the user question and assistant answer. Return ONLY the title text. No quotes, no punctuation at the end, no generic words like 'Chat' or 'Conversation'. Examples: 'RAG Architecture Overview', 'Contract Risk Summary', 'API Integration Questions'.",
            },
            {
              role: "user",
              content: `User message: ${userMessage}\n\nAssistant response: ${assistantMessage.slice(0, 500)}`,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("Title generation error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "Title generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    let title = data.choices?.[0]?.message?.content?.trim() || "";

    // Clean up: remove quotes and trailing punctuation
    title = title.replace(/^["']|["']$/g, "").replace(/[.!?]+$/, "").trim();

    // Fallback if empty or too generic
    if (!title || title.toLowerCase() === "new chat" || title.toLowerCase() === "conversation") {
      title = "";
    }

    return new Response(
      JSON.stringify({ title }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-chat-title error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
