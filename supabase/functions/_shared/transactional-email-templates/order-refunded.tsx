/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text, Hr } from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  productName?: string
  quantity?: number | string
  amount?: number | string
  note?: string
}

const fmt = (v: number | string | undefined) => Number(v ?? 0).toFixed(2)

const Email = ({ customerName, productName, quantity, amount, note }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Order refunded — {fmt(amount)} USDT returned</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailLogo />
        <Heading style={h1}>↩️ Order Refunded</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi,'} your recent order has been refunded. The amount has been credited back to your balance.
        </Text>
        <Section style={box}>
          {productName ? <Text style={meta}><strong>Product:</strong> {productName}{quantity ? ` × ${quantity}` : ''}</Text> : null}
          <Text style={meta}><strong>Refunded:</strong> {fmt(amount)} USDT</Text>
          {note ? <Text style={meta}><strong>Note:</strong> {note}</Text> : null}
        </Section>
        <Hr style={hr} />
        <Text style={footer}>You can use this balance on your next purchase.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `↩️ Order refunded — ${Number(d?.amount || 0).toFixed(2)} USDT`,
  displayName: 'Order refunded',
  previewData: { customerName: 'Jane', productName: 'Sample Product', quantity: 2, amount: 30 },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { background: '#eff6ff', borderRadius: '10px', padding: '14px 18px', margin: '12px 0', border: '1px solid #bfdbfe' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
