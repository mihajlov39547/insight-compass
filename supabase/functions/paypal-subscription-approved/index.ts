import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/auth/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLAN_MAP: Record<string, string> = {
  // Sandbox
  "P-3YC17439JF027973DNH4PDMA": "basic_monthly",
  "P-64W44396F73265731NH4O5EI": "premium_monthly",
  // Live
  "P-94V224809Y744903GNH3YJ5I": "basic_monthly",
  "P-914500751X525453BNH3YLOA": "premium_monthly",
};

function getPayPalEnv(): "sandbox" | "live" {
  const raw = (Deno.env.get("PAYPAL_ENV") || "sandbox").trim().toLowerCase();
  return raw === "live" || raw === "production" ? "live" : "sandbox";
}

/** Fetch the subscription from PayPal so the plan is only granted for a real, approved subscription. */
async function fetchPayPalSubscription(subscriptionId: string): Promise<any | null> {
  const env = getPayPalEnv();
  const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const clientId = (env === "sandbox" ? Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID") : Deno.env.get("PAYPAL_CLIENT_ID"))?.trim() || "";
  const secret = (env === "sandbox" ? Deno.env.get("PAYPAL_SANDBOX_SECRET_KEY") : Deno.env.get("PAYPAL_SECRET_KEY"))?.trim() || "";
  if (!clientId || !secret) return null;
  const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const tokenData = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenData?.access_token) return null;
  const subRes = await fetch(`${baseUrl}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!subRes.ok) return null;
  return await subRes.json().catch(() => null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireUser(req, corsHeaders);
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;

  try {
    const { subscriptionID, paypalPlanId, planKey } = await req.json();

    if (!subscriptionID || !paypalPlanId || !planKey) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Server-side plan validation — never trust frontend planKey
    const expectedPlanKey = PLAN_MAP[paypalPlanId];
    if (!expectedPlanKey || expectedPlanKey !== planKey) {
      return new Response(
        JSON.stringify({ error: "Invalid plan mapping" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof subscriptionID !== "string" || !/^I-[A-Z0-9]{6,32}$/.test(subscriptionID)) {
      return new Response(
        JSON.stringify({ error: "Invalid subscription" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify with PayPal that the subscription exists, is for this plan, and is approved/active.
    const ppSub = await fetchPayPalSubscription(subscriptionID);
    const ppStatus = String(ppSub?.status || "").toUpperCase();
    if (!ppSub || ppSub.plan_id !== paypalPlanId || !["ACTIVE", "APPROVED"].includes(ppStatus)) {
      return new Response(
        JSON.stringify({ error: "Subscription could not be verified" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // A PayPal subscription can only ever be linked to one account.
    const { data: existingLink } = await supabaseAdmin
      .from("user_subscriptions")
      .select("user_id")
      .eq("paypal_subscription_id", subscriptionID)
      .maybeSingle();
    if (existingLink && existingLink.user_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Subscription already linked" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upsert user subscription
    const { error: subError } = await supabaseAdmin
      .from("user_subscriptions")
      .upsert(
        {
          user_id: userId,
          plan_key: expectedPlanKey,
          paypal_subscription_id: subscriptionID,
          paypal_plan_id: paypalPlanId,
          status: ppStatus === "ACTIVE" ? "active" : "pending",
          current_period_start: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (subError) throw subError;

    // Update profile plan to the mapped plan key (maps to Plan type)
    const profilePlan = expectedPlanKey === "basic_monthly" ? "basic" : "premium";
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ plan: profilePlan })
      .eq("user_id", userId);

    if (profileError) {
      console.error("Failed to update profile plan:", profileError);
    }

    // Send subscription confirmation email
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("username, email")
        .eq("user_id", userId)
        .maybeSingle();

      // Get user email from auth
      const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
      const recipientEmail = authUser?.email;

      if (recipientEmail) {
        const friendlyPlan = expectedPlanKey === "basic_monthly" ? "Basic" : "Premium";
        const price = expectedPlanKey === "basic_monthly" ? "$7.99/month" : "$14.99/month";
        const periodStart = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

        await supabaseAdmin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "subscription-confirmation",
            recipientEmail,
            idempotencyKey: `sub-confirm-${subscriptionID}`,
            templateData: {
              planName: friendlyPlan,
              planKey: expectedPlanKey,
              subscriptionId: subscriptionID,
              billingPeriod: "Monthly",
              periodStart,
              price,
              email: recipientEmail,
              name: profile?.username || undefined,
            },
          },
        });
        console.log("Subscription confirmation email sent");
      }
    } catch (emailErr) {
      // Non-blocking — subscription still succeeded
      console.error("Failed to send confirmation email:", emailErr);
    }

    return new Response(
      JSON.stringify({ success: true, planKey: expectedPlanKey }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Subscription approval error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
