/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text, Hr } from 'npm:@react-email/components@0.0.22'
import { EmailLogo } from './_logo.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Rexovaan Shoppie'

interface Props {
  customerName?: string
  oldBalance?: number | string
  newBalance?: number | string
  diff?: number | string
  note?: string
}

const fmt = (v: number | string | undefined) => Number(Number(v ?? 0).toFixed(2)).toFixed(2)

const Email = ({ customerName, oldBalance = 0, newBalance = 0, diff = 0, note = '' }: Props) => {
  const n = Number(diff)
  const isCredit = n >= 0
  const emoji = isCredit ? '💰' : '💸'
  const headline = isCredit ? 'Balance Credited' : 'Balance Debited'
  const accent = isCredit ? { bg: '#f0fdf4', border: '#bbf7d0' } : { bg: '#fff7ed', border: '#fed7aa' }

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{emoji} Your balance was {isCredit ? 'credited' : 'debited'} by {fmt(Math.abs(n))} USDT</Preview>
      <Body style={main}>
        <Container style={container}>
          <EmailLogo />
          <Heading style={h1}>{emoji} {headline}</Heading>
          <Text style={text}>
            {customerName ? `Hi ${customerName},` : 'Hi,'} an admin has {isCredit ? 'credited' : 'debited'} your {SITE_NAME} account balance.
          </Text>

          <Section style={{ ...box, background: accent.bg, border: `1px solid ${accent.border}` }}>
            <Text style={meta}><strong>Previous:</strong> {fmt(oldBalance)} USDT</Text>
            <Text style={meta}><strong>Change:</strong> {isCredit ? '+' : ''}{fmt(n)} USDT</Text>
            <Text style={meta}><strong>New balance:</strong> {fmt(newBalance)} USDT</Text>
            {note ? <Text style={meta}><strong>Note:</strong> {note}</Text> : null}
          </Section>

          <Hr style={hr} />
          <Text style={footer}>If you have any questions about this change, please contact support.</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => {
    const n = Number(d?.diff || 0)
    return `${n >= 0 ? '💰' : '💸'} Balance ${n >= 0 ? 'credited' : 'debited'} — ${Math.abs(n).toFixed(2)} USDT`
  },
  displayName: 'Balance adjustment',
  previewData: { customerName: 'Jane', oldBalance: 50, newBalance: 75, diff: 25, note: 'Goodwill credit' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a0a1a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#444', lineHeight: '1.6', margin: '0 0 16px' }
const box = { borderRadius: '10px', padding: '14px 18px', margin: '12px 0' }
const meta = { fontSize: '14px', color: '#222', margin: '4px 0' }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#888', margin: '12px 0 0' }
