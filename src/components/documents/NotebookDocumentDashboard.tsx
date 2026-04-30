import React, { useState, useMemo } from 'react';
import {
  FileText, FileType, FileSpreadsheet, File as FileIcon, Upload, Trash2,
  RotateCcw, ChevronDown, ChevronRight, Search, ArrowUpDown, Filter,
  BookOpenCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useApp } from '@/contexts/useApp';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useNotebookDocuments } from '@/hooks/useNotebookDocuments';
import { useDeleteDocument, useRetryProcessing, DbDocument } from '@/hooks/useDocuments';
import { useResources } from '@/hooks/useResources';
import { useDeleteResource, useRetryYouTubeTranscriptIngestion, type ResourceActionInput } from '@/hooks/useResourceActions';
import type { Resource } from '@/lib/resourceClassification';
import { UploadDocumentsDialog } from '@/components/dialogs/UploadDocumentsDialog';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { DocumentUsability } from './DocumentUsability';
import { DocumentProcessingOverview } from './DocumentProcessingOverview';
import { useDocumentProcessingStatus, deriveDocumentStatusPresentation } from '@/hooks/useDocumentProcessingStatus';
import { AIReadyBadge } from './AIReadyBadge';
import { useDocumentChunkStats } from '@/hooks/useDocumentChunkStats';
import { useDocumentQuestionStats } from '@/hooks/useDocumentQuestionStats';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { LinkedVideoRow } from './LinkedVideoRow';
import { useTranslation } from 'react-i18next';
import { DeleteWithConfirmDialog } from '@/components/dialogs/DeleteWithConfirmDialog';

const fileIcons: Record<string, any> = {
  pdf: FileText, docx: FileType, doc: FileType, txt: FileIcon,
  xlsx: FileSpreadsheet, xls: FileSpreadsheet, csv: FileSpreadsheet,
  md: FileText, rtf: FileType,
};

const fileColors: Record<string, string> = {
  pdf: 'text-red-500', docx: 'text-blue-500', doc: 'text-blue-500',
  txt: 'text-muted-foreground', xlsx: 'text-green-500', xls: 'text-green-500',
  csv: 'text-green-500', md: 'text-violet-500', rtf: 'text-orange-500',
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function truncateFileName(name: string, maxBase = 30): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) return name.length > maxBase ? name.slice(0, maxBase) + '…' : name;
  const base = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex);
  if (base.length <= maxBase) return name;
  return base.slice(0, maxBase) + '…' + ext;
}

type FilterStatus = 'all' | 'processing' | 'searchable' | 'failed';
type SortKey = 'recent' | 'oldest' | 'name' | 'status';

