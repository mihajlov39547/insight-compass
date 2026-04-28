import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Researcher"

interface ContactSalesProps {
  contactEmail?: string
  subject?: string
  message?: string
  senderName?: string
}

// eslint-disable-next-line react-refresh/only-export-components
const ContactSalesEmail = ({
  contactEmail = '',
  subject = 'Enterprise inquiry',
  message = '',
  senderName,
}: ContactSalesProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New sales inquiry from {contactEmail || 'a prospect'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoSection}>
          <Text style={logo}>{SITE_NAME}</Text>
        </Section>

        <Heading style={h1}>New sales inquiry</Heading>

        <Text style={text}>
          <strong>From:</strong> {senderName ? `${senderName} <${contactEmail}>` : contactEmail}
        </Text>
        <Text style={text}>
          <strong>Subject:</strong> {subject}
        </Text>

        <Hr style={hr} />

        <Text style={messageStyle}>{message}</Text>

        <Hr style={hr} />

        <Text style={footer}>
          Reply directly to {contactEmail} to follow up.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ContactSalesEmail,
  subject: (data: Record<string, any>) =>
    `[Sales] ${data.subject || 'Enterprise inquiry'} — ${data.contactEmail || 'unknown'}`,
  displayName: 'Contact sales',
  previewData: {
    contactEmail: 'prospect@example.com',
    subject: 'Enterprise plan inquiry',
    message: 'Hi, we would like to learn more about the Enterprise plan...',
    senderName: 'Jane Doe',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const logoSection = { textAlign: 'center' as const, marginBottom: '24px' }
const logo = { fontSize: '18px', fontWeight: '700', color: '#3b82f6', margin: '0' }
const h1 = { fontSize: '22px', fontWeight: '700', color: '#1e293b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 8px' }
const messageStyle = {
  fontSize: '15px',
  color: '#1e293b',
  lineHeight: '1.6',
  margin: '0',
  whiteSpace: 'pre-wrap' as const,
}
const hr = { borderColor: '#e2e8f0', margin: '20px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', lineHeight: '1.5', margin: '0' }
