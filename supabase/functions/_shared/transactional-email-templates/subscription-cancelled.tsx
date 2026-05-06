import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Section, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Researcher"

interface SubscriptionCancelledProps {
  planName?: string
  subscriptionId?: string
  accessUntil?: string
  email?: string
  name?: string
}

const SubscriptionCancelledEmail = ({
  planName = 'Premium',
  subscriptionId = 'I-XXXXXXXXXX',
  accessUntil,
  email,
  name,
}: SubscriptionCancelledProps) => {
  const endDate = accessUntil || 'the end of your current billing period'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your {SITE_NAME} {planName} subscription has been cancelled</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={headerSection}>
            <Heading style={logo}>{SITE_NAME}</Heading>
          </Section>

          <Hr style={divider} />

          <Heading style={h1}>Subscription Cancelled</Heading>
          <Text style={text}>
            {name ? `Hi ${name},` : 'Hi there,'} we've processed your cancellation request. Your <strong>{planName}</strong> subscription has been cancelled.
          </Text>

          {/* Details Box */}
          <Section style={infoBox}>
            <Heading style={infoTitle}>What happens next?</Heading>

            <Section style={row}>
              <Text style={labelText}>Plan</Text>
              <Text style={valueText}>{planName}</Text>
            </Section>

            <Hr style={rowDivider} />

            <Section style={row}>
              <Text style={labelText}>Access Until</Text>
              <Text style={valueTextHighlight}>{endDate}</Text>
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
                  <Text style={labelText}>Account</Text>
                  <Text style={valueText}>{email}</Text>
                </Section>
              </>
            )}

            <Hr style={rowDivider} />

            <Section style={row}>
              <Text style={labelText}>After Period Ends</Text>
              <Text style={valueText}>Downgraded to Free</Text>
            </Section>
          </Section>

          <Text style={text}>
            You'll continue to have full access to all {planName} features until <strong>{endDate}</strong>. After that date, your account will automatically switch to the Free plan.
          </Text>

          <Text style={text}>
            No further charges will be made to your PayPal account. If you change your mind, you can resubscribe anytime from <strong>Settings → Billing</strong>.
          </Text>

          <Hr style={divider} />

          <Text style={footer}>
            This is an automated confirmation from {SITE_NAME}. Please keep it for your records.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SubscriptionCancelledEmail,
  subject: (data: Record<string, any>) => `Your ${data.planName || 'subscription'} on Researcher has been cancelled`,
  displayName: 'Subscription cancellation',
  previewData: {
    planName: 'Premium',
    subscriptionId: 'I-MX1D9WRWPSJT',
    accessUntil: 'June 6, 2026',
    email: 'user@example.com',
    name: 'Jane',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '40px 30px', maxWidth: '560px', margin: '0 auto' }
const headerSection = { textAlign: 'center' as const, marginBottom: '10px' }
const logo = { fontSize: '20px', fontWeight: '700' as const, color: '#2563eb', margin: '0' }
const divider = { borderColor: '#e5e7eb', margin: '20px 0' }
const h1 = { fontSize: '24px', fontWeight: '700' as const, color: '#111827', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const infoBox = { backgroundColor: '#fef9f0', borderRadius: '8px', padding: '24px', margin: '24px 0', border: '1px solid #fde68a' }
const infoTitle = { fontSize: '16px', fontWeight: '600' as const, color: '#92400e', margin: '0 0 16px' }
const row = { display: 'flex' as const, justifyContent: 'space-between' as const, padding: '8px 0' }
const rowDivider = { borderColor: '#fde68a', margin: '0' }
const labelText = { fontSize: '14px', color: '#6b7280', margin: '0', flex: '1' }
const valueText = { fontSize: '14px', color: '#111827', fontWeight: '500' as const, margin: '0', textAlign: 'right' as const }
const valueTextHighlight = { fontSize: '14px', color: '#b45309', fontWeight: '600' as const, margin: '0', textAlign: 'right' as const }
const footer = { fontSize: '12px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
