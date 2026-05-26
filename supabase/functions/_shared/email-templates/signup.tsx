/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoSection}>
          <Text style={logo}>{siteName}</Text>
        </Section>

        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for {siteName}. Confirm <strong>{recipient}</strong> to
          finish creating your account.
        </Text>

        <Section style={buttonSection}>
          <Button style={button} href={confirmationUrl}>Verify email</Button>
        </Section>

        <Text style={hint}>
          If you didn't create an account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '480px', margin: '0 auto' }
const logoSection = { textAlign: 'center' as const, marginBottom: '24px' }
const logo = { fontSize: '18px', fontWeight: '700', color: '#3b82f6', margin: '0' }
const h1 = { fontSize: '22px', fontWeight: '700', color: '#1e293b', margin: '0 0 12px', textAlign: 'center' as const }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 24px', textAlign: 'center' as const }
const buttonSection = { textAlign: 'center' as const, margin: '0 0 24px' }
const button = {
  backgroundColor: '#3b82f6',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  borderRadius: '12px',
  padding: '12px 24px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hint = { fontSize: '13px', color: '#94a3b8', lineHeight: '1.5', textAlign: 'center' as const, margin: '0' }
