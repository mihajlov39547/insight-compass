import React, { useState, useMemo } from 'react';
import {
  FileText, FileType, FileSpreadsheet, File as FileIcon, Upload, Trash2,
  RotateCcw, ChevronDown, ChevronRight, Search, ArrowUpDown, Filter,
  FolderOpen, MessageSquare, Download, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useApp } from '@/contexts/useApp';
import { useProjects } from '@/hooks/useProjects';
import { useChats } from '@/hooks/useChats';
import { useDocuments, useDeleteDocument, useRetryProcessing, DbDocument } from '@/hooks/useDocuments';
import { useResources } from '@/hooks/useResources';
import { useDeleteResource, useRetryYouTubeTranscriptIngestion, type ResourceActionInput } from '@/hooks/useResourceActions';
import type { Resource } from '@/lib/resourceClassification';
import { UploadDocumentsDialog } from '@/components/dialogs/UploadDocumentsDialog';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { DocumentUsability } from './DocumentUsability';
import { DocumentProcessingOverview } from './DocumentProcessingOverview';
import { AIReadyBadge } from './AIReadyBadge';
import { useDocumentChunkStats } from '@/hooks/useDocumentChunkStats';
import { useDocumentQuestionStats } from '@/hooks/useDocumentQuestionStats';
import { useDocumentProcessingStatus } from '@/hooks/useDocumentProcessingStatus';
import { deriveDocumentStatusPresentation } from '@/hooks/useDocumentProcessingStatus';
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

interface DocumentDashboardProps {
  scope: 'project' | 'chat';
}

