import { createClient } from 'npm:@supabase/supabase-js@2'
import { encryptPassword } from '../_shared/auth/encrypt-pending-password.ts'

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
  // 5-digit code, padded
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 100000)
  return n.toString().padStart(5, '0')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''

  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  if (password.length < 6 || password.length > 200) {
    return new Response(JSON.stringify({ error: 'invalid_password' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Opportunistic cleanup
  await supabase.rpc('cleanup_expired_pending_registrations')

  // Reject if a confirmed user already exists with this email
  const { data: existingUsers, error: lookupErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (lookupErr) {
    console.error('listUsers failed', lookupErr)
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  if (existingUsers.users.some((u) => (u.email || '').toLowerCase() === email)) {
    return new Response(JSON.stringify({ error: 'email_taken' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const code = generateCode()
  const codeHash = await sha256Hex(code)
  // Encrypt password with AES-GCM (key derived from service-role key) so DB backups / WAL
  // never see plaintext. The plaintext is only reconstituted in register-otp-verify just
  // before being passed to admin.createUser, where Supabase Auth applies bcrypt.
  const passwordHash = await encryptPassword(password)

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  // Upsert by email (re-trigger replaces previous row)
  const { error: upsertErr } = await supabase
    .from('pending_registrations')
    .upsert({
      email,
      password_hash: passwordHash,
      code_hash: codeHash,
      attempts: 0,
      expires_at: expiresAt,
    }, { onConflict: 'email' })

  if (upsertErr) {
    console.error('upsert pending_registrations failed', upsertErr)
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Send the OTP email via the shared transactional sender
  const { error: sendErr } = await supabase.functions.invoke('send-transactional-email', {
    body: {
      templateName: 'registration-otp',
      recipientEmail: email,
      idempotencyKey: `register-otp-${email}-${codeHash.slice(0, 12)}`,
      templateData: { code, expiresInMinutes: 15 },
    },
  })

  if (sendErr) {
    console.error('send-transactional-email failed', sendErr)
    return new Response(JSON.stringify({ error: 'email_send_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ ok: true, expiresInMinutes: 15 }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
