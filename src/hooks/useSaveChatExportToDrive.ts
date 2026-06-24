import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import {
  buildChatMarkdownBlob,
  buildChatPdfBlob,
  buildExportFilename,
  blobToBase64,
  type BuildExportArgs,
} from '@/lib/chatExport';

export interface DriveExportResult {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  webContentLink?: string | null;
}

export interface SaveToDriveArgs extends BuildExportArgs {
  format: 'markdown' | 'pdf';
  contextId: string;
  chatId?: string | null;
}

export function useSaveChatExportToDrive() {
  const { t } = useTranslation();
  const [savingMd, setSavingMd] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);

  const friendlyError = (code: string | undefined, fallback: string): string => {
    switch (code) {
      case 'google_drive_not_connected':
        return t(
          'chatExport.driveNotConnected',
          'Google Drive is not connected for this project.',
        );
      case 'google_drive_write_scope_missing':
        return t(
          'chatExport.driveWriteScopeMissing',
          'Google Drive write access is not connected.',
        );
      case 'forbidden':
        return t('chatExport.driveForbidden', 'You do not have access to this chat.');
      case 'file_too_large':
        return t(
          'chatExport.driveTooLarge',
          'Export is too large to save to Drive.',
        );
      case 'invalid_input':
        return t('chatExport.driveInvalid', 'Invalid export request.');
      case 'unauthorized':
        return t('chatExport.driveUnauthorized', 'You must be signed in.');
      default:
        return fallback;
    }
  };

  async function save(args: SaveToDriveArgs): Promise<DriveExportResult> {
    const isMd = args.format === 'markdown';
    if (isMd) setSavingMd(true);
    else setSavingPdf(true);
    try {
      const blob = isMd
        ? buildChatMarkdownBlob(args)
        : await buildChatPdfBlob(args);
      const filename = buildExportFilename({
        contextType: args.contextType,
        contextName: args.contextName,
        extension: isMd ? 'md' : 'pdf',
      });
      const contentBase64 = await blobToBase64(blob);
      const mimeType = isMd ? 'text/markdown' : 'application/pdf';

      const { data, error } = await supabase.functions.invoke('gdrive-export-chat', {
        body: {
          format: args.format,
          filename,
          mimeType,
          contentBase64,
          contextType: args.contextType,
          contextId: args.contextId,
          chatId: args.chatId ?? null,
          metadata: {
            contextName: args.contextName,
            chatTitle: args.chatTitle,
            exportedAt: new Date().toISOString(),
          },
        },
      });

      if (error) {
        // FunctionsHttpError: try to extract structured payload.
        const ctx: any = (error as any).context;
        let payload: any = null;
        try {
          if (ctx && typeof ctx.json === 'function') payload = await ctx.json();
        } catch { /* ignore */ }
        const code = payload?.error;
        const msg = friendlyError(
          code,
          payload?.message ||
            error.message ||
            t('chatExport.driveFailed', 'Could not save to Google Drive.'),
        );
        const e = new Error(msg);
        (e as any).code = code;
        throw e;
      }
      return data as DriveExportResult;
    } finally {
      if (isMd) setSavingMd(false);
      else setSavingPdf(false);
    }
  }

  return { save, savingMd, savingPdf };
}
