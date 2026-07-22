// Plant Advisor chat — Phase 4C.
// Builds context (case, identification, diagnosis, AI interpretation) and
// forwards to the Lovable AI Gateway. Does NOT provide treatment/pesticide
// instructions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeModelId(id: string): string {
  const raw = (id || '').trim();
  if (!raw) return 'google/gemini-3.5-flash';
  if (raw.includes('/')) return raw;
  if (raw.startsWith('gemini')) return `google/${raw}`;
  if (raw.startsWith('gpt')) return `openai/${raw}`;
  return raw;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const aiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!aiKey) return json({ error: 'missing_ai_key' }, 503);

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const caseId = String(body?.caseId || '');
    const lang = (body?.lang === 'sr' ? 'sr' : 'en') as 'en' | 'sr';
    const messages: ChatMessage[] = Array.isArray(body?.messages)
      ? body.messages
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-20)
      : [];
    if (!caseId) return json({ error: 'missing_case_id' }, 400);
    if (messages.length === 0) return json({ error: 'empty_messages' }, 400);

    const admin = createClient(supaUrl, serviceKey);

    const { data: pc, error: pcErr } = await admin
      .from('plant_cases')
      .select('id, user_id, title, user_goal, location_text, crop_context, notes, status, confirmed_identification_id')
      .eq('id', caseId)
      .maybeSingle();
    if (pcErr) return json({ error: 'case_lookup_failed' }, 500);
    if (!pc || pc.user_id !== userId) return json({ error: 'case_not_found' }, 404);

    const [imgs, idents, diags, interps, profiles, groundings] = await Promise.all([
      admin.from('plant_case_images').select('id, image_role').eq('case_id', caseId),
      admin
        .from('plant_identifications')
        .select('id, rank, score, scientific_name, scientific_name_without_author, common_name, genus, family, provider, is_confirmed')
        .eq('case_id', caseId)
        .order('rank', { ascending: true })
        .limit(10),
      admin
        .from('plant_diagnoses')
        .select('id, rank, score, provider, name, description, problem_type, plant_relevance, plant_relevance_reason, is_confirmed, raw_result')
        .eq('case_id', caseId)
        .order('rank', { ascending: true })
        .limit(10),
      admin
        .from('plant_diagnosis_interpretations')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(1),
      admin
        .from('plant_species_profiles')
        .select('*')
        .eq('case_id', caseId)
        .order('fetched_at', { ascending: false })
        .limit(1),
      admin
        .from('plant_case_grounding_contexts')
        .select('*')
        .eq('case_id', caseId)
        .eq('goal', 'improve_growth')
        .eq('status', 'success')
        .order('fetched_at', { ascending: false })
        .limit(1),
    ]);

    const imageRows = (imgs.data as { image_role: string | null }[] | null) ?? [];
    const identRows = (idents.data as any[] | null) ?? [];
    const diagRows = (diags.data as any[] | null) ?? [];
    const interp = (interps.data as any[] | null)?.[0] ?? null;
    const profileRow = (profiles.data as any[] | null)?.[0] ?? null;
    const trefle = profileRow?.profile ?? null;
    const groundingRow = (groundings.data as any[] | null)?.[0] ?? null;

    const confirmedIdent = identRows.find((i) => i.is_confirmed) ?? null;
    const confirmedDiag = diagRows.find((d) => d.is_confirmed) ?? null;

    const confidenceBucket = (s: number | null | undefined): 'high' | 'medium' | 'low' => {
      const v = s ?? 0;
      if (v >= 0.7) return 'high';
      if (v >= 0.4) return 'medium';
      return 'low';
    };

    const context = {
      caseContext: {
        caseId: pc.id,
        title: pc.title,
        userGoal: pc.user_goal,
        location: pc.location_text,
        cropContext: pc.crop_context,
        notes: pc.notes,
        imageCount: imageRows.length,
        imageRoles: imageRows.map((r) => r.image_role || 'auto'),
      },
      identification: {
        confirmedPlant: confirmedIdent
          ? {
              scientificName: confirmedIdent.scientific_name_without_author || confirmedIdent.scientific_name,
              commonName: confirmedIdent.common_name,
              genus: confirmedIdent.genus,
              family: confirmedIdent.family,
              confidence: confirmedIdent.score,
              provider: confirmedIdent.provider,
            }
          : null,
        topIdentificationAlternatives: identRows.slice(0, 5).map((i) => ({
          scientificName: i.scientific_name_without_author || i.scientific_name,
          commonName: i.common_name,
          score: i.score,
          genus: i.genus,
          family: i.family,
          isConfirmed: !!i.is_confirmed,
        })),
      },
      diagnosis: {
        confirmedDiagnosis: confirmedDiag
          ? {
              name: confirmedDiag.name,
              problemType: confirmedDiag.problem_type,
              score: confirmedDiag.score,
              plantRelevance: confirmedDiag.plant_relevance,
              plantRelevanceReason: confirmedDiag.plant_relevance_reason,
              provider: confirmedDiag.provider,
              isConfirmed: true,
            }
          : null,
        providerCandidates: diagRows.slice(0, 8).map((d) => ({
          rank: d.rank,
          name: d.name,
          providerCode: (d as any).raw_result?._providerCode ?? null,
          description: d.description,
          problemType: d.problem_type,
          score: d.score,
          confidenceBucket: confidenceBucket(d.score),
          plantRelevance: d.plant_relevance,
          plantRelevanceReason: d.plant_relevance_reason,
          isConfirmed: !!d.is_confirmed,
        })),
        aiInterpretation: interp
          ? {
              summary: interp.summary,
              overallConfidence: interp.overall_confidence,
              bestCandidates: interp.interpretation?.bestCandidates ?? [],
              unlikelyCandidates: interp.interpretation?.unlikelyCandidates ?? [],
              needsMoreEvidence: interp.interpretation?.needsMoreEvidence ?? [],
              safetyNote: interp.interpretation?.safetyNote ?? '',
              model: interp.model,
            }
          : null,
      },
      speciesProfile: trefle
        ? {
            provider: 'trefle',
            fetchedAt: profileRow.fetched_at,
            scientificName: trefle.scientificName,
            commonName: trefle.commonName,
            family: trefle.family,
            genus: trefle.genus,
            status: trefle.status,
            rank: trefle.rank,
            synonyms: trefle.synonyms ?? [],
            duration: trefle.duration ?? null,
            edible: trefle.edible ?? null,
            ediblePart: trefle.ediblePart ?? null,
            vegetable: trefle.vegetable ?? null,
            toxicity: trefle.toxicity ?? null,
            growth: trefle.growth ?? null,
            specifications: trefle.specifications ?? null,
            distributions: trefle.distributions ?? null,
            sources: trefle.sources ?? null,
          }
        : null,
      growthGrounding: groundingRow
        ? {
            fetchedAt: groundingRow.fetched_at,
            status: groundingRow.status,
            plant: groundingRow.normalized_summary?.plant ?? null,
            location: groundingRow.normalized_summary?.location ?? null,
            normalizedCare: groundingRow.normalized_summary?.normalizedCare ?? null,
            limitations: groundingRow.normalized_summary?.limitations ?? [],
            sources: (groundingRow.sources ?? []).map((s: any) => ({
              provider: s.provider,
              title: s.title,
              url: s.url,
              summary: s.summary,
              careCategories: s.careCategories,
              sourceType: s.sourceType,
              authorityScore: s.authorityScore,
            })),
          }
        : null,
      notes: {
        noConfirmedDiagnosis: !confirmedDiag ? 'No diagnosis has been confirmed yet.' : null,
        noAiInterpretation: !interp ? 'No AI interpretation is available yet.' : null,
        noSpeciesProfile: !trefle ? 'No Trefle plant profile is available yet.' : null,
        noGrowthGrounding: !groundingRow ? 'No growth grounding has been gathered yet.' : null,
      },
    };

    const langInstruction = lang === 'sr' ? 'Respond in Serbian (Latin script).' : 'Respond in English.';

    const goalDirective = (() => {
      switch (pc.user_goal) {
        case 'identify':
          return 'This is an IDENTIFICATION case. Focus on the plant identification: confirmed plant, confidence, alternatives, and what additional photos would help. Do not answer disease, pest, treatment, or remediation questions inside an identify-only case. Redirect the user to create/open a diagnosis or treatment workflow after plant confirmation. If the user asks about disease, pests, or treatment, say this case is configured for identification only and suggest creating or opening a diagnosis case after the plant is confirmed.';
        case 'diagnose':
          return 'This is a DIAGNOSIS case. Focus on the confirmed plant and disease/pest candidates, their relevance to the confirmed plant, uncertainty, and visual checks. If no plant is confirmed yet, explain that the plant must be confirmed before diagnosis is meaningful.';
        case 'improve_growth':
          return 'This is an IMPROVE-GROWTH case. Prioritize the confirmed plant, user location, crop context, Trefle profile, and growthGrounding (Perenual + web sources). If growthGrounding is MISSING (notes.noGrowthGrounding is set), tell the user that dedicated growth guidance has not been gathered yet and suggest they run "Gather growth guidance" before giving detailed species-specific care advice; you may still answer generally from the confirmed plant and Trefle profile, clearly noting the guidance has not been gathered. When growthGrounding IS present, cite source names ("according to Perenual", "per Trefle", or the web source title) when giving care advice, and prefer sources with authorityScore "high" (university extensions, botanical gardens, government agriculture pages). Distinguish structured database facts (Trefle, Perenual) from web-sourced guidance. If sources conflict, say so and prefer the higher-authority / more local source. Do NOT invent missing values. If plant identification confidence is low, warn that advice applies only if the plant is correctly identified. Do NOT diagnose disease. Do NOT recommend fertilizer product names, pesticide/fungicide/herbicide products, doses, mixing rates, or chemical application schedules. General watering, sunlight, soil, pruning timing, mulching, monitoring, and when-to-seek-expert-help are OK.';
        case 'increase_income':
          return 'This is a YIELD/MARKET planning case. Discuss general considerations tied to the confirmed plant. Do not invent market prices or yield numbers not in the context.';
        default:
          return 'Focus on the case context provided. If the case goal is not set, ask the user to clarify what they want to achieve.';
      }
    })();

    const systemPrompt = `You are Plant Advisor's case assistant. You help the user reason about a specific plant case using the provided context. ${langInstruction}

GOAL DIRECTIVE: ${goalDirective}

Rules:
- Answer using ONLY the provided case context (caseContext, identification, diagnosis, aiInterpretation, speciesProfile).
- Clearly distinguish CONFIRMED facts (confirmedPlant, confirmedDiagnosis) from CANDIDATES (providerCandidates, alternatives).
- When provider confidence is low or plantRelevance is not "high", explicitly mention the uncertainty.
- Prefer the confirmed plant and confirmed diagnosis when available.
- If a diagnosis is not confirmed, say the disease/pest is only a candidate.
- If aiInterpretation exists AND the case goal is diagnose, use it as triage context and cite its overallConfidence. Do not mention aiInterpretation for identify-only cases.
- For plant care, growth requirements, edibility, toxicity, and distribution questions, use speciesProfile (Trefle) when present. Cite the provider ("according to Trefle") and note that this is reference data, not local advice.
- If speciesProfile is null or a specific field is missing/null, say the profile does not contain that information. Do NOT invent values.
- Explain what visual details the user should check next when helpful (e.g. "inspect leaf undersides for orange pustules").
- If evidence is weak or missing, ask the user for clearer photos of the affected parts.
- You are NOT looking at the images directly. You only see image counts and roles. If the user asks what you see in the photo, say you cannot inspect the images directly in this chat and rely on metadata, provider results, and notes.
- When explaining low-confidence identification, describe it in RELATIVE terms: the confirmed plant has a low score AND the nearest alternative has a very similar score, so the system did not clearly separate several similar candidates. Do NOT quote universal thresholds (e.g. "below 30-40% is unreliable") — use the actual scores and the closeness of alternatives.

You MUST NOT:
- Pretend a disease is certain when it is only a provider candidate.
- Hide or downplay provider uncertainty.
- Auto-confirm any diagnosis.
- Give pesticide, fungicide, herbicide, or fertilizer product names, doses, mixing rates, spray intervals, or application instructions.
- Recommend regulated chemicals or spray schedules.
- Fabricate diagnoses that are not in providerCandidates or aiInterpretation.
- Invent Trefle profile values (pH, temperatures, toxicity, edibility, distribution) that are not in speciesProfile.
- Discuss disease diagnosis when the case goal is identify-only.

Formatting:
- Use short paragraphs and bullet lists where helpful.
- Reference candidates by their common name (or scientific name) plus provider rank when useful.
- Keep answers concise and grounded.`;

    const contextMessage = {
      role: 'system' as const,
      content: `PLANT_CASE_CONTEXT (JSON):\n${JSON.stringify(context)}`,
    };

    const primaryModel = normalizeModelId(Deno.env.get('PLANT_CHAT_AI_PRIMARY_MODEL') ?? 'gemini-3.5-flash');
    const fallbackModel = normalizeModelId(Deno.env.get('PLANT_CHAT_AI_FALLBACK_MODEL') ?? 'google/gemini-2.5-pro');

    const callModel = async (model: string): Promise<{ ok: boolean; text?: string; reason?: string; status?: number }> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aiKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              contextMessage,
              ...messages,
            ],
          }),
        });
        if (!resp.ok) {
          const t = (await resp.text().catch(() => '')).slice(0, 200);
          return { ok: false, reason: `http_${resp.status}:${t}`, status: resp.status };
        }
        const b = await resp.json().catch(() => null);
        const content = b?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          return { ok: false, reason: 'empty_content' };
        }
        return { ok: true, text: content };
      } catch (e) {
        return { ok: false, reason: `error:${(e as Error).message}` };
      } finally {
        clearTimeout(timeout);
      }
    };

    let result = await callModel(primaryModel);
    let modelUsed = primaryModel;
    let usedFallback = false;
    if (!result.ok && fallbackModel && fallbackModel !== primaryModel) {
      const second = await callModel(fallbackModel);
      if (second.ok) {
        result = second;
        modelUsed = fallbackModel;
        usedFallback = true;
      } else {
        if (result.status === 429 || second.status === 429) return json({ error: 'rate_limited' }, 429);
        if (result.status === 402 || second.status === 402) return json({ error: 'credits_exhausted' }, 402);
        return json({ error: 'ai_failed', reason: `${result.reason};${second.reason}` }, 502);
      }
    } else if (!result.ok) {
      if (result.status === 429) return json({ error: 'rate_limited' }, 429);
      if (result.status === 402) return json({ error: 'credits_exhausted' }, 402);
      return json({ error: 'ai_failed', reason: result.reason }, 502);
    }

    return json({
      ok: true,
      reply: result.text,
      modelUsed,
      usedFallback,
    });
  } catch (e) {
    console.error('[plant-case-chat] fatal', (e as Error).message);
    return json({ error: 'internal_error' }, 500);
  }
});
