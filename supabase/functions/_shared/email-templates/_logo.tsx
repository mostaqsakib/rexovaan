/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Img, Section } from 'npm:@react-email/components@0.0.22'

export const LOGO_URL =
  'https://mxcuakzztajvkgtsocln.supabase.co/storage/v1/object/public/site-assets/logo-1779634439274.png'

export const EmailLogo = () => (
  <Section style={{ textAlign: 'center', padding: '24px 0 8px' }}>
    <Img
      src={LOGO_URL}
      alt="Rexovaan Shoppie"
      width="64"
      height="64"
      style={{
        display: 'inline-block',
        borderRadius: '12px',
        objectFit: 'contain',
      }}
    />
  </Section>
)
