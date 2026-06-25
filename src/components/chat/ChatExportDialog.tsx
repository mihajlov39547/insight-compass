import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Download, FileDown, Loader2, Cloud, ExternalLink, FileText } from 'lucide-react';
import {
  buildChatMarkdownExport,
  buildExportFilename,
  downloadMarkdown,
  downloadChatPdf,
  type ChatExportOptions,
  type ChatMessageLike,
} from '@/lib/chatExport';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { useSaveChatExportToDrive } from '@/hooks/useSaveChatExportToDrive';
import { useCreateChatExportGoogleDoc } from '@/hooks/useCreateChatExportGoogleDoc';
import { ToastAction } from '@/components/ui/toast';

const APP_NAME = 'Researcher';

interface ChatExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextType: 'project' | 'notebook';
  contextId?: string;
  contextName: string;
  chatId?: string | null;
  chatTitle?: string;
  exportedByLabel?: string;
  messages: ChatMessageLike[];
  pinnedMessageIds?: string[];
}

export function ChatExportDialog({
  open,
  onOpenChange,
  contextType,
  contextId,
  contextName,
  chatId,
  chatTitle,
  exportedByLabel,
  messages,
  pinnedMessageIds,
}: ChatExportDialogProps) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ChatExportOptions>({
    format: 'markdown',
    includeSources: true,
    includeSourceSnippets: true,
    includeTechnicalIds: false,
    includeRetrievalTraces: true,
    includeFullCitationExcerpts: false,
    includePinnedSummary: (pinnedMessageIds?.length ?? 0) > 0,
  });

  const baseArgs = {
    appName: APP_NAME,
    contextType,
    contextName,
    chatTitle,
    exportedByLabel,
    messages,
    options: opts,
    pinnedMessageIds,
  };

  const [pdfLoading, setPdfLoading] = useState(false);
  const { toast } = useToast();
  const { save: saveToDrive, savingMd: driveSavingMd, savingPdf: driveSavingPdf } =
    useSaveChatExportToDrive();
  const { create: createGoogleDoc, loading: creatingDoc } = useCreateChatExportGoogleDoc();
  const driveAvailable = !!contextId;

  const handleMarkdown = () => {
    const md = buildChatMarkdownExport(baseArgs);
    const filename = buildExportFilename({ contextType, contextName, extension: 'md' });
    downloadMarkdown(filename, md);
    onOpenChange(false);
  };

  const handlePdf = async () => {
    setPdfLoading(true);
    try {
      await downloadChatPdf(baseArgs);
      onOpenChange(false);
    } catch (err) {
      console.error('PDF export failed', err);
      toast({
        title: t('chatExport.pdfErrorTitle', 'Could not generate PDF'),
        description: t('chatExport.pdfErrorDesc', 'Please try Markdown export instead.'),
        variant: 'destructive',
      });
    } finally {
      setPdfLoading(false);
    }
  };

  const handleSaveDrive = async (format: 'markdown' | 'pdf') => {
    if (!contextId) return;
    try {
      const res = await saveToDrive({
        ...baseArgs,
        format,
        contextId,
        chatId: chatId ?? null,
      });
      const action = res.webViewLink
        ? (
            <ToastAction
              altText={t('chatExport.openInDrive', 'Open in Drive')}
              onClick={() => window.open(res.webViewLink!, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              {t('chatExport.openInDrive', 'Open in Drive')}
            </ToastAction>
          )
        : undefined;
      toast({
        title: t('chatExport.driveSaved', 'Saved to Google Drive'),
        description: res.name,
        action,
      });
    } catch (err: any) {
      console.error('Drive export failed', err);
      toast({
        title: t('chatExport.driveErrorTitle', 'Could not save to Google Drive'),
        description: err?.message ?? t('chatExport.driveFailed', 'Could not save to Google Drive.'),
        variant: 'destructive',
      });
    }
  };

  const Toggle = ({ id, label, hint, value, set }: { id: string; label: string; hint?: string; value: boolean; set: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex-1">
        <Label htmlFor={id} className="text-sm cursor-pointer">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch id={id} checked={value} onCheckedChange={set} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('chatExport.title', 'Export conversation')}</DialogTitle>
          <DialogDescription>
            {t('chatExport.description', 'Download this conversation as Markdown or PDF.')}
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border/60">
          <Toggle id="opt-sources" label={t('chatExport.includeSources', 'Include sources')} value={opts.includeSources} set={v => setOpts(o => ({ ...o, includeSources: v }))} />
          <Toggle id="opt-snippets" label={t('chatExport.includeSnippets', 'Include source snippets')} value={opts.includeSourceSnippets} set={v => setOpts(o => ({ ...o, includeSourceSnippets: v }))} />
          <Toggle id="opt-traces" label={t('chatExport.includeTraces', 'Include retrieval traces')} hint={t('chatExport.includeTracesHint', 'Web/YouTube/crawl provider, query, counts.')} value={opts.includeRetrievalTraces} set={v => setOpts(o => ({ ...o, includeRetrievalTraces: v }))} />
          <Toggle id="opt-full" label={t('chatExport.includeFull', 'Full citation excerpts')} hint={t('chatExport.includeFullHint', 'Off by default to keep the export compact.')} value={opts.includeFullCitationExcerpts} set={v => setOpts(o => ({ ...o, includeFullCitationExcerpts: v }))} />
          <Toggle id="opt-ids" label={t('chatExport.includeIds', 'Include technical IDs')} value={opts.includeTechnicalIds} set={v => setOpts(o => ({ ...o, includeTechnicalIds: v }))} />
          {(pinnedMessageIds?.length ?? 0) > 0 && (
            <Toggle id="opt-pins" label={t('chatExport.includePinned', 'Include pinned messages summary')} value={!!opts.includePinnedSummary} set={v => setOpts(o => ({ ...o, includePinnedSummary: v }))} />
          )}
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {t('chatExport.localDownload', 'Local download')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleMarkdown} className="gap-1.5">
                <Download className="h-4 w-4" />
                {t('chatExport.exportMd', 'Export Markdown')}
              </Button>
              <Button onClick={handlePdf} disabled={pdfLoading} className="gap-1.5">
                {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {pdfLoading ? t('chatExport.generatingPdf', 'Generating PDF…') : t('chatExport.exportPdf', 'Download PDF')}
              </Button>
            </div>
          </div>

          {driveAvailable && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                {t('chatExport.googleDrive', 'Google Drive')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={driveSavingMd}
                  onClick={() => handleSaveDrive('markdown')}
                >
                  {driveSavingMd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                  {driveSavingMd
                    ? t('chatExport.savingToDrive', 'Saving to Drive…')
                    : t('chatExport.saveMdToDrive', 'Save Markdown to Drive')}
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={driveSavingPdf}
                  onClick={() => handleSaveDrive('pdf')}
                >
                  {driveSavingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                  {driveSavingPdf
                    ? t('chatExport.savingToDrive', 'Saving to Drive…')
                    : t('chatExport.savePdfToDrive', 'Save PDF to Drive')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
