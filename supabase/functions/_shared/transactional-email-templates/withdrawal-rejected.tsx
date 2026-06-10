/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text, Hr } from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  amount?: number | string
  newBalance?: number | string
  reason?: string
}

const fmt = (v: number | string | undefined) => Number(v ?? 0).toFixed(2)

const Email = ({ customerName, amount, newBalance, reason }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Withdrawal of {fmt(amount)} USDT rejected — funds returned</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailLogo />
        <Heading style={h1}>❌ Withdrawal Rejected</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi,'} your withdrawal request was rejected. The amount has been returned to your balance.
        </Text>
        <Section style={box}>
          <Text style={meta}><strong>Amount:</strong> {fmt(amount)} USDT</Text>
          <Text style={meta}><strong>Current balance:</strong> {fmt(newBalance)} USDT</Text>
          {reason ? <Text style={meta}><strong>Reason:</strong> {reason}</Text> : null}
        </Section>
        <Hr style={hr} />
        <Text style={footer}>Contact support if you have any questions.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: '❌ Your withdrawal was rejected',
  displayName: 'Withdrawal rejected',
  previewData: { customerName: 'Jane', amount: 50, newBalance: 100 },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { background: '#fef2f2', borderRadius: '10px', padding: '14px 18px', margin: '12px 0', border: '1px solid #fecaca' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
