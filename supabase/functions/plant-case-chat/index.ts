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
    // When true, skip generating/persisting a reply and only return follow-up
    // suggestions derived from the existing conversation (used when reopening a chat).
    const followUpsOnly = body?.followUpsOnly === true;
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
        .select('id, rank, score, scientific_name, scientific_name_without_author, common_name, genus, family, provider, is_confirmed, gbif_id, powo_id')
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
        .in('status', ['success', 'partial'])
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
            overview: groundingRow.normalized_summary?.overview ?? null,
            normalizedCare: groundingRow.normalized_summary?.normalizedCare ?? null,
            sourceGroups: groundingRow.normalized_summary?.sourceGroups ?? null,
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
          return 'This is an IDENTIFICATION case. Focus on the plant identification: the confirmed plant, its confidence, the top alternatives and how they differ, taxonomy (genus/family), distinguishing morphological features, typical habitat and distribution, similar/confusable species, and how the user can verify the ID (which features and which additional photos). Reference taxonomy sources (GBIF, Plants of the World Online) and Trefle when they are present in the context, and note that the user can extract or crawl those URL-backed sources for deeper taxonomy, distinguishing features, habitat, similar species and verification detail. Do not answer disease, pest, treatment, or remediation questions inside an identify-only case: say this case is configured for identification only and suggest opening or creating a "Diagnose problem" case once the plant is confirmed. If growthGrounding is available, you may use it for general care, growth, habitat, watering, sunlight, soil, pruning, hardiness, maintenance, pests/disease awareness, and fruiting/harvest context: use the matching growthGrounding.normalizedCare card summary and cite its sources. Keep the main case identity as IDENTIFICATION. Do not diagnose a specific disease/problem in Identify cases. For problem diagnosis, ask the user to open or create a "Diagnose problem" case. Pest/disease content in an Identify case must stay preventive and general-awareness only, and must never include fertilizer/pesticide/fungicide/herbicide product names, doses, mixing rates, spray schedules, or chemical treatment instructions.';
        case 'diagnose':
          return 'This is a DIAGNOSIS case. Focus on the confirmed plant and the disease/pest candidates, their relevance to the confirmed plant, uncertainty, and the visual checks that would separate them. Provider candidates are diagnostic CONTEXT only — never treatment proof; always describe them as candidates. Cover symptoms to check, host range, visual signs, environmental/cultural conditions that favour the problem, whether it could be pest damage, disease, or abiotic stress, prevention and sanitation, and when to seek local expert help. Do NOT give pesticide/fungicide/herbicide/insecticide product names, active ingredients, doses, mixing rates, spray schedules, or chemical treatment instructions — decline those specifics briefly and continue with safe diagnostic and preventive guidance. If no plant is confirmed yet, explain that the plant must be confirmed before diagnosis is meaningful.';

        case 'improve_growth':
          return 'This is an IMPROVE-GROWTH case. Prioritize the confirmed plant, user location, crop context, Trefle profile, and growthGrounding (Perenual + web sources). growthGrounding.overview gives general plant context (habitat, habit, broad care). growthGrounding.normalizedCare has one summary per care card (watering, sunlight, soil, pruning, hardinessClimate, growthRateMaintenance, pestsDisease, fruitingHarvest); growthGrounding.sourceGroups holds the web sources grouped by that same card. When answering a category-specific question, prefer that card\'s summary and its own sourceGroups entry — do not mix sources from other cards. IMPORTANT: If growthGrounding is present in the context (not null), NEVER say growth guidance has not been gathered. If only some cards are populated, name which areas are available and which are limited, and answer from the populated cards plus Trefle. Only when growthGrounding is null (notes.noGrowthGrounding is set) should you tell the user that dedicated growth guidance has not been gathered yet and suggest running "Gather growth guidance"; even then, still answer generally from the confirmed plant and Trefle. For practical "how do I improve growth / what should I use" questions, DIRECTLY answer the goal first, then use the relevant cards (Sunlight for light, Soil for soil/organic matter, Watering for moisture, Pruning for structure, Growth rate / maintenance for pace, Pests and disease for monitoring). You may recommend SAFE CATEGORIES of intervention — watering and moisture management, sunlight and site selection, soil structure and organic matter, mulch, pruning and structural training, monitoring for pests and disease, and seeking local expert advice — without naming commercial products, chemical products, fertilizers, doses, mixing rates, or application schedules. Do not refuse the question; only decline the prohibited specifics (product names, doses, schedules) with a short explanation, then continue with the safe categories. For pest/disease questions in Improve Growth, use the pestsDisease card: cover common risks for this plant, symptoms/signs to monitor, prevention, sanitation, and cultural care, and suggest seeking local expert help when appropriate — do NOT diagnose the user\'s specific plant from images or descriptions, and do NOT recommend pesticide/fungicide/herbicide/insecticide product names, doses, mixing rates, spray schedules, or chemical treatment instructions. When growthGrounding IS present, cite source names ("according to Perenual", "per Trefle", or the web source title) when giving care advice, and prefer sources with authorityScore "high" (university extensions, botanical gardens, government agriculture pages). Distinguish structured database facts (Trefle, Perenual) from web-sourced guidance. If sources conflict, say so and prefer the higher-authority / more local source. Do NOT invent missing values. If plant identification confidence is low, warn that species-specific advice applies only if the plant is correctly identified. Do NOT diagnose disease.';
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

    // ---- Suggested follow-ups -------------------------------------------------
    const availableCards = groundingRow?.normalized_summary?.normalizedCare
      ? Object.keys(groundingRow.normalized_summary.normalizedCare).filter(
          (k) => !!groundingRow.normalized_summary.normalizedCare[k],
        )
      : [];

    // ---- Sources used ---------------------------------------------------------
    // Deterministically derive which grounding/provider sources back the answer
    // for the latest user question. Only sources that exist in the loaded
    // context are ever returned (never model-invented titles).
    const CARD_KEYWORDS: Record<string, RegExp> = {
      watering: /water|irrig|moist|drought|zaliv|voda|vlag|navodnj|suš|sus[ae]/i,
      sunlight: /sun|light|shade|expos|sunc|svetl|senk|osunč|osunc/i,
      soil: /soil|ph\b|compost|mulch|substrat|zemlj|tlo|supstrat|kompost|malč|malc/i,
      pruning: /prun|trim|cut back|train|shape|orez|rezidb|potkres|obliko/i,
      hardinessClimate: /cold|frost|winter|climate|zone|hardi|heat|mraz|zim|klim|temperatur|otporn/i,
      growthRateMaintenance: /growth rate|fast|slow|tall|size|maintenance|rast|brzin|visin|održav|odrzav/i,
      pestsDisease: /pest|disease|insect|fung|mold|rot|bolest|štetoč|stetoc|gljiv|insekt|trulež|trulez/i,
      fruitingHarvest: /fruit|harvest|yield|berry|bloom|flower|crop|plod|rod\b|berb|prinos|cvet|cvjet/i,
    };

    /** General care/growth intent (not tied to one specific card). */
    const GENERAL_CARE_RE =
      /\bcare\b|caring|\bgrow\b|growing|\bgrew\b|cultivat|\bneeds?\b|condition|requirement|maintain|look after|neg(a|u|o|uj|ova|ovanje)|rast|uzgoj|gajenje|uslov|zahtev|održav|odrzav/i;

    const isGeneralCareQuestion = (question: string): boolean =>
      GENERAL_CARE_RE.test(question);

    const detectCards = (question: string): string[] => {
      const hits = Object.keys(CARD_KEYWORDS).filter((k) => CARD_KEYWORDS[k].test(question));
      return hits.length > 0 ? hits : [];
    };

    const domainOf = (url: string | null | undefined): string | null => {
      if (!url) return null;
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
    };

    interface UsedSource {
      id: string;
      provider: string;
      title: string;
      url: string | null;
      domain: string | null;
      score: number | null;
      sourceType: string | null;
      authorityScore: string | null;
      cardKey: string | null;
      snippet: string;
    }

    const authorityWeight = (a?: string | null) =>
      a === 'high' ? 0.9 : a === 'medium' ? 0.7 : a === 'low' ? 0.5 : 0.6;

    /** Trefle species profile as a (non-URL) provider source. */
    const trefleSource = (): UsedSource | null => {
      if (!trefle) return null;
      return {
        id: 'provider-trefle-profile',
        provider: 'trefle',
        title: `Trefle — ${trefle.scientificName || trefle.commonName || pc.title}`,
        url: null,
        domain: 'trefle.io',
        score: 0.8,
        sourceType: 'plant_database',
        authorityScore: 'high',
        cardKey: null,
        snippet: [trefle.commonName, trefle.family, trefle.genus].filter(Boolean).join(' · '),
      };
    };

    /** Identification rows → provider sources, with GBIF/POWO reference URLs when present. */
    const identificationSources = (question: string): UsedSource[] => {
      const out: UsedSource[] = [];
      const mentions = (i: any) => {
        const name = (i.scientific_name_without_author || i.scientific_name || i.common_name || '').toLowerCase();
        return name.length > 3 && question.toLowerCase().includes(name.split(' ')[0]);
      };
      const rows: any[] = [];
      if (confirmedIdent) rows.push(confirmedIdent);
      // Alternatives are always useful context for Identify cases (comparison,
      // similar species). Questions that explicitly name an alternative pull it
      // to the front.
      const alternatives = identRows
        .filter((i) => !rows.includes(i))
        .sort((a, b) => (mentions(b) ? 1 : 0) - (mentions(a) ? 1 : 0));
      for (const i of alternatives) {
        rows.push(i);
        if (rows.length >= 5) break;
      }

      for (const i of rows) {
        const name = i.scientific_name_without_author || i.scientific_name || i.common_name;
        if (!name) continue;
        out.push({
          id: `identification-${i.id}`,
          provider: i.provider || 'plantnet',
          title: i.is_confirmed ? `${name} (confirmed)` : name,
          url: null,
          domain: null,
          score: typeof i.score === 'number' ? i.score : null,
          sourceType: i.is_confirmed ? 'confirmed_identification' : 'identification_candidate',
          authorityScore: null,
          cardKey: null,
          snippet: [i.common_name, i.family, i.genus].filter(Boolean).join(' · '),
        });
        if (i.gbif_id) {
          out.push({
            id: `identification-gbif-${i.id}`,
            provider: 'gbif',
            title: `GBIF — ${name}`,
            url: `https://www.gbif.org/species/${i.gbif_id}`,
            domain: 'gbif.org',
            score: 0.85,
            sourceType: 'taxonomy_reference',
            authorityScore: 'high',
            cardKey: null,
            snippet: '',
          });
        }
        if (i.powo_id) {
          const powo = String(i.powo_id).replace(/^urn:lsid:ipni\.org:names:/, '');
          out.push({
            id: `identification-powo-${i.id}`,
            provider: 'powo',
            title: `Plants of the World Online — ${name}`,
            url: `https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:${powo}`,
            domain: 'powo.science.kew.org',
            score: 0.85,
            sourceType: 'taxonomy_reference',
            authorityScore: 'high',
            cardKey: null,
            snippet: '',
          });
        }
      }
      return out;
    };

    /** Diagnosis candidates + AI interpretation provider context. */
    const diagnosisSources = (): UsedSource[] => {
      const out: UsedSource[] = [];
      if (confirmedDiag?.name) {
        out.push({
          id: `diagnosis-${confirmedDiag.id}`,
          provider: confirmedDiag.provider || 'plantnet',
          title: `${confirmedDiag.name} (confirmed)`,
          url: null,
          domain: null,
          score: typeof confirmedDiag.score === 'number' ? confirmedDiag.score : null,
          sourceType: 'confirmed_diagnosis',
          authorityScore: null,
          cardKey: null,
          snippet: typeof confirmedDiag.description === 'string' ? confirmedDiag.description.slice(0, 300) : '',
        });
      }
      // Provider candidates are diagnostic CONTEXT only — never treatment proof.
      const CANDIDATE_LABEL = lang === 'sr'
        ? 'Kandidat pružaoca (dijagnostički kontekst, nije dokaz o lečenju)'
        : 'Provider candidate (diagnosis context, not treatment proof)';
      for (const d of diagRows.slice(0, 4)) {
        if (!d?.name || d.is_confirmed) continue;
        const desc = typeof d.description === 'string' ? d.description.slice(0, 240) : '';
        out.push({
          id: `diagnosis-${d.id}`,
          provider: d.provider || 'plantnet',
          title: `${d.name} — ${CANDIDATE_LABEL}`,
          url: null,
          domain: null,
          score: typeof d.score === 'number' ? d.score : null,
          sourceType: 'diagnosis_candidate',
          authorityScore: null,
          cardKey: null,
          snippet: desc ? `${CANDIDATE_LABEL}. ${desc}` : CANDIDATE_LABEL,
        });
      }

      // AI interpretation is context that backed the answer — never treatment advice.
      if (interp?.summary) {
        out.push({
          id: `interpretation-${interp.id}`,
          provider: interp.provider || 'ai',
          title: `AI interpretation${interp.model ? ` (${interp.model})` : ''}`,
          url: null,
          domain: null,
          score: null,
          sourceType: 'ai_interpretation',
          authorityScore: null,
          cardKey: null,
          snippet: String(interp.summary).slice(0, 300),
        });
      }
      return out;
    };

    /** Improve Growth: grounding card groups + structured provider rows. */
    const growthSources = (question: string): UsedSource[] => {
      const out: UsedSource[] = [];
      const groups = groundingRow?.normalized_summary?.sourceGroups ?? null;
      if (groups) {
        const detected = detectCards(question);
        const ordered = [
          ...detected.filter((c) => Array.isArray(groups[c]) && groups[c].length > 0),
          ...(Array.isArray(groups.overview) ? ['overview'] : []),
          ...(detected.length === 0
            ? availableCards.filter((c) => Array.isArray(groups[c]) && groups[c].length > 0)
            : []),
        ];
        for (const cardKey of ordered) {
          const list = Array.isArray(groups[cardKey]) ? groups[cardKey] : [];
          for (const s of list.slice(0, 4)) {
            if (!s?.url && !s?.title) continue;
            out.push({
              id: `grounding-${cardKey}-${out.length}`,
              provider: s.provider || 'web',
              title: s.title || s.url,
              url: s.url ?? null,
              domain: domainOf(s.url),
              score: authorityWeight(s.authorityScore),
              sourceType: s.sourceType ?? null,
              authorityScore: s.authorityScore ?? null,
              cardKey,
              snippet: typeof s.summary === 'string' ? s.summary.slice(0, 300) : '',
            });
          }
          if (out.length >= 8) break;
        }
      }
      for (const s of (groundingRow?.sources ?? []) as any[]) {
        if (!s || s.provider === 'web') continue;
        out.push({
          id: `provider-${s.provider}-${out.length}`,
          provider: s.provider,
          title: s.title || s.provider,
          url: s.url ?? null,
          domain: domainOf(s.url),
          score: 0.8,
          sourceType: 'plant_database',
          authorityScore: 'high',
          cardKey: null,
          snippet: typeof s.summary === 'string' ? s.summary.slice(0, 300) : '',
        });
      }
      return out;
    };

    /**
     * Per-goal source collection. Only sources that exist in the loaded context
     * are ever returned (never model-invented titles); goals without any
     * source-backed data return an empty list.
     */
    const buildSourcesUsed = (question: string): UsedSource[] => {
      const goal = pc.user_goal ?? null;
      const collected: UsedSource[] = [];

      if (goal === 'improve_growth') {
        collected.push(...growthSources(question));
        const tp = trefleSource();
        if (tp) collected.push(tp);
      } else if (goal === 'identify') {
        collected.push(...identificationSources(question));
        // Identify cases may also reuse the shared growth guidance when the
        // user asks a care/growth question.
        if (groundingRow && (detectCards(question).length > 0 || isGeneralCareQuestion(question))) {
          collected.push(...growthSources(question));
        }
        const tp = trefleSource();
        if (tp) collected.push(tp);
      } else if (goal === 'diagnose') {
        // Confirmed plant context first, then problem candidates.
        if (confirmedIdent) collected.push(...identificationSources(question).slice(0, 3));
        collected.push(...diagnosisSources());
        const tp = trefleSource();
        if (tp) collected.push(tp);
      } else if (goal === 'increase_income') {
        // No dedicated income grounding yet — surface only real context sources.
        if (confirmedIdent) collected.push(...identificationSources(question).slice(0, 1));
        const tp = trefleSource();
        if (tp) collected.push(tp);
      } else {
        if (confirmedIdent) collected.push(...identificationSources(question).slice(0, 2));
        const tp = trefleSource();
        if (tp) collected.push(tp);
      }

      const seen = new Set<string>();
      const out: UsedSource[] = [];
      for (const s of collected) {
        if (!s || (!s.url && !s.title)) continue;
        const key = s.url || `${s.provider}:${s.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
        if (out.length >= 10) break;
      }
      return out;
    };



    // Deterministic per-goal fallbacks used when the model returns nothing.
    const FALLBACK_FOLLOW_UPS: Record<string, Record<'en' | 'sr', string[]>> = {
      identify: {
        en: [
          'Which features confirm this plant?',
          'How is it different from the top alternative?',
          'What photos should I add?',
          'Could this be a similar species?',
        ],
        sr: [
          'Koje osobine potvrđuju ovu biljku?',
          'Po čemu se razlikuje od najbliže alternative?',
          'Koje fotografije treba da dodam?',
          'Da li ovo može biti slična vrsta?',
        ],
      },
      diagnose: {
        en: [
          'What symptoms should I check next?',
          'Which candidate is most likely?',
          'Could this be pest damage or stress?',
          'What photos would improve diagnosis?',
        ],
        sr: [
          'Koje simptome sledeće da proverim?',
          'Koji kandidat je najverovatniji?',
          'Da li ovo može biti štetočina ili stres?',
          'Koje fotografije bi poboljšale dijagnozu?',
        ],
      },
    };

    const generateFollowUps = async (
      lastUserQuestion: string,
      assistantAnswer: string,
    ): Promise<string[]> => {
      const langLine = lang === 'sr' ? 'Serbian (Latin script)' : 'English';
      const goalLine = (() => {
        switch (pc.user_goal) {
          case 'improve_growth':
            return `This is an Improve Growth case. Prefer follow-ups tied to these care areas: ${
              availableCards.length
                ? availableCards.join(', ')
                : 'watering, sunlight, soil, pruning, hardiness/climate, growth rate/maintenance, pests and disease, fruiting/harvest, local conditions'
            }.`;
          case 'identify':
            return 'This is an Identify case. Focus follow-ups on confirming the identification (which features confirm it), comparing the top alternatives / similar species, taxonomy, habitat, and requesting better or additional photos. NEVER suggest questions about disease, pests, or treatment.';
          case 'diagnose':
            return 'This is a Diagnose case. Focus follow-ups on symptoms to check next, which candidate is most likely, remaining uncertainty, pest vs disease vs stress, which next photos would help, prevention/sanitation, and safe next steps (including when to seek local expert help). NEVER suggest treatment products or chemical steps.';
          default:
            return '';
        }
      })();

      const prompt = `Based on the conversation below, propose up to 4 short follow-up questions the USER could ask next.

Rules:
- Write them in ${langLine}.
- Each is a single short question (max ~12 words), actionable and natural to ask next.
- Do NOT repeat or rephrase the user's last question.
- Must stay within the case goal: ${pc.user_goal ?? 'unspecified'}.
- NEVER suggest questions about pesticide/fungicide/herbicide/fertilizer product names, doses, mixing rates, spray schedules, or chemical treatments.
- ${goalLine}
- Return ONLY a JSON array of strings, nothing else.

USER'S LAST QUESTION:
${lastUserQuestion || '(none)'}

ASSISTANT ANSWER:
${assistantAnswer.slice(0, 4000)}`;

      const fallback = (): string[] => {
        const byGoal = FALLBACK_FOLLOW_UPS[pc.user_goal ?? ''];
        return byGoal ? byGoal[lang].slice(0, 4) : [];
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: normalizeModelId(Deno.env.get('PLANT_CHAT_AI_PRIMARY_MODEL') ?? 'gemini-3.5-flash'),
            messages: [
              { role: 'system', content: 'You generate short follow-up question suggestions. Output strict JSON only.' },
              { role: 'user', content: prompt },
            ],
          }),
        });
        if (!resp.ok) return fallback();
        const b = await resp.json().catch(() => null);
        const raw = b?.choices?.[0]?.message?.content;
        if (typeof raw !== 'string') return fallback();
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) return fallback();
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) return fallback();
        const cleaned = parsed
          .filter((s: unknown) => typeof s === 'string' && s.trim().length > 0)
          .map((s: string) => s.trim())
          .filter((s: string) => !/pesticid|fungicid|herbicid|insekticid|pesticide|fungicide|herbicide|insecticide|fertiliz|đubriv|dubriv|dose|doza|spray|prskan/i.test(s))
          .slice(0, 4);
        return cleaned.length > 0 ? cleaned : fallback();
      } catch {
        return fallback();
      } finally {
        clearTimeout(timeout);
      }
    };


    if (followUpsOnly) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const lastUserQ = [...messages].reverse().find((m) => m.role === 'user');
      const suggestedFollowUps = lastAssistant
        ? await generateFollowUps(lastUserQ?.content ?? '', lastAssistant.content)
        : [];
      return json({ ok: true, suggestedFollowUps });
    }

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

    // Persist the latest user message + assistant reply to plant_case_chat_messages.
    // Only the last user message is saved (prior turns were saved on their own request).
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userGoal = pc.user_goal ?? null;
    const sourcesUsed = buildSourcesUsed(lastUser?.content ?? '');
    const savedIds: { userMessageId?: string; assistantMessageId?: string } = {};

    try {
      if (lastUser) {
        const { data: userRow, error: userInsErr } = await admin
          .from('plant_case_chat_messages')
          .insert({
            user_id: userId,
            case_id: caseId,
            role: 'user',
            content: lastUser.content,
            metadata: { goal: userGoal },
          })
          .select('id')
          .single();
        if (userInsErr) {
          console.error('[plant-case-chat] persist user message failed', userInsErr.message);
        } else {
          savedIds.userMessageId = userRow?.id;
        }
      }
      const { data: asstRow, error: asstInsErr } = await admin
        .from('plant_case_chat_messages')
        .insert({
          user_id: userId,
          case_id: caseId,
          role: 'assistant',
          content: result.text!,
          metadata: {
            goal: userGoal,
            groundingId: groundingRow?.id ?? null,
            model: modelUsed,
            usedFallback,
            usedGrowthGrounding: !!groundingRow,
            sourcesUsed,
          },
        })

        .select('id')
        .single();
      if (asstInsErr) {
        console.error('[plant-case-chat] persist assistant message failed', asstInsErr.message);
      } else {
        savedIds.assistantMessageId = asstRow?.id;
      }
    } catch (persistErr) {
      console.error('[plant-case-chat] persist messages threw', (persistErr as Error).message);
    }

    const suggestedFollowUps = await generateFollowUps(lastUser?.content ?? '', result.text!);

    return json({
      ok: true,
      reply: result.text,
      suggestedFollowUps,
      sourcesUsed,

      modelUsed,
      usedFallback,
      ...savedIds,
    });

  } catch (e) {
    console.error('[plant-case-chat] fatal', (e as Error).message);
    return json({ error: 'internal_error' }, 500);
  }
});
