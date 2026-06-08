/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Img, Section, Text } from 'npm:@react-email/components@0.0.22'

export const SHOP_NAME = 'Rexovaan Shoppie'
export const SITE_URL = 'https://rexovaan.com'
export const LOGO_URL = 'https://mxcuakzztajvkgtsocln.supabase.co/storage/v1/object/public/site-assets/logo-1779634439274.png'

export const BrandHeader = () => (
  <Section style={brandHeader}>
    <Img src={LOGO_URL} width="48" height="48" alt={SHOP_NAME} style={logo} />
    <Text style={brandName}>{SHOP_NAME}</Text>
  </Section>
)

export const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
}

export const container = {
  padding: '28px 24px 32px',
  maxWidth: '560px',
}

export const h1 = {
  fontSize: '24px',
  lineHeight: '1.25',
  fontWeight: 'bold' as const,
  color: '#111322',
  margin: '0 0 16px',
}

export const text = {
  fontSize: '15px',
  color: '#525568',
  lineHeight: '1.65',
  margin: '0 0 22px',
}

export const link = {
  color: '#5B4FE6',
  textDecoration: 'underline',
}

export const button = {
  backgroundColor: '#5B4FE6',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: '14px',
  padding: '13px 22px',
  textDecoration: 'none',
}

export const footer = {
  fontSize: '12px',
  color: '#7B7E90',
  lineHeight: '1.55',
  borderTop: '1px solid #E7E8F3',
  paddingTop: '18px',
  margin: '30px 0 0',
}

export const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '28px',
  fontWeight: 'bold' as const,
  letterSpacing: '6px',
  color: '#111322',
  backgroundColor: '#F4F5FF',
  border: '1px solid #E1E3FA',
  borderRadius: '12px',
  padding: '14px 18px',
  margin: '0 0 28px',
}

const brandHeader = {
  margin: '0 0 28px',
}

const logo = {
  borderRadius: '14px',
  display: 'block',
  margin: '0 0 10px',
}

const brandName = {
  fontSize: '16px',
  fontWeight: 'bold' as const,
  color: '#111322',
  margin: '0',
}