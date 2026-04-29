import { createClient } from 'npm:@supabase/supabase-js@2'
import { decryptPassword } from '../_shared/auth/encrypt-pending-password.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_ATTEMPTS = 3

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: { email?: string; code?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const email = (body.email || '').trim().toLowerCase()
  const code = (body.code || '').trim()

  if (!email || !/^\d{5}$/.test(code)) {
    return new Response(JSON.stringify({ error: 'invalid_input' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: pending, error: fetchErr } = await supabase
    .from('pending_registrations')
    .select('id, email, password_hash, code_hash, attempts, expires_at')
    .eq('email', email)
    .maybeSingle()

  if (fetchErr) {
    console.error('fetch pending failed', fetchErr)
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  if (!pending) {
    return new Response(JSON.stringify({ error: 'no_pending' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await supabase.from('pending_registrations').delete().eq('id', pending.id)
    return new Response(JSON.stringify({ error: 'expired' }), { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const codeHash = await sha256Hex(code)
  if (codeHash !== pending.code_hash) {
    const newAttempts = pending.attempts + 1
    if (newAttempts >= MAX_ATTEMPTS) {
      await supabase.from('pending_registrations').delete().eq('id', pending.id)
      return new Response(JSON.stringify({ error: 'too_many_attempts' }), { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    await supabase.from('pending_registrations').update({ attempts: newAttempts }).eq('id', pending.id)
    return new Response(JSON.stringify({ error: 'invalid_code', attemptsLeft: MAX_ATTEMPTS - newAttempts }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Code matches — decrypt the stored password and create the auth user with email already confirmed
  let plaintextPassword: string
  try {
    plaintextPassword = await decryptPassword(pending.password_hash)
  } catch (e) {
    console.error('decryptPassword failed', e)
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: pending.email,
    password: plaintextPassword,
    email_confirm: true,
  })

  if (createErr || !created?.user) {
    console.error('admin.createUser failed', createErr)
    // If user already exists for some reason, treat as success-ish but inform client
    const message = createErr?.message?.toLowerCase() || ''
    if (message.includes('already')) {
      await supabase.from('pending_registrations').delete().eq('id', pending.id)
      return new Response(JSON.stringify({ error: 'email_taken' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'create_user_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Cleanup pending row
  await supabase.from('pending_registrations').delete().eq('id', pending.id)

  return new Response(JSON.stringify({ ok: true, userId: created.user.id }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
