/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Img, Preview, Section, Text, Hr } from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  amount?: number | string
  paymentDetails?: string
  proofUrl?: string
  adminNote?: string
}

const fmt = (v: number | string | undefined) => Number(v ?? 0).toFixed(2)

const Email = ({ customerName, amount, paymentDetails, proofUrl, adminNote }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Withdrawal of {fmt(amount)} USDT completed</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailLogo />
        <Heading style={h1}>✅ Withdrawal Completed</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi,'} your withdrawal has been processed successfully.
        </Text>
        <Section style={box}>
          <Text style={meta}><strong>Amount:</strong> {fmt(amount)} USDT</Text>
          {paymentDetails ? <Text style={meta}><strong>Payment details:</strong> {paymentDetails}</Text> : null}
          {adminNote ? <Text style={meta}><strong>Note:</strong> {adminNote}</Text> : null}
        </Section>
        {proofUrl ? (
          <Section style={{ margin: '12px 0' }}>
            <Text style={meta}><strong>Proof:</strong></Text>
            <Img src={proofUrl} alt="Withdrawal proof" style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '6px' }} />
          </Section>
        ) : null}
        <Hr style={hr} />
        <Text style={footer}>Thanks for using our service.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `✅ Withdrawal completed — ${Number(d?.amount || 0).toFixed(2)} USDT`,
  displayName: 'Withdrawal completed',
  previewData: { customerName: 'Jane', amount: 50, paymentDetails: 'TRX: TXxxxxx' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { background: '#f0fdf4', borderRadius: '10px', padding: '14px 18px', margin: '12px 0', border: '1px solid #bbf7d0' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
