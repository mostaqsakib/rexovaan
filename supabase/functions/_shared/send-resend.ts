// Resend sender used by process-email-queue.
// Throws an error with `.status` and `.retryAfterSeconds` compatible with the
// existing rate-limit / DLQ handling in process-email-queue.

export interface ResendSendInput {
  to: string
  from: string
  subject: string
  html?: string
  text?: string
  unsubscribe_token?: string
  message_id?: string
}

export class ResendError extends Error {
  status: number
  retryAfterSeconds: number | null
  body: string
  constructor(status: number, body: string, retryAfterSeconds: number | null) {
    super(`Resend send failed [${status}]: ${body}`)
    this.status = status
    this.body = body
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export async function sendResendEmail(input: ResendSendInput, apiKey: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (input.message_id) {
    headers['Idempotency-Key'] = input.message_id
  }

  const listUnsub: string[] = []
  if (input.unsubscribe_token) {
    listUnsub.push(
      `<https://rexovaan.com/unsubscribe?token=${encodeURIComponent(input.unsubscribe_token)}>`,
    )
  }

  const body: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  }
  if (listUnsub.length) {
    body.headers = {
      'List-Unsubscribe': listUnsub.join(', '),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    const retryAfterHeader = res.headers.get('retry-after')
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null
    throw new ResendError(res.status, text, Number.isFinite(retryAfter as number) ? retryAfter : null)
  }
}