export function DocumentDashboard({ scope }: DocumentDashboardProps) {
  const { t } = useTranslation();
  const { selectedProjectId, selectedChatId, setActiveView } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);

  const project = projects.find(p => p.id === selectedProjectId);
  const chat = chats.find(c => c.id === selectedChatId);

  // Project scope: show ALL project documents (including those attached to any chat).
  // Chat scope: only docs attached to the selected chat.
  const { data: documents = [], isLoading } = useDocuments(
    selectedProjectId ?? undefined,
    scope === 'project' ? undefined : selectedChatId,
  );
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

  // Chunk stats
  const documentIds = documents.map(d => d.id);
  const { data: chunkStatsMap } = useDocumentChunkStats(documentIds);
  const { data: questionStatsMap } = useDocumentQuestionStats(documentIds);

  // Stats
  const scopedLinkedVideos = resources.filter((r) => {
    if (r.provider !== 'youtube' || r.sourceType !== 'linked') return false;
    if (scope === 'project') return !!selectedProjectId && r.projectId === selectedProjectId;
    return false;
  });

  const totalCount = documents.length + scopedLinkedVideos.length;
  const searchableCount = documents.filter(d => d.processing_status === 'completed').length
    + scopedLinkedVideos.filter(r => r.transcriptStatus === 'ready').length;
  const processingCount = documents.filter(d => !['completed', 'failed'].includes(d.processing_status)).length
    + scopedLinkedVideos.filter(r => ['queued', 'running'].includes(r.transcriptStatus || '')).length;
  const failedCount = documents.filter(d => d.processing_status === 'failed').length
    + scopedLinkedVideos.filter(r => r.transcriptStatus === 'failed').length;

  // Filter + sort
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
    let list = [...scopedLinkedVideos];

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
  }, [scopedLinkedVideos, filter, sort, search]);

  const title = scope === 'project' ? t('documentDashboard.manageProjectDocs') : t('documentDashboard.manageChatDocs');
  const scopeIcon = scope === 'project' ? FolderOpen : MessageSquare;
  const ScopeIcon = scopeIcon;
  const scopeName = scope === 'project' ? project?.name : chat?.name;

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2" onClick={() => setActiveView('default')}>
            {t('documentDashboard.back')}
          </Button>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <FileText className="h-5 w-5 text-accent" />
              <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            </div>
            {scopeName && (
              <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                <ScopeIcon className="h-3.5 w-3.5" />
                <span>{scopeName}</span>
                {scope === 'chat' && project && (
                  <span className="text-muted-foreground/50">{t('documentDashboard.inProject', { name: project.name })}</span>
                )}
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
            <EmptyState scope={scope} hasDocuments={documents.length > 0 || scopedLinkedVideos.length > 0} onUpload={() => setShowUpload(true)} />
          ) : (
            <>
              {filtered.map(doc => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  chatLabel={scope === 'project' && doc.chat_id ? (chats.find(c => c.id === doc.chat_id)?.name ?? t('documentDashboard.chatBadgeFallback')) : undefined}
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
        context={scope}
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

function EmptyState({ scope, hasDocuments, onUpload }: { scope: 'project' | 'chat'; hasDocuments: boolean; onUpload: () => void }) {
  const { t } = useTranslation();
  if (hasDocuments) {
    return (
      <div className="text-center py-16">
        <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{t('documentDashboard.noMatch')}</p>
      </div>
    );
  }
  return (
    <div className="text-center py-16">
      <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
      <h3 className="text-sm font-medium text-foreground mb-1">{t('documentDashboard.noDocuments')}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
        {scope === 'project' ? t('documentDashboard.emptyProject') : t('documentDashboard.emptyChat')}
      </p>
      <Button variant="outline" className="gap-2" onClick={onUpload}>
        <Upload className="h-4 w-4" /> {t('documentDashboard.uploadDocuments')}
      </Button>
    </div>
  );
}

function DocumentRow({
  doc, chatLabel, chunkStats, questionStats, isExpanded, onToggle, onDelete, onRetry, isDeleting, isRetrying,
}: {
  doc: DbDocument;
  chatLabel?: string;
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

  const isAIReady = processingStatus
    ? processingStatus.readiness.groundedChatReady
    : (doc.processing_status === 'completed' && (chunkStats?.embeddedCount ?? 0) > 0 && chunkStats?.embeddedCount === chunkStats?.chunkCount);

  const isPartiallyReady = processingStatus
    ? (processingStatus.readiness.semanticSearchReady || processingStatus.readiness.keywordSearchReady) && doc.processing_status !== 'completed'
    : false;

  const statusPresentation = processingStatus
    ? deriveDocumentStatusPresentation(processingStatus)
    : null;

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
                {isPartiallyReady && statusPresentation?.primaryTone !== 'ready' && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-blue-500/10 text-blue-700 border-blue-500/20">
                    <Zap className="h-2.5 w-2.5" /> {t('documentDashboard.partiallyReady')}
                  </Badge>
                )}
                <AIReadyBadge isReady={isAIReady} />
                {chatLabel && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-accent/40 text-accent">
                    <MessageSquare className="h-2.5 w-2.5" />
                    {chatLabel}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {doc.file_type.toUpperCase()} • {formatFileSize(doc.file_size)} • {new Date(doc.created_at).toLocaleDateString()}
                {doc.word_count ? ` • ${doc.word_count.toLocaleString()} ${t('documentDashboard.wordsSuffix')}` : ''}
                {statusPresentation?.primaryTone === 'ready' && statusPresentation.secondaryLabel && (
                  <span className="text-muted-foreground"> • {statusPresentation.secondaryLabel}</span>
                )}
                {statusPresentation?.primaryTone === 'partial' && statusPresentation.secondaryLabel && (
                  <span className="text-muted-foreground"> • {statusPresentation.secondaryLabel}</span>
                )}
                {isProcessing && statusPresentation?.primaryTone === 'processing' && statusPresentation?.primaryLabel && (
                  <span className="text-primary"> • {statusPresentation.primaryLabel}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {doc.processing_status === 'failed' && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-accent" asChild>
                  <span
                    role="button"
                    tabIndex={isRetrying ? -1 : 0}
                    aria-disabled={isRetrying}
                    title={t('documentDashboard.retryProcessing')}
                    onClick={(e) => { e.stopPropagation(); if (!isRetrying) onRetry(); }}
                    onKeyDown={(e) => {
                      if (isRetrying) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onRetry();
                      }
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </span>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" asChild>
                <span
                  role="button"
                  tabIndex={isDeleting ? -1 : 0}
                  aria-disabled={isDeleting}
                  onClick={(e) => { e.stopPropagation(); if (!isDeleting) onDelete(); }}
                  onKeyDown={(e) => {
                    if (isDeleting) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete();
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
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
