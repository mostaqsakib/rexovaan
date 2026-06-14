/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Rexovaan Shoppie'

interface OrderDeliveryProps {
  customerName?: string
  productName?: string
  quantity?: number
  totalPrice?: number
  orderId?: string
  items?: string[]
}

const OrderDeliveryEmail = ({
  customerName,
  productName = 'your order',
  quantity = 1,
  totalPrice,
  orderId,
  items = [],
}: OrderDeliveryProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {productName} order is delivered</Preview>
    <Body style={main}>
      <Container style={container}>
        <EmailLogo />
        <Heading style={h1}>Order delivered 🎉</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi,'} thanks for your purchase from {SITE_NAME}.
          Your order details are below.
        </Text>

        <Section style={box}>
          <Text style={meta}><strong>Product:</strong> {productName}</Text>
          <Text style={meta}><strong>Quantity:</strong> {quantity}</Text>
          {totalPrice !== undefined && (
            <Text style={meta}><strong>Total:</strong> ${Number(totalPrice).toFixed(2)}</Text>
          )}
          {orderId && (
            <Text style={meta}><strong>Order ID:</strong> {orderId}</Text>
          )}
        </Section>

        {items.length > 0 && (
          <>
            <Heading as="h2" style={h2}>Your items</Heading>
            <Section style={itemsBox}>
              {items.map((line, i) => (
                <Text key={i} style={itemLine}>{line}</Text>
              ))}
            </Section>
          </>
        )}

        <Hr style={hr} />
        <Text style={footer}>
          Keep this email safe — it's your delivery receipt. If anything looks wrong, reply or contact support.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: OrderDeliveryEmail,
  subject: (d: Record<string, any>) =>
    `Your ${d?.productName || 'order'} is delivered — ${SITE_NAME}`,
  displayName: 'Order delivery',
  previewData: {
    customerName: 'Jane',
    productName: 'Premium Account',
    quantity: 2,
    totalPrice: 19.98,
    orderId: 'abc-123',
    items: ['user1@mail.com | pass1', 'user2@mail.com | pass2'],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const h2 = { fontSize: '16px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '24px 0 8px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { background: '#f5f5fa', borderRadius: '10px', padding: '14px 18px', margin: '12px 0' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const itemsBox = { background: '#f5f5fa', border: '1px solid #e0e0ec', borderRadius: '10px', padding: '14px 18px', fontFamily: 'Courier, monospace' }
const itemLine = { fontSize: '13px', color: '#1a1a2e', margin: '2px 0', wordBreak: 'break-all' as const }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
