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

    // Get PayPal credentials based on env. Keep sandbox explicit and normalize safely.
    const rawClientId = paypalEnv === "sandbox"
      ? (Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID") || "")
      : (Deno.env.get("PAYPAL_CLIENT_ID") || "");
    const rawClientSecret = paypalEnv === "sandbox"
      ? (Deno.env.get("PAYPAL_SANDBOX_SECRET_KEY") || "")
      : (Deno.env.get("PAYPAL_SECRET_KEY") || "");
    const clientId = rawClientId.trim();
    const clientSecret = rawClientSecret.trim();
    const oauthUrl = `${baseUrl}/v1/oauth2/token`;

    const safeOauthDiagnostics = {
      paypalEnv,
      baseUrl,
      oauthUrl,
      hasSandboxClientId: Boolean(Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID")),
      sandboxClientIdPrefix: Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID")?.slice(0, 10) || null,
      sandboxClientIdLength: Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID")?.length || 0,
      hasFallbackClientId: Boolean(Deno.env.get("PAYPAL_CLIENT_ID")),
      fallbackClientIdPrefix: Deno.env.get("PAYPAL_CLIENT_ID")?.slice(0, 10) || null,
      fallbackClientIdLength: Deno.env.get("PAYPAL_CLIENT_ID")?.length || 0,
      hasSandboxSecret: Boolean(Deno.env.get("PAYPAL_SANDBOX_SECRET_KEY")),
      sandboxSecretLength: Deno.env.get("PAYPAL_SANDBOX_SECRET_KEY")?.length || 0,
      hasLiveSecret: Boolean(Deno.env.get("PAYPAL_SECRET_KEY")),
      liveSecretLength: Deno.env.get("PAYPAL_SECRET_KEY")?.length || 0,
    };
    console.info("[cancel] paypal_oauth_config", safeOauthDiagnostics);

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          stage: "paypal_config",
          message: "Missing PayPal sandbox client ID or secret",
          hasClientId: Boolean(clientId),
          hasClientSecret: Boolean(clientSecret),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get PayPal OAuth token
    const tokenRes = await fetch(oauthUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: "grant_type=client_credentials",
    });

    const tokenText = await tokenRes.text();
    let tokenData: any = null;
    try {
      tokenData = tokenText ? JSON.parse(tokenText) : null;
    } catch {
      tokenData = { raw: tokenText };
    }

    console.info("[cancel] PayPal OAuth response", {
      status: tokenRes.status,
      ok: tokenRes.ok,
      hasAccessToken: Boolean(tokenData?.access_token),
      paypalError: tokenRes.ok ? null : tokenData,
    });

    if (!tokenRes.ok || !tokenData?.access_token) {
      return new Response(
        JSON.stringify({
          success: false,
          stage: "paypal_oauth",
          paypalStatus: tokenRes.status,
          paypalError: tokenData,
          sandboxClientIdPrefix: safeOauthDiagnostics.sandboxClientIdPrefix,
          sandboxClientIdLength: safeOauthDiagnostics.sandboxClientIdLength,
          sandboxSecretLength: safeOauthDiagnostics.sandboxSecretLength,
        }),
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

    // Fetch subscription details from PayPal to get billing period end
    let currentPeriodEnd: string | null = null;
    try {
      const detailRes = await fetch(
        `${baseUrl}/v1/billing/subscriptions/${sub.paypal_subscription_id}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        }
      );
      if (detailRes.ok) {
        const detail = await detailRes.json();
        // PayPal returns billing_info.next_billing_time for active subs,
        // or we use the current_period_end from billing_info
        currentPeriodEnd =
          detail.billing_info?.next_billing_time ||
          detail.billing_info?.last_payment?.time ||
          null;
        console.info("[cancel] PayPal next_billing_time:", detail.billing_info?.next_billing_time);
        console.info("[cancel] PayPal last_payment time:", detail.billing_info?.last_payment?.time);

        // If we got last_payment time, calculate period end as +1 month
        if (!detail.billing_info?.next_billing_time && detail.billing_info?.last_payment?.time) {
          const lastPayment = new Date(detail.billing_info.last_payment.time);
          lastPayment.setMonth(lastPayment.getMonth() + 1);
          currentPeriodEnd = lastPayment.toISOString();
        }
      }
    } catch (e) {
      console.warn("[cancel] Could not fetch subscription details:", e);
    }

    console.info("[cancel] Computed currentPeriodEnd:", currentPeriodEnd);

    // Update subscription in DB — keep status active, mark cancel_at_period_end
    const { error: updateSubError } = await supabaseAdmin
      .from("user_subscriptions")
      .update({
        cancel_at_period_end: true,
        current_period_end: currentPeriodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    console.info("[cancel] DB subscription update error:", updateSubError || "none");

    // Do NOT downgrade profile.plan — user keeps access until period end

    // Send cancellation confirmation email
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("user_id", userId)
        .maybeSingle();

      const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
      const recipientEmail = authUser?.email;

      if (recipientEmail) {
        const friendlyPlan = sub.plan_key === "basic_monthly" ? "Basic" : "Premium";
        const accessUntil = currentPeriodEnd
          ? new Date(currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
          : "the end of your current billing period";

        await supabaseAdmin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "subscription-cancelled",
            recipientEmail,
            idempotencyKey: `sub-cancel-${sub.paypal_subscription_id}`,
            templateData: {
              planName: friendlyPlan,
              subscriptionId: sub.paypal_subscription_id,
              accessUntil,
              email: recipientEmail,
              name: profile?.username || undefined,
            },
          },
        });
        console.log("[cancel] Cancellation email sent to", recipientEmail);
      }
    } catch (emailErr) {
      console.error("[cancel] Failed to send cancellation email:", emailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: "cancel_at_period_end",
        paypalSubscriptionId: sub.paypal_subscription_id,
        currentPeriodEnd,
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
