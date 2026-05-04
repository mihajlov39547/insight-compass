import React, { useEffect, useRef, useState } from 'react';
import { PAYPAL_CLIENT_ID, PAYPAL_ENV } from '@/config/env';

/**
 * Build the SDK URL using the configured client ID.
 * PayPal uses the same host (www.paypal.com) for both sandbox and live —
 * the environment is determined by the client-id credential, not the hostname.
 */
function buildSdkUrl(): string {
  if (!PAYPAL_CLIENT_ID) {
    throw new Error(
      'VITE_PAYPAL_CLIENT_ID is not configured. ' +
      'Set it in public/env.js or as a Vite env var.'
    );
  }
  console.info(`[PayPal] Loading SDK — env=${PAYPAL_ENV}, clientId=${PAYPAL_CLIENT_ID.slice(0, 12)}…`);
  return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(PAYPAL_CLIENT_ID)}&vault=true&intent=subscription`;
}

let sdkLoadPromise: Promise<void> | null = null;

function loadPayPalSDK(): Promise<void> {
  if ((window as any).paypal) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = buildSdkUrl();
    script.setAttribute('data-sdk-integration-source', 'button-factory');
    script.onload = () => resolve();
    script.onerror = () => {
      sdkLoadPromise = null; // allow retry
      reject(new Error('Failed to load PayPal SDK'));
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
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
              return actions.subscription.create({ plan_id: planId });
            },
            onApprove: (data: any) => {
              onApprove(data.subscriptionID, planId, planKey);
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
