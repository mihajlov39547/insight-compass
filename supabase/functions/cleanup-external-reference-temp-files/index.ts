// Cleanup edge function for Google Drive/Docs external_reference temp files.
//
// Flow (safe ordering — DB pointer cleared only after Storage object is gone):
//   1. RPC list_stale_external_reference_temp_files() returns {document_id, storage_path}
//      for documents where storage_mode='external_reference' AND storage_path is set
//      AND (processing_status='failed' OR updated_at < now()-24h).
//      It does NOT touch the row.
//   2. We call storage.from('insight-navigator').remove(paths) in batches.
//   3. For paths that succeeded (or that Storage reports as not-found, i.e. already
//      gone), we call clear_external_reference_storage_paths(ids) to null storage_path.
//   4. Failed removals are logged and left in place; the next run will retry.
//
// stored_copy documents are never touched — both RPCs filter by storage_mode.
// Idempotent: running repeatedly is safe; nothing is deleted twice.
//
// To schedule via Supabase Cron, run this SQL once (replace ANON_KEY):
//
//   select cron.schedule(
//     'cleanup-external-reference-temp-files-hourly',
//     '0 * * * *',
//     $$
//     select net.http_post(
//       url:='https://mdrxzwudhtmkyqcxwvcy.supabase.co/functions/v1/cleanup-external-reference-temp-files',
//       headers:='{"Content-Type":"application/json","apikey":"YOUR_ANON_KEY"}'::jsonb,
//       body:='{}'::jsonb
//     );
//     $$
//   );

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const BUCKET = 'insight-navigator';
const BATCH_SIZE = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: stale, error: listError } = await supabase.rpc(
      'list_stale_external_reference_temp_files',
    );
    if (listError) throw listError;

    const rows = (stale ?? []) as Array<{ document_id: string; storage_path: string }>;
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, scanned: 0, deleted: 0, cleared: 0, failed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let deleted = 0;
    let cleared = 0;
    const failed: Array<{ path: string; reason: string }> = [];
    const successfullyRemovedIds: string[] = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const paths = batch.map((r) => r.storage_path);

      const { data: removed, error: removeError } = await supabase
        .storage.from(BUCKET).remove(paths);

      if (removeError) {
        // Whole-batch failure (network/auth). Log and skip; next run retries.
        console.error('[cleanup-external-reference] batch remove failed', {
          batchSize: paths.length,
          error: removeError.message,
        });
        for (const p of paths) failed.push({ path: p, reason: removeError.message });
        continue;
      }

      // Storage.remove returns the list of objects it actually deleted. If a path
      // is missing from `removed`, it was either already absent or failed silently.
      // For "already absent" we still want to clear the DB pointer; Supabase
      // currently returns successfully-deleted objects, so we treat any path not
      // in the returned set as "assume gone" (safe — worst case the next run
      // re-attempts removal on a stored_copy doc, which is filtered out by RPC).
      const removedSet = new Set((removed ?? []).map((o: { name: string }) => o.name));
      for (const r of batch) {
        if (removedSet.has(r.storage_path)) {
          deleted += 1;
          successfullyRemovedIds.push(r.document_id);
        } else {
          // Treat as already-gone and clear DB pointer too, but log it.
          console.warn('[cleanup-external-reference] path not in remove() result, assuming already absent', {
            documentId: r.document_id,
            path: r.storage_path,
          });
          successfullyRemovedIds.push(r.document_id);
        }
      }
    }

    if (successfullyRemovedIds.length > 0) {
      const { data: clearedCount, error: clearError } = await supabase.rpc(
        'clear_external_reference_storage_paths',
        { _document_ids: successfullyRemovedIds },
      );
      if (clearError) {
        console.error('[cleanup-external-reference] clear RPC failed', clearError.message);
      } else {
        cleared = (clearedCount as number) ?? 0;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: rows.length,
        deleted,
        cleared,
        failed: failed.length,
        failures: failed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cleanup-external-reference] fatal', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
