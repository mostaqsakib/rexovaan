/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Rexovaan Shoppie'

interface DepositPendingProps {
  customerName?: string
  amount?: number
  paymentMethod?: string
  txnHash?: string
}

const DepositPendingEmail = ({
  customerName,
  amount = 0,
  paymentMethod = 'Unknown',
  txnHash = '',
}: DepositPendingProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your deposit of {amount.toFixed(2)} USDT is awaiting review</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailLogo />
        <Heading style={h1}>⏳ Deposit Submitted</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi,'} we received your deposit request on {SITE_NAME}.
          Our system could not auto-verify it instantly — an admin will review it shortly.
        </Text>

        <Section style={box}>
          <Text style={meta}><strong>Claimed Amount:</strong> {amount.toFixed(2)} USDT</Text>
          <Text style={meta}><strong>Payment Method:</strong> {paymentMethod}</Text>
          <Text style={meta}><strong>TxID:</strong> <span style={mono}>{txnHash}</span></Text>
          <Text style={meta}><strong>Status:</strong> Pending Manual Review</Text>
        </Section>

        <Hr style={hr} />
        <Text style={footer}>
          You'll receive another email once your deposit is verified and credited. Most reviews complete within a few hours.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DepositPendingEmail,
  subject: (d: Record<string, any>) =>
    `⏳ Deposit received — ${Number(d?.amount || 0).toFixed(2)} USDT pending review`,
  displayName: 'Deposit pending review',
  previewData: {
    customerName: 'Jane',
    amount: 25.5,
    paymentMethod: 'USDT BEP20',
    txnHash: '0xabc123def456',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { background: '#fffbeb', borderRadius: '10px', padding: '14px 18px', margin: '12px 0', border: '1px solid #fde68a' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const mono = { fontFamily: 'Courier, monospace', fontSize: '12px', wordBreak: 'break-all' as const }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
