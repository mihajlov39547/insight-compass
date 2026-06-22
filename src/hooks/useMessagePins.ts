import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';

export type PinContext =
  | { type: 'project'; projectId: string; chatId?: string | null }
  | { type: 'notebook'; notebookId: string; chatId?: string | null };

export interface PinnedMessage {
  id: string;
  user_id: string;
  message_id: string;
  chat_id: string | null;
  project_id: string | null;
  notebook_id: string | null;
  message_role: string;
  message_snippet: string;
  message_content_snapshot: string | null;
  pinned_at: string;
  metadata: Record<string, unknown>;
}

const SNIPPET_MAX = 180;
const SNAPSHOT_MAX = 8000;

function buildSnippet(content: string): string {
  const trimmed = (content || '').trim().replace(/\s+/g, ' ');
  if (trimmed.length <= SNIPPET_MAX) return trimmed;
  return trimmed.slice(0, SNIPPET_MAX - 1) + '…';
}

function pinsKey(userId: string | undefined, ctx: PinContext) {
  if (ctx.type === 'project') {
    return ['message-pins', 'project', userId ?? null, ctx.projectId, ctx.chatId ?? null];
  }
  return ['message-pins', 'notebook', userId ?? null, ctx.notebookId, ctx.chatId ?? null];
}

export function usePinnedMessages(ctx: PinContext | null) {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user && !!ctx,
    queryKey: ctx ? pinsKey(user?.id, ctx) : ['message-pins', 'disabled'],
    queryFn: async (): Promise<PinnedMessage[]> => {
      if (!ctx) return [];
      let q = supabase
        .from('chat_message_pins')
        .select('*')
        .order('pinned_at', { ascending: false });
      if (ctx.type === 'project') {
        q = q.eq('project_id', ctx.projectId);
        if (ctx.chatId) q = q.eq('chat_id', ctx.chatId);
      } else {
        q = q.eq('notebook_id', ctx.notebookId);
        if (ctx.chatId) q = q.eq('chat_id', ctx.chatId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PinnedMessage[];
    },
  });
}

export interface ToggleArgs {
  ctx: PinContext;
  messageId: string;
  messageRole: string;
  content: string;
  isCurrentlyPinned: boolean;
  pinId?: string | null;
}

export function useToggleMessagePin() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: ToggleArgs) => {
      if (!user) throw new Error('Not authenticated');

      if (args.isCurrentlyPinned) {
        const { error } = await supabase
          .from('chat_message_pins')
          .delete()
          .eq('user_id', user.id)
          .eq('message_id', args.messageId);
        if (error) throw error;
        return { unpinned: true };
      }

      const snippet = buildSnippet(args.content);
      const snapshot = (args.content || '').slice(0, SNAPSHOT_MAX);

      const row = {
        user_id: user.id,
        message_id: args.messageId,
        message_role: args.messageRole,
        message_snippet: snippet,
        message_content_snapshot: snapshot,
        chat_id: args.ctx.chatId ?? null,
        project_id: args.ctx.type === 'project' ? args.ctx.projectId : null,
        notebook_id: args.ctx.type === 'notebook' ? args.ctx.notebookId : null,
      };

      const { error } = await supabase.from('chat_message_pins').insert(row);
      if (error) throw error;
      return { pinned: true };
    },
    onMutate: async (args) => {
      const key = pinsKey(user?.id, args.ctx);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PinnedMessage[]>(key) || [];

      if (args.isCurrentlyPinned) {
        qc.setQueryData<PinnedMessage[]>(key, previous.filter(p => p.message_id !== args.messageId));
      } else if (user) {
        const optimistic: PinnedMessage = {
          id: `optimistic-${args.messageId}`,
          user_id: user.id,
          message_id: args.messageId,
          chat_id: args.ctx.chatId ?? null,
          project_id: args.ctx.type === 'project' ? args.ctx.projectId : null,
          notebook_id: args.ctx.type === 'notebook' ? args.ctx.notebookId : null,
          message_role: args.messageRole,
          message_snippet: buildSnippet(args.content),
          message_content_snapshot: (args.content || '').slice(0, SNAPSHOT_MAX),
          pinned_at: new Date().toISOString(),
          metadata: {},
        };
        qc.setQueryData<PinnedMessage[]>(key, [optimistic, ...previous]);
      }

      return { previous, key };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.key && ctx.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: (_data, _err, args) => {
      qc.invalidateQueries({ queryKey: pinsKey(user?.id, args.ctx) });
    },
  });
}

export function useUnpinMessage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pinId }: { pinId: string; ctx: PinContext }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('chat_message_pins')
        .delete()
        .eq('id', pinId)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onMutate: async ({ pinId, ctx }) => {
      const key = pinsKey(user?.id, ctx);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PinnedMessage[]>(key) || [];
      qc.setQueryData<PinnedMessage[]>(key, previous.filter(p => p.id !== pinId));
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.key && ctx.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: pinsKey(user?.id, vars.ctx) });
    },
  });
}

/**
 * Build a Map<messageId, pinId> once per workspace render so chat
 * messages don't each subscribe to their own pin query.
 */
export function buildPinnedByMessageId(pins: PinnedMessage[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!pins) return map;
  for (const p of pins) map.set(p.message_id, p.id);
  return map;
}

export function useIsMessagePinned(ctx: PinContext | null, messageId: string | undefined) {
  const { data } = usePinnedMessages(ctx);
  if (!messageId || !data) return { pinned: false, pinId: null as string | null };
  const found = data.find(p => p.message_id === messageId);
  return { pinned: !!found, pinId: found?.id ?? null };
}
