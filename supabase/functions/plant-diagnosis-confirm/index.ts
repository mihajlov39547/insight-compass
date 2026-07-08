// Confirm a plant disease diagnosis for a case.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const plantCaseId = String(body?.plantCaseId || '');
    const diagnosisId = String(body?.diagnosisId || '');
    if (!plantCaseId || !diagnosisId) return jsonResponse({ error: 'invalid_input' }, 400);

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

    const { data: pcase } = await admin
      .from('plant_cases')
      .select('id,user_id')
      .eq('id', plantCaseId)
      .maybeSingle();
    if (!pcase) return jsonResponse({ error: 'not_found' }, 404);
    if ((pcase as any).user_id !== userId) return jsonResponse({ error: 'forbidden' }, 403);

    const { data: diag } = await admin
      .from('plant_diagnoses')
      .select('id,case_id,problem_type,name,provider')
      .eq('id', diagnosisId)
      .maybeSingle();
    if (!diag) return jsonResponse({ error: 'not_found' }, 404);
    if ((diag as any).case_id !== plantCaseId) return jsonResponse({ error: 'forbidden' }, 403);

    const { error: clearErr } = await admin
      .from('plant_diagnoses')
      .update({ is_confirmed: false, confirmed_at: null })
      .eq('case_id', plantCaseId);
    if (clearErr) return jsonResponse({ error: 'confirmation_failed' }, 500);

    const now = new Date().toISOString();
    const { data: confirmed, error: confErr } = await admin
      .from('plant_diagnoses')
      .update({ is_confirmed: true, confirmed_at: now })
      .eq('id', diagnosisId)
      .select('*')
      .single();
    if (confErr || !confirmed) return jsonResponse({ error: 'confirmation_failed' }, 500);

    const c: any = confirmed;
    const { error: caseErr } = await admin
      .from('plant_cases')
      .update({
        confirmed_diagnosis_id: diagnosisId,
        confirmed_problem_type: c.problem_type ?? 'disease',
        confirmed_problem_name: c.name ?? null,
        diagnosed_at: now,
        diagnosis_provider: c.provider ?? 'plantnet_disease',
      })
      .eq('id', plantCaseId);
    if (caseErr) return jsonResponse({ error: 'confirmation_failed' }, 500);

    return jsonResponse({ ok: true, diagnosis: confirmed });
  } catch (_e) {
    return jsonResponse({ error: 'confirmation_failed' }, 500);
  }
});
