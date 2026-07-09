import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description:
    "Return the signed-in user's id, email, display name, and plan for the connected Researcher account.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
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
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, username, plan")
      .eq("id", ctx.getUserId())
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const profile = {
      userId: ctx.getUserId(),
      email: ctx.getUserEmail() ?? null,
      displayName: data?.display_name ?? data?.username ?? null,
      plan: data?.plan ?? null,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(profile) }],
      structuredContent: profile,
    };
  },
});
