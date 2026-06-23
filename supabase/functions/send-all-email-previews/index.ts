import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { requireAdmin } from '../_shared/require-admin.ts'

const SITE_NAME = 'Rexovaan Shoppie'
const SENDER_DOMAIN = 'notify.rexovaanshoppie.com'
const FROM_DOMAIN = 'rexovaanshoppie.com'
const SITE_URL = 'https://rexovaanshoppie.com'

const AUTH_TEMPLATES: Array<{ name: string; subject: string; component: any; props: any }> = [
  { name: 'signup', subject: '[Preview] Confirm your email', component: SignupEmail, props: { siteName: SITE_NAME, siteUrl: SITE_URL, recipient: 'mostaqahmmeds@gmail.com', confirmationUrl: SITE_URL } },
  { name: 'invite', subject: "[Preview] You've been invited", component: InviteEmail, props: { siteName: SITE_NAME, siteUrl: SITE_URL, confirmationUrl: SITE_URL } },
  { name: 'magiclink', subject: '[Preview] Your login link', component: MagicLinkEmail, props: { siteName: SITE_NAME, confirmationUrl: SITE_URL } },
  { name: 'recovery', subject: '[Preview] Reset your password', component: RecoveryEmail, props: { siteName: SITE_NAME, confirmationUrl: SITE_URL } },
  { name: 'email_change', subject: '[Preview] Confirm your new email', component: EmailChangeEmail, props: { siteName: SITE_NAME, oldEmail: 'old@example.com', email: 'mostaqahmmeds@gmail.com', newEmail: 'mostaqahmmeds@gmail.com', confirmationUrl: SITE_URL } },
  { name: 'reauthentication', subject: '[Preview] Your verification code', component: ReauthenticationEmail, props: { token: '123456' } },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const guard = await requireAdmin(req, corsHeaders)
  if (guard) return guard

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const to = Deno.env.get('EMAIL_PREVIEW_RECIPIENT')
  if (!to) {
    return new Response(JSON.stringify({ error: 'EMAIL_PREVIEW_RECIPIENT env var not set' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const results: any[] = []

  // Ensure an unsubscribe token exists for this recipient
  const genToken = () => {
    const b = new Uint8Array(32); crypto.getRandomValues(b)
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  }
  let unsubscribeToken = genToken()
  const { data: existing } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token').eq('email', to.toLowerCase()).maybeSingle()
  if (existing?.token) {
    unsubscribeToken = existing.token
  } else {
    await supabase.from('email_unsubscribe_tokens')
      .upsert({ token: unsubscribeToken, email: to.toLowerCase() }, { onConflict: 'email', ignoreDuplicates: true })
    const { data: stored } = await supabase
      .from('email_unsubscribe_tokens').select('token').eq('email', to.toLowerCase()).maybeSingle()
    if (stored?.token) unsubscribeToken = stored.token
  }

  const enqueue = async (queue: string, subject: string, label: string, html: string, text: string) => {
    const messageId = crypto.randomUUID()
    await supabase.from('email_send_log').insert({ message_id: messageId, template_name: label, recipient_email: to, status: 'pending' })
    const { error } = await supabase.rpc('enqueue_email', {
      queue_name: queue,
      payload: {
        message_id: messageId,
        to,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        label,
        idempotency_key: `preview-${label}-${Date.now()}`,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    })
    results.push({ label, queued: !error, error: error?.message })
  }


  for (const t of AUTH_TEMPLATES) {
    const html = await renderAsync(React.createElement(t.component, t.props))
    const text = await renderAsync(React.createElement(t.component, t.props), { plainText: true })
    await enqueue('transactional_emails', t.subject, `preview_${t.name}`, html, text)
  }

  for (const [name, tpl] of Object.entries(TEMPLATES)) {
    const props = tpl.previewData || {}
    const html = await renderAsync(React.createElement(tpl.component, props))
    const text = await renderAsync(React.createElement(tpl.component, props), { plainText: true })
    const subject = '[Preview] ' + (typeof tpl.subject === 'function' ? tpl.subject(props) : tpl.subject)
    await enqueue('transactional_emails', subject, `preview_${name}`, html, text)
  }

  return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