export function NotebookDocumentDashboard() {
  const { t } = useTranslation();
  const { selectedNotebookId, setActiveView } = useApp();
  const { data: notebooks = [] } = useNotebooks();
  const notebook = notebooks.find(n => n.id === selectedNotebookId);

  const { data: documents = [], isLoading } = useNotebookDocuments(selectedNotebookId ?? undefined);
  const { data: resources = [], isLoading: isResourcesLoading } = useResources();

  const deleteMutation = useDeleteDocument();
  const deleteResourceMutation = useDeleteResource();
  const { retry: retryProcessing, isPending: isRetrying } = useRetryProcessing();
  const retryTranscriptMutation = useRetryYouTubeTranscriptIngestion();
  const [showUpload, setShowUpload] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [search, setSearch] = useState('');

  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<DbDocument | null>(null);
  const [pendingDeleteResource, setPendingDeleteResource] = useState<Resource | null>(null);

  const handleDelete = (doc: DbDocument) => {
    setPendingDeleteDoc(doc);
  };

  const confirmDeleteDoc = () => {
    if (!pendingDeleteDoc) return;
    const doc = pendingDeleteDoc;
    deleteMutation.mutate(doc, {
      onSuccess: () => { toast({ title: t('documentDashboard.deleted', { name: doc.file_name }) }); setPendingDeleteDoc(null); },
      onError: (err: any) => { toast({ title: t('documentDashboard.deleteFailed'), description: err.message, variant: 'destructive' }); setPendingDeleteDoc(null); },
    });
  };

  const toResourceActionInput = (resource: Resource): ResourceActionInput => ({
    id: resource.id,
    title: resource.title,
    storagePath: resource.storagePath,
    ownerUserId: resource.ownerUserId,
    containerType: resource.containerType,
    containerId: resource.containerId,
    processingStatus: resource.processingStatus,
    resourceKind: resource.resourceKind,
  });

  const handleDeleteResource = (resource: Resource) => {
    setPendingDeleteResource(resource);
  };

  const confirmDeleteResource = () => {
    if (!pendingDeleteResource) return;
    const resource = pendingDeleteResource;
    deleteResourceMutation.mutate(toResourceActionInput(resource), {
      onSuccess: () => { toast({ title: t('documentDashboard.deleted', { name: resource.title }) }); setPendingDeleteResource(null); },
      onError: (err: any) => { toast({ title: t('documentDashboard.deleteFailed'), description: err.message, variant: 'destructive' }); setPendingDeleteResource(null); },
    });
  };

  const handleRetryTranscript = (resource: Resource) => {
    if (resource.provider !== 'youtube') return;
    retryTranscriptMutation.mutate(toResourceActionInput(resource), {
      onSuccess: () => toast({ title: t('documentDashboard.transcriptRetried'), description: t('documentDashboard.transcriptRetriedDesc') }),
      onError: (err: any) => toast({ title: t('documentDashboard.transcriptRetryFailed'), description: err.message, variant: 'destructive' }),
    });
  };

  const documentIds = documents.map(d => d.id);
  const { data: chunkStatsMap } = useDocumentChunkStats(documentIds);
  const { data: questionStatsMap } = useDocumentQuestionStats(documentIds);

  const notebookLinkedVideos = resources.filter((r) =>
    r.provider === 'youtube'
    && r.sourceType === 'linked'
    && !!selectedNotebookId
    && r.notebookId === selectedNotebookId
  );

  const totalCount = documents.length + notebookLinkedVideos.length;
  const searchableCount = documents.filter(d => d.processing_status === 'completed').length
    + notebookLinkedVideos.filter((r) => r.transcriptStatus === 'ready').length;
  const processingCount = documents.filter(d => !['completed', 'failed'].includes(d.processing_status)).length
    + notebookLinkedVideos.filter((r) => ['queued', 'running'].includes(r.transcriptStatus || '')).length;
  const failedCount = documents.filter(d => d.processing_status === 'failed').length
    + notebookLinkedVideos.filter((r) => r.transcriptStatus === 'failed').length;

  const filtered = useMemo(() => {
    let list = [...documents];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d => d.file_name.toLowerCase().includes(q));
    }
    if (filter === 'searchable') list = list.filter(d => d.processing_status === 'completed');
    else if (filter === 'processing') list = list.filter(d => !['completed', 'failed'].includes(d.processing_status));
    else if (filter === 'failed') list = list.filter(d => d.processing_status === 'failed');

    switch (sort) {
      case 'oldest': return list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'name': return list.sort((a, b) => a.file_name.localeCompare(b.file_name));
      case 'status': return list.sort((a, b) => a.processing_status.localeCompare(b.processing_status));
      default: return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
  }, [documents, filter, sort, search]);

  const filteredVideos = useMemo(() => {
    let list = [...notebookLinkedVideos];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.title.toLowerCase().includes(q)
        || (r.mediaVideoId || '').toLowerCase().includes(q)
        || (r.mediaChannelName || '').toLowerCase().includes(q)
      );
    }

    if (filter === 'searchable') list = list.filter((r) => r.transcriptStatus === 'ready');
    else if (filter === 'processing') list = list.filter((r) => ['queued', 'running'].includes(r.transcriptStatus || ''));
    else if (filter === 'failed') list = list.filter((r) => r.transcriptStatus === 'failed');

    switch (sort) {
      case 'oldest': return list.sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
      case 'name': return list.sort((a, b) => a.title.localeCompare(b.title));
      case 'status': return list.sort((a, b) => (a.transcriptStatus || '').localeCompare(b.transcriptStatus || ''));
      default: return list.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }
  }, [notebookLinkedVideos, filter, sort, search]);

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2" onClick={() => setActiveView('notebooks')}>
            {t('documentDashboard.back')}
          </Button>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <FileText className="h-5 w-5 text-accent" />
              <h1 className="text-lg font-semibold text-foreground">{t('documentDashboard.manageNotebookDocs')}</h1>
            </div>
            {notebook && (
              <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                <BookOpenCheck className="h-3.5 w-3.5" />
                <span>{notebook.name}</span>
              </div>
            )}
          </div>
          <Button className="gap-2" onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4" /> {t('documentDashboard.uploadDocuments')}
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 mt-4">
          <StatCard label={t('documentDashboard.stats.total')} value={totalCount} />
          <StatCard label={t('documentDashboard.stats.searchable')} value={searchableCount} color="text-green-600" />
          <StatCard label={t('documentDashboard.stats.processing')} value={processingCount} color="text-amber-600" />
          <StatCard label={t('documentDashboard.stats.failed')} value={failedCount} color="text-destructive" />
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 py-3 border-b border-border bg-muted/30 shrink-0 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder={t('documentDashboard.filterByName')} className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={(v: FilterStatus) => setFilter(v)}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <Filter className="h-3 w-3 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('documentDashboard.filters.all')}</SelectItem>
            <SelectItem value="searchable">{t('documentDashboard.filters.searchable')}</SelectItem>
            <SelectItem value="processing">{t('documentDashboard.filters.processing')}</SelectItem>
            <SelectItem value="failed">{t('documentDashboard.filters.failed')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v: SortKey) => setSort(v)}>
          <SelectTrigger className="w-[150px] h-8 text-sm">
            <ArrowUpDown className="h-3 w-3 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{t('documentDashboard.sort.recent')}</SelectItem>
            <SelectItem value="oldest">{t('documentDashboard.sort.oldest')}</SelectItem>
            <SelectItem value="name">{t('documentDashboard.sort.name')}</SelectItem>
            <SelectItem value="status">{t('documentDashboard.sort.status')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Document list */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-2">
          {isLoading || isResourcesLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : filtered.length === 0 && filteredVideos.length === 0 ? (
            <div className="text-center py-16">
              {documents.length > 0 || notebookLinkedVideos.length > 0 ? (
                <>
                  <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">{t('documentDashboard.noMatchSources')}</p>
                </>
              ) : (
                <>
                  <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <h3 className="text-sm font-medium text-foreground mb-1">{t('documentDashboard.noSources')}</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                    {t('documentDashboard.emptyNotebook')}
                  </p>
                  <Button variant="outline" className="gap-2" onClick={() => setShowUpload(true)}>
                    <Upload className="h-4 w-4" /> {t('documentDashboard.uploadDocuments')}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {filtered.map(doc => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  chunkStats={chunkStatsMap?.get(doc.id)}
                  questionStats={questionStatsMap?.get(doc.id)}
                  isExpanded={expandedId === `doc:${doc.id}`}
                  onToggle={() => setExpandedId(expandedId === `doc:${doc.id}` ? null : `doc:${doc.id}`)}
                  onDelete={() => handleDelete(doc)}
                  onRetry={() => retryProcessing(doc)}
                  isDeleting={deleteMutation.isPending}
                  isRetrying={isRetrying}
                />
              ))}
              {filteredVideos.map(resource => (
                <LinkedVideoRow
                  key={resource.id}
                  resource={resource}
                  isExpanded={expandedId === `video:${resource.id}`}
                  onToggle={() => setExpandedId(expandedId === `video:${resource.id}` ? null : `video:${resource.id}`)}
                  onDelete={() => handleDeleteResource(resource)}
                  onRetry={() => handleRetryTranscript(resource)}
                  isDeleting={deleteResourceMutation.isPending}
                  isRetrying={retryTranscriptMutation.isPending}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      <UploadDocumentsDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        onUploadComplete={() => {}}
        context="notebook"
      />

      <DeleteWithConfirmDialog
        open={!!pendingDeleteDoc}
        onOpenChange={(open) => !open && setPendingDeleteDoc(null)}
        title={t('documentDashboard.deleteDialog.title', { defaultValue: 'Delete document?' })}
        intro={t('documentDashboard.deleteDialog.intro', { name: pendingDeleteDoc?.file_name ?? '', defaultValue: 'This will permanently delete "{{name}}" and all of its data, including:' })}
        items={[
          t('documentDashboard.deleteDialog.items.file', { defaultValue: 'The original uploaded file' }),
          t('documentDashboard.deleteDialog.items.extracted', { defaultValue: 'All extracted text, summaries, and chunks' }),
          t('documentDashboard.deleteDialog.items.embeddings', { defaultValue: 'Search embeddings and generated questions' }),
        ]}
        irreversibleNote={t('documentDashboard.deleteDialog.irreversible', { defaultValue: 'This action cannot be undone.' })}
        confirmLabel={t('documentDashboard.deleteDialog.confirm', { defaultValue: 'Delete document' })}
        cancelLabel={t('documentDashboard.deleteDialog.cancel', { defaultValue: 'Cancel' })}
        onConfirm={confirmDeleteDoc}
        isPending={deleteMutation.isPending}
      />

      <DeleteWithConfirmDialog
        open={!!pendingDeleteResource}
        onOpenChange={(open) => !open && setPendingDeleteResource(null)}
        title={t('documentDashboard.deleteResourceDialog.title', { defaultValue: 'Delete resource?' })}
        intro={t('documentDashboard.deleteResourceDialog.intro', { name: pendingDeleteResource?.title ?? '', defaultValue: 'This will permanently delete "{{name}}" and all of its data, including:' })}
        items={[
          t('documentDashboard.deleteResourceDialog.items.link', { defaultValue: 'The linked resource' }),
          t('documentDashboard.deleteResourceDialog.items.transcript', { defaultValue: 'All transcripts and extracted content' }),
          t('documentDashboard.deleteResourceDialog.items.embeddings', { defaultValue: 'Search embeddings and generated questions' }),
        ]}
        irreversibleNote={t('documentDashboard.deleteResourceDialog.irreversible', { defaultValue: 'This action cannot be undone.' })}
        confirmLabel={t('documentDashboard.deleteResourceDialog.confirm', { defaultValue: 'Delete resource' })}
        cancelLabel={t('documentDashboard.deleteResourceDialog.cancel', { defaultValue: 'Cancel' })}
        onConfirm={confirmDeleteResource}
        isPending={deleteResourceMutation.isPending}
      />
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-xl font-semibold tabular-nums", color || 'text-foreground')}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function DocumentRow({
  doc, chunkStats, questionStats, isExpanded, onToggle, onDelete, onRetry, isDeleting, isRetrying,
}: {
  doc: DbDocument;
  chunkStats?: import('@/hooks/useDocumentChunkStats').ChunkStats;
  questionStats?: import('@/hooks/useDocumentQuestionStats').QuestionStats;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRetry: () => void;
  isDeleting: boolean;
  isRetrying: boolean;
}) {
  const { t } = useTranslation();
  const Icon = fileIcons[doc.file_type] || FileIcon;
  const color = fileColors[doc.file_type] || 'text-muted-foreground';
  const isProcessing = !['completed', 'failed'].includes(doc.processing_status);
  const { data: processingStatus } = useDocumentProcessingStatus(
    doc.id,
    isExpanded || isProcessing
  );

  const statusPresentation = processingStatus
    ? deriveDocumentStatusPresentation(processingStatus)
    : null;

  const isAIReady = processingStatus
    ? processingStatus.readiness.groundedChatReady
    : (doc.processing_status === 'completed' && (chunkStats?.embeddedCount ?? 0) > 0 && chunkStats?.embeddedCount === chunkStats?.chunkCount);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="rounded-lg border border-border bg-card transition-shadow hover:shadow-sm">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 p-3 text-left">
            <div className={cn('p-2 rounded-md bg-muted shrink-0', color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-foreground truncate" title={doc.file_name}>
                  {truncateFileName(doc.file_name)}
                </p>
                <DocumentStatusBadge
                  status={statusPresentation?.primaryTone === 'ready'
                    ? 'completed'
                    : statusPresentation?.primaryTone === 'failed'
                      ? 'failed'
                      : doc.processing_status}
                />
                <AIReadyBadge isReady={isAIReady} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {doc.file_type.toUpperCase()} • {formatFileSize(doc.file_size)} • {new Date(doc.created_at).toLocaleDateString()}
                {doc.word_count ? ` • ${doc.word_count.toLocaleString()} ${t('documentDashboard.wordsSuffix')}` : ''}
                {statusPresentation?.secondaryLabel && (
                  <span className="text-muted-foreground"> • {statusPresentation.secondaryLabel}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {doc.processing_status === 'failed' && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-accent" onClick={e => { e.stopPropagation(); onRetry(); }} disabled={isRetrying} title={t('documentDashboard.retryProcessing')}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={e => { e.stopPropagation(); onDelete(); }} disabled={isDeleting}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 border-t border-border">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 py-3 text-xs">
              <MetaItem label={t('documentDashboard.meta.fileType')} value={doc.file_type.toUpperCase()} />
              <MetaItem label={t('documentDashboard.meta.mimeType')} value={doc.mime_type} />
              <MetaItem label={t('documentDashboard.meta.size')} value={formatFileSize(doc.file_size)} />
              <MetaItem label={t('documentDashboard.meta.uploaded')} value={new Date(doc.created_at).toLocaleString()} />
              {doc.detected_language && <MetaItem label={t('documentDashboard.meta.language')} value={doc.detected_language.toUpperCase()} />}
              {doc.word_count != null && <MetaItem label={t('documentDashboard.meta.words')} value={doc.word_count.toLocaleString()} />}
              {doc.char_count != null && <MetaItem label={t('documentDashboard.meta.characters')} value={doc.char_count.toLocaleString()} />}
              {doc.page_count != null && <MetaItem label={t('documentDashboard.meta.pages')} value={doc.page_count.toString()} />}
              {chunkStats && chunkStats.chunkCount > 0 && <MetaItem label={t('documentDashboard.meta.chunksCreated')} value={chunkStats.chunkCount.toString()} />}
              {chunkStats && chunkStats.embeddedCount > 0 && <MetaItem label={t('documentDashboard.meta.embeddingsCreated')} value={`${chunkStats.embeddedCount}/${chunkStats.chunkCount}`} />}
              {chunkStats && chunkStats.chunkCount > 0 && (
                <MetaItem label={t('documentDashboard.meta.embeddingCoverage')} value={`${Math.round((chunkStats.embeddedCount / chunkStats.chunkCount) * 100)}%`} />
              )}
              {chunkStats && chunkStats.embeddedCount === chunkStats.chunkCount && chunkStats.chunkCount > 0 && (
                <MetaItem label={t('documentDashboard.meta.semanticRetrieval')} value={t('documentDashboard.meta.ready')} />
              )}
              {doc.retry_count > 0 && <MetaItem label={t('documentDashboard.meta.retryAttempts')} value={doc.retry_count.toString()} />}
              {doc.last_retry_at && <MetaItem label={t('documentDashboard.meta.lastRetry')} value={new Date(doc.last_retry_at).toLocaleString()} />}
            </div>

            {doc.processing_error && (
              <div className="text-xs text-destructive bg-destructive/5 rounded p-2 mb-3">
                <span className="font-medium">{t('documentDashboard.errorLabel')} </span>{doc.processing_error}
              </div>
            )}

            {doc.summary && (
              <div className="mb-3">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{t('documentDashboard.summary')}</p>
                <p className="text-xs text-foreground leading-relaxed">{doc.summary}</p>
              </div>
            )}

            {processingStatus ? (
              <DocumentProcessingOverview status={processingStatus} />
            ) : (
              <DocumentUsability doc={doc} chunkStats={chunkStats} questionStats={questionStats} />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-foreground font-medium truncate" title={value}>{value}</p>
    </div>
  );
}
