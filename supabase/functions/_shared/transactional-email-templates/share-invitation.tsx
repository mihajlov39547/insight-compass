import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Researcher"

interface ShareInvitationProps {
  inviterName?: string
  itemName?: string
  itemType?: string
  permission?: string
  acceptUrl?: string
}

// This module is used by edge functions, not React Fast Refresh runtime.
// eslint-disable-next-line react-refresh/only-export-components
const ShareInvitationEmail = ({
  inviterName = 'A team member',
  itemName = 'Untitled',
  itemType = 'project',
  permission = 'editor',
  acceptUrl,
}: ShareInvitationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{inviterName} invited you to collaborate on "{itemName}"</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoSection}>
          <Text style={logo}>{SITE_NAME}</Text>
        </Section>

        <Heading style={h1}>You've been invited!</Heading>

        <Text style={text}>
          <strong>{inviterName}</strong> has invited you to collaborate on
          the {itemType} <strong>"{itemName}"</strong> as a <strong>{permission}</strong>.
        </Text>

        <Text style={text}>
          With {permission} access, you can{' '}
          {permission === 'viewer'
            ? 'view documents and chat history.'
            : permission === 'admin'
              ? 'manage settings, collaborators, and all content.'
              : 'edit documents, chat, and collaborate in real-time.'}
        </Text>

        {acceptUrl && (
          <Section style={buttonSection}>
            <Button style={button} href={acceptUrl}>
              Open {itemType}
            </Button>
          </Section>
        )}

        <Hr style={hr} />

        <Text style={footer}>
          This invitation was sent via {SITE_NAME}. If you weren't expecting
          this, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ShareInvitationEmail,
  subject: (data: Record<string, any>) =>
    `${data.inviterName || 'Someone'} invited you to "${data.itemName || 'a project'}" on Researcher`,
  displayName: 'Share invitation',
  previewData: {
    inviterName: 'Jane Doe',
    itemName: 'Research Project',
    itemType: 'project',
    permission: 'editor',
    acceptUrl: 'https://example.com',
  },
} satisfies TemplateEntry

// Styles
const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '520px', margin: '0 auto' }
const logoSection = { textAlign: 'center' as const, marginBottom: '24px' }
const logo = { fontSize: '18px', fontWeight: '700', color: '#3b82f6', margin: '0' }
const h1 = { fontSize: '22px', fontWeight: '700', color: '#1e293b', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.6', margin: '0 0 16px' }
const buttonSection = { textAlign: 'center' as const, margin: '24px 0' }
const button = {
  backgroundColor: '#3b82f6',
  borderRadius: '8px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: '600',
  padding: '12px 32px',
  textDecoration: 'none',
}
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', lineHeight: '1.5', margin: '0' }
