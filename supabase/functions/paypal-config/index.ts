/**
 * Returns the publishable PayPal client ID and environment.
 * These values are safe to expose to the frontend — they are not secret.
 * This endpoint lets us manage all PayPal config from Supabase secrets
 * instead of duplicating values in frontend env files.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const clientId = Deno.env.get("PAYPAL_CLIENT_ID") || "";
  const env = (Deno.env.get("PAYPAL_ENV") || "sandbox").trim().toLowerCase();

  return new Response(
    JSON.stringify({ clientId, env }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
