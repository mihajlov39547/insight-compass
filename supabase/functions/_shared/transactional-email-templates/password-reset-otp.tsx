import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Researcher'

interface PasswordResetOtpProps {
  code?: string
  expiresInMinutes?: number
}

// eslint-disable-next-line react-refresh/only-export-components
const PasswordResetOtpEmail = ({
  code = '00000',
  expiresInMinutes = 15,
}: PasswordResetOtpProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {SITE_NAME} password reset code: {code}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoSection}>
          <Text style={logo}>{SITE_NAME}</Text>
        </Section>

        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          Use the code below to reset your {SITE_NAME} password. The code
          expires in {expiresInMinutes} minutes.
        </Text>

        <Section style={codeBox}>
          <Text style={codeText}>{code}</Text>
        </Section>

        <Text style={hint}>
          If you didn't request a password reset, you can safely ignore this email — your password will not change.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PasswordResetOtpEmail,
  subject: (data: Record<string, any>) =>
    `Your ${SITE_NAME} password reset code: ${data.code || ''}`.trim(),
  displayName: 'Password reset code',
  previewData: { code: '12345', expiresInMinutes: 15 },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '480px', margin: '0 auto' }
const logoSection = { textAlign: 'center' as const, marginBottom: '24px' }
const logo = { fontSize: '18px', fontWeight: '700', color: '#3b82f6', margin: '0' }
const h1 = { fontSize: '22px', fontWeight: '700', color: '#1e293b', margin: '0 0 12px', textAlign: 'center' as const }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 24px', textAlign: 'center' as const }
const codeBox = {
  backgroundColor: '#f1f5f9',
  borderRadius: '12px',
  padding: '20px',
  textAlign: 'center' as const,
  margin: '0 0 24px',
}
const codeText = {
  fontSize: '36px',
  fontWeight: '700',
  letterSpacing: '8px',
  color: '#1e293b',
  margin: '0',
  fontFamily: "'Courier New', monospace",
}
const hint = { fontSize: '13px', color: '#94a3b8', lineHeight: '1.5', textAlign: 'center' as const, margin: '0' }
