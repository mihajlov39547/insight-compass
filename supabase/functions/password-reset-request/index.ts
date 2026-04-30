import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateCode(): string {
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 100000)
  return n.toString().padStart(5, '0')
}

function ok() {
  // Always return ok to avoid email enumeration
  return new Response(JSON.stringify({ ok: true, expiresInMinutes: 15 }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: { email?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const email = (body.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  await supabase.rpc('cleanup_expired_password_reset_tokens')

  // Find user by email — paginate through admin list
  let userExists = false
  let isOAuthOnly = false
  let page = 1
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      console.error('listUsers failed', error)
      return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const match = data.users.find((u) => (u.email || '').toLowerCase() === email)
    if (match) {
      userExists = true
      const providers: string[] = (match.app_metadata?.providers as string[] | undefined) ?? []
      const provider: string | undefined = match.app_metadata?.provider as string | undefined
      const all = [...providers, ...(provider ? [provider] : [])]
      isOAuthOnly = all.length > 0 && !all.includes('email')
      break
    }
    if (data.users.length < 1000) break
    page += 1
  }

  // Don't reveal whether the email exists or not — always pretend success.
  if (!userExists || isOAuthOnly) return ok()

  const code = generateCode()
  const codeHash = await sha256Hex(code)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  const { error: upsertErr } = await supabase
    .from('password_reset_tokens')
    .upsert({
      email,
      code_hash: codeHash,
      attempts: 0,
      expires_at: expiresAt,
      used_at: null,
    }, { onConflict: 'email' })

  if (upsertErr) {
    console.error('upsert password_reset_tokens failed', upsertErr)
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const { error: sendErr } = await supabase.functions.invoke('send-transactional-email', {
    body: {
      templateName: 'password-reset-otp',
      recipientEmail: email,
      idempotencyKey: `password-reset-${email}-${codeHash.slice(0, 12)}`,
      templateData: { code, expiresInMinutes: 15 },
    },
  })

  if (sendErr) {
    console.error('send-transactional-email failed', sendErr)
    return new Response(JSON.stringify({ error: 'email_send_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  return ok()
})
