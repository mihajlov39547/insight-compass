import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "get_plant_case",
  title: "Get plant case",
  description:
    "Return a single Plant Advisor case for the signed-in user, including its confirmed identification and confirmed disease diagnosis if present.",
  inputSchema: {
    caseId: z.string().uuid().describe("Plant case id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ caseId }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: pc, error } = await supabase
      .from("plant_cases")
      .select("*")
      .eq("id", caseId)
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!pc) {
      return { content: [{ type: "text", text: "Plant case not found" }], isError: true };
    }
    const { data: diag } = await supabase
      .from("plant_diagnoses")
      .select("id, rank, score, problem_type, name, description, affected_organs, is_confirmed, confirmed_at, language")
      .eq("case_id", caseId)
      .eq("is_confirmed", true)
      .maybeSingle();
    const payload = { case: pc, confirmedDiagnosis: diag ?? null };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
