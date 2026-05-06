import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Section, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Researcher"

interface SubscriptionConfirmationProps {
  planName?: string
  planKey?: string
  subscriptionId?: string
  billingPeriod?: string
  periodStart?: string
  price?: string
  email?: string
  name?: string
}

const SubscriptionConfirmationEmail = ({
  planName = 'Premium',
  planKey = 'premium_monthly',
  subscriptionId = 'I-XXXXXXXXXX',
  billingPeriod = 'Monthly',
  periodStart,
  price,
  email,
  name,
}: SubscriptionConfirmationProps) => {
  const startDate = periodStart || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const displayPrice = price || (planKey?.includes('premium') ? '$14.99/month' : '$7.99/month')

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your {SITE_NAME} {planName} subscription is confirmed</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={headerSection}>
            <Heading style={logo}>{SITE_NAME}</Heading>
          </Section>

          <Hr style={divider} />

          {/* Greeting */}
          <Heading style={h1}>
            🎉 Subscription Confirmed!
          </Heading>
          <Text style={text}>
            {name ? `Hi ${name},` : 'Hi there,'} thank you for subscribing to <strong>{SITE_NAME} {planName}</strong>! Your subscription is now active and you have full access to all {planName} features.
          </Text>

          {/* Invoice / Details Box */}
          <Section style={invoiceBox}>
            <Heading style={invoiceTitle}>Subscription Details</Heading>

            <Section style={row}>
              <Text style={labelText}>Plan</Text>
              <Text style={valueText}>{planName}</Text>
            </Section>

            <Hr style={rowDivider} />

            <Section style={row}>
              <Text style={labelText}>Billing Period</Text>
              <Text style={valueText}>{billingPeriod}</Text>
            </Section>

            <Hr style={rowDivider} />

            <Section style={row}>
              <Text style={labelText}>Amount</Text>
              <Text style={valueText}>{displayPrice}</Text>
            </Section>

            <Hr style={rowDivider} />

            <Section style={row}>
              <Text style={labelText}>Start Date</Text>
              <Text style={valueText}>{startDate}</Text>
            </Section>

            <Hr style={rowDivider} />

            <Section style={row}>
              <Text style={labelText}>Subscription ID</Text>
              <Text style={valueText}>{subscriptionId}</Text>
            </Section>

            {email && (
              <>
                <Hr style={rowDivider} />
                <Section style={row}>
                  <Text style={labelText}>Account Email</Text>
                  <Text style={valueText}>{email}</Text>
                </Section>
              </>
            )}

            <Hr style={rowDivider} />

            <Section style={row}>
              <Text style={labelText}>Payment Method</Text>
              <Text style={valueText}>PayPal</Text>
            </Section>
          </Section>

          {/* Next Steps */}
          <Text style={text}>
            Your subscription will automatically renew each billing cycle. You can manage or cancel your subscription anytime from <strong>Settings → Billing</strong> in the app.
          </Text>

          <Text style={text}>
            If you have any questions about your subscription, don't hesitate to reach out to our support team.
          </Text>

          <Hr style={divider} />

          <Text style={footer}>
            This is an automated receipt from {SITE_NAME}. Please keep it for your records.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SubscriptionConfirmationEmail,
  subject: (data: Record<string, any>) => `Your ${data.planName || 'subscription'} on Researcher is confirmed`,
  displayName: 'Subscription confirmation',
  previewData: {
    planName: 'Premium',
    planKey: 'premium_monthly',
    subscriptionId: 'I-MX1D9WRWPSJT',
    billingPeriod: 'Monthly',
    periodStart: 'May 6, 2026',
    price: '$14.99/month',
    email: 'user@example.com',
    name: 'Jane',
  },
} satisfies TemplateEntry

// Styles
const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '40px 30px', maxWidth: '560px', margin: '0 auto' }
const headerSection = { textAlign: 'center' as const, marginBottom: '10px' }
const logo = { fontSize: '20px', fontWeight: '700' as const, color: '#2563eb', margin: '0' }
const divider = { borderColor: '#e5e7eb', margin: '20px 0' }
const h1 = { fontSize: '24px', fontWeight: '700' as const, color: '#111827', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const invoiceBox = { backgroundColor: '#f9fafb', borderRadius: '8px', padding: '24px', margin: '24px 0', border: '1px solid #e5e7eb' }
const invoiceTitle = { fontSize: '16px', fontWeight: '600' as const, color: '#111827', margin: '0 0 16px' }
const row = { display: 'flex' as const, justifyContent: 'space-between' as const, padding: '8px 0' }
const rowDivider = { borderColor: '#e5e7eb', margin: '0' }
const labelText = { fontSize: '14px', color: '#6b7280', margin: '0', flex: '1' }
const valueText = { fontSize: '14px', color: '#111827', fontWeight: '500' as const, margin: '0', textAlign: 'right' as const }
const footer = { fontSize: '12px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
