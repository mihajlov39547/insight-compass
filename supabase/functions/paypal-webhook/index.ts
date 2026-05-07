import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

function planKeyToProfilePlan(planKey: string): string {
  if (planKey === "basic_monthly") return "basic";
  if (planKey === "premium_monthly") return "premium";
  return "free";
}

/**
 * Resolve PayPal environment strictly from PAYPAL_ENV secret.
 * Defaults to "sandbox" — live requires an explicit "live" value.
 */
function getPayPalEnv(): "sandbox" | "live" {
  const raw = (Deno.env.get("PAYPAL_ENV") || "sandbox").trim().toLowerCase();
  if (raw === "live" || raw === "production") return "live";
  return "sandbox";
}

async function verifyPayPalWebhook(
  req: Request,
  body: string
): Promise<boolean> {
  const paypalEnv = getPayPalEnv();
  const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
  const clientId = paypalEnv === "sandbox"
    ? (Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID") || "")
    : (Deno.env.get("PAYPAL_CLIENT_ID") || "");
  const clientSecret = paypalEnv === "sandbox"
    ? (Deno.env.get("PAYPAL_SANDBOX_SECRET_KEY") || "")
    : (Deno.env.get("PAYPAL_SECRET_KEY") || "");

  const hasSignatureHeaders =
    req.headers.get("paypal-transmission-id") &&
    req.headers.get("paypal-transmission-sig") &&
    req.headers.get("paypal-auth-algo");

  // --- LIVE: never skip verification ---
  if (paypalEnv === "live") {
    if (!webhookId || !clientId || !clientSecret) {
      console.error("LIVE mode: PayPal verification secrets missing — rejecting webhook");
      return false;
    }
    if (!hasSignatureHeaders) {
      console.error("LIVE mode: Missing PayPal signature headers — rejecting webhook");
      return false;
    }
    // Fall through to full verification below
  }

  // --- SANDBOX: skip only for simulator events that lack signature headers ---
  if (paypalEnv === "sandbox" && !hasSignatureHeaders) {
    console.warn("Sandbox: no signature headers present, skipping verification (simulator event)");
    return true;
  }

  // --- Full verification (both sandbox and live when headers are present) ---
  if (!webhookId || !clientId || !clientSecret) {
    if (paypalEnv === "sandbox") {
      console.warn("Sandbox: verification secrets missing, allowing event");
      return true;
    }
    // live already handled above, but belt-and-suspenders
    return false;
  }

  const baseUrl =
    paypalEnv === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  console.info(`[PayPal webhook] Verifying against ${baseUrl} (env=${paypalEnv})`);

  try {
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
      console.error("Failed to obtain PayPal access token for verification");
      return false;
    }

    const verifyRes = await fetch(
      `${baseUrl}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: req.headers.get("paypal-auth-algo"),
          cert_url: req.headers.get("paypal-cert-url"),
          transmission_id: req.headers.get("paypal-transmission-id"),
          transmission_sig: req.headers.get("paypal-transmission-sig"),
          transmission_time: req.headers.get("paypal-transmission-time"),
          webhook_id: webhookId,
          webhook_event: JSON.parse(body),
        }),
      }
    );
    const verifyData = await verifyRes.json();
    const verified = verifyData.verification_status === "SUCCESS";
    if (!verified) {
      console.error("PayPal signature verification returned:", verifyData.verification_status);
    }
    return verified;
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const body = await req.text();

  const verified = await verifyPayPalWebhook(req, body);
  if (!verified) {
    console.error("PayPal webhook verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const eventId = event.id;
  const eventType = event.event_type;
  const resource = event.resource || {};
  const subscriptionId = resource.id || resource.billing_agreement_id;

  // Idempotency check
  const { error: insertError } = await supabaseAdmin
    .from("paypal_webhook_events")
    .insert({
      paypal_event_id: eventId,
      event_type: eventType,
      paypal_resource_id: resource.id,
      paypal_subscription_id: subscriptionId,
      raw_payload: event,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Failed to store webhook event:", insertError);
  }

  // Find subscription
  const { data: sub } = await supabaseAdmin
    .from("user_subscriptions")
    .select("*")
    .eq("paypal_subscription_id", subscriptionId)
    .maybeSingle();

  if (!sub && eventType !== "PAYMENT.SALE.COMPLETED") {
    console.warn(`No subscription found for PayPal sub ${subscriptionId}`);
    await supabaseAdmin
      .from("paypal_webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("paypal_event_id", eventId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    switch (eventType) {
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        if (sub) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "active" })
            .eq("id", sub.id);
          const profilePlan = planKeyToProfilePlan(sub.plan_key);
          await supabaseAdmin
            .from("profiles")
            .update({ plan: profilePlan })
            .eq("user_id", sub.user_id);
        }
        break;
      }
      case "PAYMENT.SALE.COMPLETED": {
        if (sub) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "active" })
            .eq("id", sub.id);
        }
        break;
      }
      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
        if (sub) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "payment_failed" })
            .eq("id", sub.id);
        }
        break;
      }
      case "BILLING.SUBSCRIPTION.CANCELLED": {
        if (sub) {
          // Check if the billing period has ended
          const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
          const periodExpired = !periodEnd || periodEnd <= new Date();

          if (periodExpired) {
            // Period already ended — downgrade immediately
            await supabaseAdmin
              .from("user_subscriptions")
              .update({ status: "cancelled", cancel_at_period_end: false })
              .eq("id", sub.id);
            await supabaseAdmin
              .from("profiles")
              .update({ plan: "free" })
              .eq("user_id", sub.user_id);
          } else {
            // Period still active — mark as cancelling but keep access
            await supabaseAdmin
              .from("user_subscriptions")
              .update({ status: "cancelled", cancel_at_period_end: true })
              .eq("id", sub.id);
            // Do NOT downgrade profile.plan yet
          }
        }
        break;
      }
      case "BILLING.SUBSCRIPTION.SUSPENDED": {
        if (sub) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "suspended" })
            .eq("id", sub.id);
          await supabaseAdmin
            .from("profiles")
            .update({ plan: "free" })
            .eq("user_id", sub.user_id);
        }
        break;
      }
      case "BILLING.SUBSCRIPTION.EXPIRED": {
        if (sub) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "expired" })
            .eq("id", sub.id);
          await supabaseAdmin
            .from("profiles")
            .update({ plan: "free" })
            .eq("user_id", sub.user_id);
        }
        break;
      }
      case "PAYMENT.SALE.REFUNDED": {
        if (sub) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "cancelled" })
            .eq("id", sub.id);
          await supabaseAdmin
            .from("profiles")
            .update({ plan: "free" })
            .eq("user_id", sub.user_id);
        }
        break;
      }
      default:
        console.log(`Unhandled PayPal event type: ${eventType}`);
    }
  } catch (err) {
    console.error(`Error processing ${eventType}:`, err);
  }

  await supabaseAdmin
    .from("paypal_webhook_events")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("paypal_event_id", eventId);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
