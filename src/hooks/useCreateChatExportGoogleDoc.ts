import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import {
  buildChatMarkdownExport,
  type BuildExportArgs,
} from '@/lib/chatExport';
import { buildChatGoogleDocModel } from '@/lib/chatExportGoogleDoc';

export interface CreateGoogleDocArgs extends BuildExportArgs {
  contextId: string;
  chatId?: string | null;
}

export interface CreateGoogleDocResult {
  documentId: string;
  title: string;
  webViewLink: string | null;
  warning?: 'formatting_partial';
}

function formatDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sanitizeForTitle(s: string): string {
  return (s || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildChatDocTitle(args: {
  appName: string;
  contextType: 'project' | 'notebook';
  contextName: string;
}): string {
  const kind = args.contextType === 'project' ? 'Project Chat' : 'Notebook Chat';
  const name = sanitizeForTitle(args.contextName) || 'Untitled';
  const date = formatDate();
  return `${args.appName} ${kind} - ${name} - ${date}`.slice(0, 200);
}

export function useCreateChatExportGoogleDoc() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const friendlyError = (code: string | undefined, fallback: string): string => {
    switch (code) {
      case 'google_docs_not_connected':
        return t('chatExport.docsNotConnected', 'Google Docs is not connected for this project.');
      case 'google_docs_write_scope_missing':
        return t(
          'chatExport.docsWriteScopeMissing',
          'Google Docs write access is not connected. Reconnect with document create/edit scope.',
        );
      case 'google_docs_rejected_update':
        return t(
          'chatExport.docsRejectedUpdate',
          'Google Docs rejected the transcript insert. Try a shorter export or Markdown/PDF.',
        );
      case 'forbidden':
        return t('chatExport.driveForbidden', 'You do not have access to this chat.');
      case 'file_too_large':
        return t(
          'chatExport.docsTooLarge',
          'This chat is too large to create as a Google Doc.',
        );
      case 'invalid_input':
        return t('chatExport.driveInvalid', 'Invalid export request.');
      case 'unauthorized':
        return t('chatExport.driveUnauthorized', 'You must be signed in.');
      default:
        return fallback;
    }
  };

  async function create(args: CreateGoogleDocArgs): Promise<CreateGoogleDocResult> {
    setLoading(true);
    try {
      const transcript = buildChatMarkdownExport(args);
      const docModel = buildChatGoogleDocModel(args);
      const title = buildChatDocTitle({
        appName: args.appName,
        contextType: args.contextType,
        contextName: args.contextName,
      });

      const { data, error } = await supabase.functions.invoke('gdocs-export-chat', {
        body: {
          contextType: args.contextType,
          contextId: args.contextId,
          chatId: args.chatId ?? null,
          title,
          transcript, // fallback for backward compatibility
          docModel,
        },
      });

      if (error) {
        const ctx: any = (error as any).context;
        let payload: any = null;
        try {
          if (ctx && typeof ctx.json === 'function') payload = await ctx.json();
        } catch { /* ignore */ }
        const code = payload?.error;
        if (payload?.detail) {
          console.warn('[gdocs-export-chat] upstream detail:', payload.detail);
        }
        const msg = friendlyError(
          code,
          payload?.message ||
            error.message ||
            t('chatExport.docsFailed', 'Could not create Google Doc.'),
        );
        const e = new Error(msg);
        (e as any).code = code;
        throw e;
      }
      return data as CreateGoogleDocResult;
    } finally {
      setLoading(false);
    }
  }

  return { create, loading };
}
