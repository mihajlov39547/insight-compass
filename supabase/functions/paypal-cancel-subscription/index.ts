import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/auth/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getPayPalEnv(): "sandbox" | "live" {
  const raw = (Deno.env.get("PAYPAL_ENV") || "sandbox").trim().toLowerCase();
  if (raw === "live" || raw === "production") return "live";
  return "sandbox";
}

function getPayPalBaseUrl(env: "sandbox" | "live"): string {
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Require authenticated user
  const auth = await requireUser(req, corsHeaders);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;

  try {
    const { reason } = await req.json().catch(() => ({ reason: "User requested cancellation" }));

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Look up user's active subscription
    const { data: sub, error: subError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["active", "pending"])
      .maybeSingle();

    if (subError) {
      console.error("[cancel] DB lookup error:", subError);
      throw subError;
    }

    if (!sub) {
      return new Response(
        JSON.stringify({ error: "No active paid subscription found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!sub.paypal_subscription_id) {
      return new Response(
        JSON.stringify({ error: "No PayPal subscription ID on record" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reject free/enterprise
    if (!sub.plan_key || sub.plan_key === "free" || sub.plan_key === "enterprise") {
      return new Response(
        JSON.stringify({ error: "Cannot cancel a non-paid subscription" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const paypalEnv = getPayPalEnv();
    const baseUrl = getPayPalBaseUrl(paypalEnv);

    console.info("[cancel] userId:", userId);
    console.info("[cancel] PAYPAL_ENV:", paypalEnv);
    console.info("[cancel] PayPal API base:", baseUrl);
    console.info("[cancel] local subscription id:", sub.id);
    console.info("[cancel] paypal_subscription_id:", sub.paypal_subscription_id);

    // Get PayPal credentials based on env
    const clientId = paypalEnv === "sandbox"
      ? (Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID") || Deno.env.get("PAYPAL_CLIENT_ID") || "")
      : (Deno.env.get("PAYPAL_CLIENT_ID") || "");
    const clientSecret = paypalEnv === "sandbox"
      ? (Deno.env.get("PAYPAL_SANDBOX_SECRET_KEY") || Deno.env.get("PAYPAL_SECRET_KEY_1") || "")
      : (Deno.env.get("PAYPAL_SECRET_KEY_1") || "");

    // Get PayPal OAuth token
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("[cancel] Failed to get PayPal token:", tokenData);
      return new Response(
        JSON.stringify({ error: "Failed to authenticate with PayPal" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cancel subscription on PayPal
    const cancelRes = await fetch(
      `${baseUrl}/v1/billing/subscriptions/${sub.paypal_subscription_id}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: reason || "User requested cancellation from Rsrcher billing page",
        }),
      }
    );

    console.info("[cancel] PayPal cancel response status:", cancelRes.status);

    if (cancelRes.status !== 204) {
      const errBody = await cancelRes.text();
      console.error("[cancel] PayPal cancel error:", errBody);
      return new Response(
        JSON.stringify({ error: "PayPal cancellation failed", details: errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update subscription in DB
    const { error: updateSubError } = await supabaseAdmin
      .from("user_subscriptions")
      .update({
        status: "cancelled",
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    console.info("[cancel] DB subscription update error:", updateSubError || "none");

    // Set profile plan to free
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ plan: "free" })
      .eq("user_id", userId);

    console.info("[cancel] DB profile update error:", profileError || "none");

    return new Response(
      JSON.stringify({
        success: true,
        status: "cancelled",
        paypalSubscriptionId: sub.paypal_subscription_id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[cancel] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
