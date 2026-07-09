import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "list_projects",
  title: "List projects",
  description:
    "List projects the signed-in user owns or has been shared with, ordered by most recently updated.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe("Maximum number of projects to return (default 20, max 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
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
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, description, language, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const projects = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(projects) }],
      structuredContent: { projects, count: projects.length },
    };
  },
});
