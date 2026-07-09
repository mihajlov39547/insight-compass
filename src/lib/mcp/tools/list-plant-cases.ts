import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "list_plant_cases",
  title: "List plant cases",
  description:
    "List the signed-in user's Plant Advisor cases with title, status, goal, and confirmed identification if any. Ordered by most recently updated.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe("Maximum number of cases to return (default 20, max 50)."),
    status: z
      .enum([
        "draft",
        "ready_for_identification",
        "identified",
        "diagnosed",
        "treated",
        "archived",
      ])
      .optional()
      .describe("Filter by plant case status."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    let q = supabase
      .from("plant_cases")
      .select(
        "id, title, status, user_goal, location_text, crop_context, confirmed_scientific_name, confirmed_common_name, identified_scientific_name, identified_common_name, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const cases = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(cases) }],
      structuredContent: { cases, count: cases.length },
    };
  },
});
