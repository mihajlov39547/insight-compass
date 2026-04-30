import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ATTEMPTS = 5

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function err(code: string, status = 400, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: code, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: { email?: string; code?: string; newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return err('invalid_json')
  }

  const email = (body.email || '').trim().toLowerCase()
  const code = (body.code || '').trim()
  const newPassword = body.newPassword || ''

  if (!EMAIL_RE.test(email)) return err('invalid_email')
  if (!/^\d{5}$/.test(code)) return err('invalid_code')
  if (newPassword.length < 6 || newPassword.length > 200) return err('invalid_password')

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: row, error: fetchErr } = await supabase
    .from('password_reset_tokens')
    .select('id, code_hash, attempts, expires_at, used_at')
    .eq('email', email)
    .maybeSingle()

  if (fetchErr) {
    console.error('fetch token failed', fetchErr)
    return err('server_error', 500)
  }
  if (!row) return err('no_pending', 404)
  if (row.used_at) return err('no_pending', 404)
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await supabase.from('password_reset_tokens').delete().eq('email', email)
    return err('expired', 410)
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await supabase.from('password_reset_tokens').delete().eq('email', email)
    return err('too_many_attempts', 429)
  }

  const codeHash = await sha256Hex(code)
  if (codeHash !== row.code_hash) {
    const newAttempts = row.attempts + 1
    await supabase
      .from('password_reset_tokens')
      .update({ attempts: newAttempts })
      .eq('id', row.id)
    const left = Math.max(0, MAX_ATTEMPTS - newAttempts)
    return err('invalid_code', 400, { attemptsLeft: left })
  }

  // Find the user by email
  let userId: string | null = null
  let page = 1
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      console.error('listUsers failed', error)
      return err('server_error', 500)
    }
    const match = data.users.find((u) => (u.email || '').toLowerCase() === email)
    if (match) { userId = match.id; break }
    if (data.users.length < 1000) break
    page += 1
  }
  if (!userId) {
    await supabase.from('password_reset_tokens').delete().eq('email', email)
    return err('no_pending', 404)
  }

  const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
    password: newPassword,
  })
  if (updateErr) {
    console.error('updateUserById failed', updateErr)
    // Likely a weak/leaked password (HIBP) — surface generic but specific code
    const msg = (updateErr.message || '').toLowerCase()
    if (msg.includes('pwned') || msg.includes('weak') || msg.includes('password')) {
      return err('weak_password', 400)
    }
    return err('server_error', 500)
  }

  await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
