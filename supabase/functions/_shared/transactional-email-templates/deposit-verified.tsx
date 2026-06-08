/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Rexovaan Shoppie'

interface DepositVerifiedProps {
  customerName?: string
  amount?: number | string
  via?: string
  txnHash?: string
  newBalance?: number | string
  ltcAmount?: number | string
  rate?: number | string
}

function formatNumber(value: number | string | undefined, digits = 2): string {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toFixed(digits) : Number(0).toFixed(digits)
}

const DepositVerifiedEmail = ({
  customerName,
  amount = 0,
  via = 'Crypto',
  txnHash = '',
  newBalance = 0,
  ltcAmount,
  rate,
}: DepositVerifiedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your deposit of {formatNumber(amount)} USDT has been verified</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailLogo />
        <Heading style={h1}>✅ Deposit Verified</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi,'} your deposit has been auto-verified and credited to your {SITE_NAME} account.
        </Text>

        <Section style={box}>
          <Text style={meta}><strong>Amount:</strong> {formatNumber(amount)} USDT</Text>
          <Text style={meta}><strong>Via:</strong> {via}</Text>
          {Number(ltcAmount) > 0 && Number(rate) > 0 ? (
            <>
              <Text style={meta}><strong>Sent:</strong> {formatNumber(ltcAmount, 8)} LTC</Text>
              <Text style={meta}><strong>Rate:</strong> 1 LTC = {formatNumber(rate)} USDT</Text>
            </>
          ) : null}
          <Text style={meta}><strong>TxID:</strong> <span style={mono}>{txnHash}</span></Text>
          <Text style={meta}><strong>New Balance:</strong> {formatNumber(newBalance)} USDT</Text>
        </Section>

        <Hr style={hr} />
        <Text style={footer}>
          You can now use your balance to purchase products on {SITE_NAME}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DepositVerifiedEmail,
  subject: (d: Record<string, any>) =>
    `✅ Deposit verified — ${Number(d?.amount || 0).toFixed(2)} USDT credited`,
  displayName: 'Deposit verified',
  previewData: {
    customerName: 'Jane',
    amount: 25.5,
    via: 'USDT Binance Pay',
    txnHash: '0xabc123def456',
    newBalance: 75.5,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { background: '#f0fdf4', borderRadius: '10px', padding: '14px 18px', margin: '12px 0', border: '1px solid #bbf7d0' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const mono = { fontFamily: 'Courier, monospace', fontSize: '12px', wordBreak: 'break-all' as const }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
