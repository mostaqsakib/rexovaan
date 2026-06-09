import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your Rexovaan Shoppie email',
  invite: "You're invited to Rexovaan Shoppie",
  magiclink: 'Your Rexovaan Shoppie login link',
  recovery: 'Reset your Rexovaan Shoppie password',
  email_change: 'Confirm your Rexovaan Shoppie email change',
  reauthentication: 'Your Rexovaan Shoppie verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration
const SITE_NAME = "Rexovaan Shoppie"
const SENDER_DOMAIN = "notify.rexovaan.com"
const ROOT_DOMAIN = "rexovaan.com"
const FROM_DOMAIN = "rexovaan.com" // Domain shown in From address (may be root or sender subdomain)

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://rexovaanshop.lovable.app"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

type SupabaseAuthHookPayload = {
  user?: {
    email?: string
    new_email?: string
  }
  email_data?: {
    token?: string
    token_hash?: string
    token_new?: string
    token_hash_new?: string
    redirect_to?: string
    email_action_type?: string
    old_email?: string
  }
}

function cleanHookSecret(secret: string): string {
  return secret.replace(/^v1,whsec_/, '')
}

function getConfirmationUrl(actionType: string, tokenHash?: string, redirectTo?: string): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('NEW_SUPABASE_URL')
  if (!supabaseUrl || !tokenHash) {
    return redirectTo || `https://${ROOT_DOMAIN}`
  }

  const params = new URLSearchParams({
    token: tokenHash,
    type: actionType,
  })

  if (redirectTo) {
    params.set('redirect_to', redirectTo)
  }

  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function getOrCreateUnsubscribeToken(
  supabase: ReturnType<typeof createClient>,
  email: string
): Promise<string> {
  const normalizedEmail = email.toLowerCase()
  const { data: existingToken } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existingToken?.token) {
    return existingToken.token
  }

  const unsubscribeToken = generateToken()
  await supabase
    .from('email_unsubscribe_tokens')
    .upsert(
      { token: unsubscribeToken, email: normalizedEmail },
      { onConflict: 'email', ignoreDuplicates: true }
    )

  const { data: storedToken } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', normalizedEmail)
    .maybeSingle()

  return storedToken?.token || unsubscribeToken
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Webhook handler - verifies Supabase Auth Hook signature and queues the branded email.
async function handleWebhook(req: Request): Promise<Response> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('NEW_SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY')

  if (!apiKey || !hookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Required email configuration is missing')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let payload: SupabaseAuthHookPayload
  try {
    const rawPayload = await req.text()
    const headers = Object.fromEntries(req.headers)
    const webhook = new Webhook(cleanHookSecret(hookSecret))
    payload = webhook.verify(rawPayload, headers) as SupabaseAuthHookPayload
  } catch (error) {
    console.error('Invalid Supabase auth hook signature', { error })
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const emailData = payload.email_data
  const user = payload.user
  const emailType = emailData?.email_action_type
  const recipientEmail = user?.email

  if (!emailData || !user || !emailType || !recipientEmail) {
    console.error('Invalid Supabase auth hook payload')
    return new Response(JSON.stringify({ error: 'Invalid webhook payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType })
    return new Response(JSON.stringify({ error: `Unknown email type: ${emailType}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const confirmationUrl = getConfirmationUrl(
    emailType,
    emailData.token_hash,
    emailData.redirect_to
  )

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: recipientEmail,
    confirmationUrl,
    token: emailData.token,
    email: recipientEmail,
    oldEmail: emailData.old_email || recipientEmail,
    newEmail: user.new_email || recipientEmail,
  }

  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), {
    plainText: true,
  })

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const messageId = crypto.randomUUID()

  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: recipientEmail,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      message_id: messageId,
      to: recipientEmail,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || 'Notification',
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      idempotency_key: `${emailType}:${recipientEmail}:${emailData.token_hash || emailData.token || messageId}`,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue auth email', { error: enqueueError, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: recipientEmail,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email enqueued', { emailType, email: recipientEmail })

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
