/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as shareInvitation } from './share-invitation.tsx'
import { template as contactSales } from './contact-sales.tsx'
import { template as registrationOtp } from './registration-otp.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'share-invitation': shareInvitation,
  'contact-sales': contactSales,
  'registration-otp': registrationOtp,
}
