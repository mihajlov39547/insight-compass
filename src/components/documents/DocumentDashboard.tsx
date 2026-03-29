import React, { useState, useMemo } from 'react';
import {
  FileText, FileType, FileSpreadsheet, File as FileIcon, Upload, Trash2,
  RotateCcw, ChevronDown, ChevronRight, Search, ArrowUpDown, Filter,
  FolderOpen, MessageSquare, Download
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
import { UploadDocumentsDialog } from '@/components/dialogs/UploadDocumentsDialog';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { DocumentUsability } from './DocumentUsability';
import { AIReadyBadge } from './AIReadyBadge';
import { useDocumentChunkStats } from '@/hooks/useDocumentChunkStats';
import { useDocumentQuestionStats } from '@/hooks/useDocumentQuestionStats';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

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
  const { selectedProjectId, selectedChatId, setActiveView } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);

  const project = projects.find(p => p.id === selectedProjectId);
  const chat = chats.find(c => c.id === selectedChatId);

  const { data: documents = [], isLoading } = useDocuments(
    selectedProjectId ?? undefined,
    scope === 'project' ? null : selectedChatId,
  );

  const deleteMutation = useDeleteDocument();
  const { retry: retryProcessing, isPending: isRetrying } = useRetryProcessing();
  const [showUpload, setShowUpload] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [search, setSearch] = useState('');

  const handleDelete = (doc: DbDocument) => {
    deleteMutation.mutate(doc, {
      onSuccess: () => toast({ title: `${doc.file_name} deleted` }),
      onError: (err: any) => toast({ title: 'Delete failed', description: err.message, variant: 'destructive' }),
    });
  };

  // Chunk stats
  const documentIds = documents.map(d => d.id);
  const { data: chunkStatsMap } = useDocumentChunkStats(documentIds);
  const { data: questionStatsMap } = useDocumentQuestionStats(documentIds);

  // Stats
  const totalCount = documents.length;
  const searchableCount = documents.filter(d => d.processing_status === 'completed').length;
  const processingCount = documents.filter(d => !['completed', 'failed'].includes(d.processing_status)).length;
  const failedCount = documents.filter(d => d.processing_status === 'failed').length;

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

  const title = scope === 'project' ? 'Manage Project Documents' : 'Manage Chat Documents';
  const scopeIcon = scope === 'project' ? FolderOpen : MessageSquare;
  const ScopeIcon = scopeIcon;
  const scopeName = scope === 'project' ? project?.name : chat?.name;

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2" onClick={() => setActiveView('default')}>
            ← Back
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
                  <span className="text-muted-foreground/50">in {project.name}</span>
                )}
              </div>
            )}
          </div>
          <Button className="gap-2" onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4" /> Upload Documents
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 mt-4">
          <StatCard label="Total" value={totalCount} />
          <StatCard label="Searchable" value={searchableCount} color="text-green-600" />
          <StatCard label="Processing" value={processingCount} color="text-amber-600" />
          <StatCard label="Failed" value={failedCount} color="text-destructive" />
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 py-3 border-b border-border bg-muted/30 shrink-0 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Filter by name…" className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={(v: FilterStatus) => setFilter(v)}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <Filter className="h-3 w-3 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="searchable">Searchable</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v: SortKey) => setSort(v)}>
          <SelectTrigger className="w-[150px] h-8 text-sm">
            <ArrowUpDown className="h-3 w-3 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most recent</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Document list */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState scope={scope} hasDocuments={documents.length > 0} onUpload={() => setShowUpload(true)} />
          ) : (
            filtered.map(doc => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                chunkStats={chunkStatsMap?.get(doc.id)}
                questionStats={questionStatsMap?.get(doc.id)}
                isExpanded={expandedId === doc.id}
                onToggle={() => setExpandedId(expandedId === doc.id ? null : doc.id)}
                onDelete={() => handleDelete(doc)}
                onRetry={() => retryProcessing(doc)}
                isDeleting={deleteMutation.isPending}
                isRetrying={isRetrying}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <UploadDocumentsDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        onUploadComplete={() => {}}
        context={scope}
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
  if (hasDocuments) {
    return (
      <div className="text-center py-16">
        <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No documents match your filters</p>
      </div>
    );
  }
  return (
    <div className="text-center py-16">
      <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
      <h3 className="text-sm font-medium text-foreground mb-1">No documents yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
        {scope === 'project'
          ? 'Project documents are available across all chats in this project. Upload documents to enable AI-powered search and analysis.'
          : 'Chat documents are attached to this specific chat. Upload documents to provide context for this conversation.'}
      </p>
      <Button variant="outline" className="gap-2" onClick={onUpload}>
        <Upload className="h-4 w-4" /> Upload Documents
      </Button>
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
  const Icon = fileIcons[doc.file_type] || FileIcon;
  const color = fileColors[doc.file_type] || 'text-muted-foreground';
  const isAIReady = doc.processing_status === 'completed' && (chunkStats?.embeddedCount ?? 0) > 0 && chunkStats?.embeddedCount === chunkStats?.chunkCount;

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
                <DocumentStatusBadge status={doc.processing_status} />
                <AIReadyBadge isReady={isAIReady} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {doc.file_type.toUpperCase()} • {formatFileSize(doc.file_size)} • {new Date(doc.created_at).toLocaleDateString()}
                {doc.word_count ? ` • ${doc.word_count.toLocaleString()} words` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {doc.processing_status === 'failed' && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-accent" onClick={e => { e.stopPropagation(); onRetry(); }} disabled={isRetrying} title="Retry processing">
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
              <MetaItem label="File type" value={doc.file_type.toUpperCase()} />
              <MetaItem label="MIME type" value={doc.mime_type} />
              <MetaItem label="Size" value={formatFileSize(doc.file_size)} />
              <MetaItem label="Uploaded" value={new Date(doc.created_at).toLocaleString()} />
              {doc.detected_language && <MetaItem label="Language" value={doc.detected_language.toUpperCase()} />}
              {doc.word_count != null && <MetaItem label="Words" value={doc.word_count.toLocaleString()} />}
              {doc.char_count != null && <MetaItem label="Characters" value={doc.char_count.toLocaleString()} />}
              {doc.page_count != null && <MetaItem label="Pages" value={doc.page_count.toString()} />}
              {chunkStats && chunkStats.chunkCount > 0 && <MetaItem label="Chunks created" value={chunkStats.chunkCount.toString()} />}
              {chunkStats && chunkStats.embeddedCount > 0 && <MetaItem label="Embeddings created" value={`${chunkStats.embeddedCount}/${chunkStats.chunkCount}`} />}
              {chunkStats && chunkStats.chunkCount > 0 && (
                <MetaItem label="Embedding coverage" value={`${Math.round((chunkStats.embeddedCount / chunkStats.chunkCount) * 100)}%`} />
              )}
              {chunkStats && chunkStats.embeddedCount === chunkStats.chunkCount && chunkStats.chunkCount > 0 && (
                <MetaItem label="Semantic retrieval" value="Ready" />
              )}
              {doc.retry_count > 0 && <MetaItem label="Retry attempts" value={doc.retry_count.toString()} />}
              {doc.last_retry_at && <MetaItem label="Last retry" value={new Date(doc.last_retry_at).toLocaleString()} />}
              <MetaItem label="Status" value={doc.processing_status} />
            </div>

            {doc.processing_error && (
              <div className="text-xs text-destructive bg-destructive/5 rounded p-2 mb-3">
                <span className="font-medium">Error: </span>{doc.processing_error}
              </div>
            )}

            {doc.summary && (
              <div className="mb-3">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Summary</p>
                <p className="text-xs text-foreground leading-relaxed">{doc.summary}</p>
              </div>
            )}

            <DocumentUsability doc={doc} chunkStats={chunkStats} questionStats={questionStats} />
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
