// Confirm a plant identification for a case. Only the case owner can confirm,
// and only identifications belonging to that same case. Sanitized errors only.
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
    const identificationId = String(body?.identificationId || '');
    if (!plantCaseId || !identificationId) {
      return jsonResponse({ error: 'invalid_input' }, 400);
    }

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

    const { data: pcase } = await admin
      .from('plant_cases')
      .select('id,user_id')
      .eq('id', plantCaseId)
      .maybeSingle();
    if (!pcase) return jsonResponse({ error: 'not_found' }, 404);
    if ((pcase as any).user_id !== userId) return jsonResponse({ error: 'forbidden' }, 403);

    const { data: ident } = await admin
      .from('plant_identifications')
      .select('id,case_id,scientific_name,scientific_name_without_author,common_name')
      .eq('id', identificationId)
      .maybeSingle();
    if (!ident) return jsonResponse({ error: 'not_found' }, 404);
    if ((ident as any).case_id !== plantCaseId) return jsonResponse({ error: 'forbidden' }, 403);

    // Clear existing confirmations for the case.
    const { error: clearErr } = await admin
      .from('plant_identifications')
      .update({ is_confirmed: false, confirmed_at: null })
      .eq('case_id', plantCaseId);
    if (clearErr) return jsonResponse({ error: 'confirmation_failed' }, 500);

    const now = new Date().toISOString();
    const { data: confirmed, error: confErr } = await admin
      .from('plant_identifications')
      .update({ is_confirmed: true, confirmed_at: now })
      .eq('id', identificationId)
      .select('*')
      .single();
    if (confErr || !confirmed) return jsonResponse({ error: 'confirmation_failed' }, 500);

    const scientific =
      (confirmed as any).scientific_name_without_author || (confirmed as any).scientific_name || null;
    const common = (confirmed as any).common_name || null;

    const { error: caseErr } = await admin
      .from('plant_cases')
      .update({
        confirmed_identification_id: identificationId,
        confirmed_scientific_name: scientific,
        confirmed_common_name: common,
        confirmed_at: now,
      })
      .eq('id', plantCaseId);
    if (caseErr) return jsonResponse({ error: 'confirmation_failed' }, 500);

    return jsonResponse({ ok: true, identification: confirmed });
  } catch (_e) {
    return jsonResponse({ error: 'confirmation_failed' }, 500);
  }
});
