import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Fetch PayPal publishable config from the backend (secrets-managed). */
async function fetchPayPalConfig(): Promise<{ clientId: string; env: string }> {
  const { data, error } = await supabase.functions.invoke('paypal-config');
  if (error) throw new Error(`Failed to fetch PayPal config: ${error.message}`);
  if (!data?.clientId) throw new Error('PAYPAL_CLIENT_ID is not configured in backend secrets.');
  return data as { clientId: string; env: string };
}

let sdkLoadPromise: Promise<void> | null = null;
let cachedConfig: { clientId: string; env: string } | null = null;

async function loadPayPalSDK(): Promise<{ clientId: string; env: string }> {
  if (!cachedConfig) {
    cachedConfig = await fetchPayPalConfig();
  }
  const config = cachedConfig;

  if ((window as any).paypal) return config;
  if (sdkLoadPromise) {
    await sdkLoadPromise;
    return config;
  }

  console.info(`[PayPal] Loading SDK — env=${config.env}, clientId=${config.clientId.slice(0, 12)}…`);
  const url = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&vault=true&intent=subscription`;

  sdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.setAttribute('data-sdk-integration-source', 'button-factory');
    script.onload = () => resolve();
    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error('Failed to load PayPal SDK'));
    };
    document.head.appendChild(script);
  });

  await sdkLoadPromise;
  return config;
}

interface PayPalSubscriptionButtonProps {
  planId: string;
  planKey: string;
  onApprove: (subscriptionID: string, paypalPlanId: string, planKey: string) => void;
  disabled?: boolean;
}

export function PayPalSubscriptionButton({
  planId,
  planKey,
  onApprove,
  disabled,
}: PayPalSubscriptionButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (disabled || renderedRef.current) return;

    let cancelled = false;

    loadPayPalSDK()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const paypal = (window as any).paypal;
        if (!paypal?.Buttons) {
          setError('PayPal SDK not available');
          setLoading(false);
          return;
        }

        paypal
          .Buttons({
            style: {
              shape: 'pill',
              color: 'blue',
              layout: 'vertical',
              label: 'subscribe',
            },
            createSubscription: (_data: any, actions: any) => {
              console.info('[PayPal] Creating subscription', {
                planId,
                planKey,
                brandName: 'Researcher by AKTIKA',
                shippingPreference: 'NO_SHIPPING',
                userAction: 'SUBSCRIBE_NOW',
              });
              return actions.subscription.create({
                plan_id: planId,
                application_context: {
                  brand_name: 'Researcher by AKTIKA',
                  shipping_preference: 'NO_SHIPPING',
                  user_action: 'SUBSCRIBE_NOW',
                },
              });
            },
            onApprove: (data: any) => {
              console.info('[PayPal] Subscription approved', {
                subscriptionID: data.subscriptionID,
                planId,
                planKey,
              });
              onApprove(data.subscriptionID, planId, planKey);
            },
            onCancel: (data: any) => {
              console.info('[PayPal] Subscription cancelled by user', data);
            },
            onError: (err: any) => {
              console.error('[PayPal] Subscription error', err);
              setError('PayPal checkout failed. Please try again.');
            },
          })
          .render(containerRef.current);

        renderedRef.current = true;
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [planId, planKey, onApprove, disabled]);

  if (disabled) return null;

  return (
    <div className="w-full min-h-[50px]">
      {loading && (
        <div className="flex items-center justify-center h-[50px] text-sm text-muted-foreground">
          Loading PayPal…
        </div>
      )}
      {error && (
        <div className="text-sm text-destructive text-center">{error}</div>
      )}
      <div ref={containerRef} />
    </div>
  );
}
