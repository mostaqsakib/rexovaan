/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text, Hr } from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  amount?: number | string
  txnHash?: string
  reason?: string
}

const fmt = (v: number | string | undefined) => Number(v ?? 0).toFixed(2)

const Email = ({ customerName, amount, txnHash, reason }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your deposit has been rejected</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailLogo />
        <Heading style={h1}>❌ Deposit Rejected</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi,'} unfortunately your deposit could not be verified and has been rejected.
        </Text>
        <Section style={box}>
          {amount ? <Text style={meta}><strong>Amount:</strong> {fmt(amount)} USDT</Text> : null}
          {txnHash ? <Text style={meta}><strong>TxID:</strong> <span style={mono}>{txnHash}</span></Text> : null}
          {reason ? <Text style={meta}><strong>Reason:</strong> {reason}</Text> : null}
        </Section>
        <Hr style={hr} />
        <Text style={footer}>If you believe this is a mistake, please contact support with your transaction details.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: '❌ Your deposit was rejected',
  displayName: 'Deposit rejected',
  previewData: { customerName: 'Jane', amount: 25, txnHash: '0xabc123' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { background: '#fef2f2', borderRadius: '10px', padding: '14px 18px', margin: '12px 0', border: '1px solid #fecaca' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const mono = { fontFamily: 'Courier, monospace', fontSize: '12px', wordBreak: 'break-all' as const }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
