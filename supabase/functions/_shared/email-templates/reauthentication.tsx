/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  siteName?: string
  token: string
}

export const ReauthenticationEmail = ({
  siteName = 'Researcher',
  token,
}: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {siteName} verification code: {token}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoSection}>
          <Text style={logo}>{siteName}</Text>
        </Section>

        <Heading style={h1}>Confirm reauthentication</Heading>
        <Text style={text}>
          Use the code below to confirm your identity. The code expires shortly.
        </Text>

        <Section style={codeBox}>
          <Text style={codeText}>{token}</Text>
        </Section>

        <Text style={hint}>
          If you didn't request this, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
