/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as orderDelivery } from './order-delivery.tsx'
import { template as depositVerified } from './deposit-verified.tsx'
import { template as depositPending } from './deposit-pending.tsx'
import { template as depositRejected } from './deposit-rejected.tsx'
import { template as balanceAdjustment } from './balance-adjustment.tsx'
import { template as withdrawalCompleted } from './withdrawal-completed.tsx'
import { template as withdrawalRejected } from './withdrawal-rejected.tsx'
import { template as orderRefunded } from './order-refunded.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'order-delivery': orderDelivery,
  'deposit-verified': depositVerified,
  'deposit-pending': depositPending,
  'deposit-rejected': depositRejected,
  'balance-adjustment': balanceAdjustment,
  'withdrawal-completed': withdrawalCompleted,
  'withdrawal-rejected': withdrawalRejected,
  'order-refunded': orderRefunded,
}
