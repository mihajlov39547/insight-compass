/**
 * Returns the publishable PayPal client ID, environment, and plan IDs.
 * Plan IDs differ between sandbox and live environments.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLANS_BY_ENV: Record<string, Record<string, { planId: string; planKey: string }>> = {
  sandbox: {
    basic:   { planId: "P-3YC17439JF027973DNH4PDMA", planKey: "basic_monthly" },
    premium: { planId: "P-64W44396F73265731NH4O5EI", planKey: "premium_monthly" },
  },
  live: {
    basic:   { planId: "P-94V224809Y744903GNH3YJ5I", planKey: "basic_monthly" },
    premium: { planId: "P-914500751X525453BNH3YLOA", planKey: "premium_monthly" },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const env = (Deno.env.get("PAYPAL_ENV") || "sandbox").trim().toLowerCase();
  // Use env-specific client ID: PAYPAL_SANDBOX_CLIENT_ID for sandbox, PAYPAL_CLIENT_ID for live
  const clientId = env === "sandbox"
    ? (Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID") || Deno.env.get("PAYPAL_CLIENT_ID") || "")
    : (Deno.env.get("PAYPAL_CLIENT_ID") || "");
  const plans = PLANS_BY_ENV[env] ?? PLANS_BY_ENV["sandbox"];

  return new Response(
    JSON.stringify({ clientId, env, plans }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
