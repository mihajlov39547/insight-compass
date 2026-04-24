import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText, Image, FileSpreadsheet, Presentation, Mail, FileType,
  Database, Music, Video, Link, File, Search, ArrowUpDown, Filter,
  FolderOpen, BookOpen, User, Globe, Clock, CheckCircle2,
  AlertCircle, Loader2, MoreHorizontal, Download, Eye, RotateCcw,
  Trash2, ExternalLink, X, HelpCircle, Plus, MessageSquare, ScanText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResources } from '@/hooks/useResources';
import {
  downloadResourceFromStorage,
  useCreateLinkResource,
  useDeleteResource,
  useRenameResource,
  useRetryYouTubeTranscriptIngestion,
  useRetryResourceProcessing,
  type ResourceActionInput,
} from '@/hooks/useResourceActions';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/useApp';
import { useAuth } from '@/contexts/useAuth';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useResourceTranscriptPreview } from '@/hooks/useResourceTranscriptPreview';
import { useResourceExtractedText } from '@/hooks/useResourceExtractedText';
import { useResourceTranscriptDebug, type TranscriptDebugPayload, type StageDebugEntry } from '@/hooks/useResourceTranscriptDebug';
import {
  type Resource, type ResourceType, type ReadinessStatus, type ContainerType,
  formatFileSize, truncateFileName, formatResourceLocation
} from '@/lib/resourceClassification';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

// ── Icon mapping ────────────────────────────────────────────────────
const RESOURCE_ICONS: Record<ResourceType, React.ElementType> = {
  document: FileText,
  image: Image,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  email: Mail,
  text: FileType,
  dataset: Database,
  audio: Music,
  video: Video,
  link: Link,
  other: File,
};

const RESOURCE_COLORS: Record<ResourceType, string> = {
  document: 'text-blue-500',
  image: 'text-emerald-500',
  spreadsheet: 'text-green-600',
  presentation: 'text-orange-500',
  email: 'text-violet-500',
  text: 'text-muted-foreground',
  dataset: 'text-cyan-500',
  audio: 'text-pink-500',
  video: 'text-red-500',
  link: 'text-sky-500',
  other: 'text-muted-foreground',
};

const CONTAINER_ICONS: Record<ContainerType, React.ElementType> = {
  project: FolderOpen,
  notebook: BookOpen,
  personal: User,
};

// ── Filter types ────────────────────────────────────────────────────
type OwnershipFilter = 'all' | 'mine' | 'shared';
type StatusFilter = 'all' | 'ready' | 'processing' | 'failed';
type TypeFilter = 'all' | ResourceType;
type ContainerFilter = 'all' | ContainerType;
type SortKey = 'newest' | 'oldest' | 'name' | 'type' | 'status';

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString();
}

function formatProvider(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

// ── Main Component ──────────────────────────────────────────────────
export function ResourcesLanding() {
  const { t } = useTranslation();
  const { data: resources = [], isLoading } = useResources();
  const { user } = useAuth();
  const { setActiveView, setSelectedProjectId, setSelectedNotebookId, setSelectedChatId } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: notebooks = [] } = useNotebooks();
  const createLinkMutation = useCreateLinkResource();
  const deleteMutation = useDeleteResource();
  const renameMutation = useRenameResource();
  const retryTranscriptMutation = useRetryYouTubeTranscriptIngestion();
  const retryMutation = useRetryResourceProcessing();

  const [search, setSearch] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [containerFilter, setContainerFilter] = useState<ContainerFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameResource, setRenameResource] = useState<Resource | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkProvider, setLinkProvider] = useState('unknown');
  const [linkContainerType, setLinkContainerType] = useState<ContainerType>('personal');
  const [linkContainerId, setLinkContainerId] = useState<string | null>(null);

  // ── Stats ───────────────────────────────────────────────────────
  const totalCount = resources.length;
  const readyCount = resources.filter(r => r.readiness === 'ready').length;
  const processingCount = resources.filter(r => r.readiness === 'processing').length;
  const failedCount = resources.filter(r => r.readiness === 'failed').length;
  const myCount = resources.filter(r => r.ownerUserId === user?.id).length;
  const sharedCount = resources.filter(r => r.isSharedWithMe).length;

  // ── Active resource types (for filter chips) ──────────────────
  const activeResourceTypes = useMemo(() => {
    const types = new Set(resources.map(r => r.resourceType));
    return Array.from(types) as ResourceType[];
  }, [resources]);

  // ── Filtered + sorted ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...resources];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.containerName?.toLowerCase().includes(q) ||
        r.containerPath?.toLowerCase().includes(q) ||
        r.projectName?.toLowerCase().includes(q) ||
        r.chatName?.toLowerCase().includes(q) ||
        r.notebookName?.toLowerCase().includes(q) ||
        r.ownerDisplayName.toLowerCase().includes(q) ||
        r.extension.toLowerCase().includes(q) ||
        r.previewTitle?.toLowerCase().includes(q) ||
        r.previewDomain?.toLowerCase().includes(q) ||
        r.linkUrl?.toLowerCase().includes(q) ||
        r.mediaVideoId?.toLowerCase().includes(q) ||
        r.mediaChannelName?.toLowerCase().includes(q) ||
        r.transcriptStatus?.toLowerCase().includes(q)
      );
    }

    if (ownershipFilter === 'mine') list = list.filter(r => r.ownerUserId === user?.id);
    if (ownershipFilter === 'shared') list = list.filter(r => r.isSharedWithMe);

    if (statusFilter === 'ready') list = list.filter(r => r.readiness === 'ready');
    if (statusFilter === 'processing') list = list.filter(r => r.readiness === 'processing');
    if (statusFilter === 'failed') list = list.filter(r => r.readiness === 'failed');

    if (typeFilter !== 'all') list = list.filter(r => r.resourceType === typeFilter);

    if (containerFilter === 'project') list = list.filter(r => r.containerType === 'project');
    if (containerFilter === 'notebook') list = list.filter(r => r.containerType === 'notebook');
    if (containerFilter === 'personal') list = list.filter(r => r.containerType === 'personal');

    switch (sort) {
      case 'oldest': return list.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      case 'name': return list.sort((a, b) => a.title.localeCompare(b.title));
      case 'type': return list.sort((a, b) => a.resourceType.localeCompare(b.resourceType));
      case 'status': return list.sort((a, b) => a.readiness.localeCompare(b.readiness));
      default: return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  }, [resources, search, ownershipFilter, statusFilter, typeFilter, containerFilter, sort, user?.id]);

  const hasActiveFilters = ownershipFilter !== 'all' || statusFilter !== 'all' || typeFilter !== 'all' || containerFilter !== 'all' || search.length > 0;

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

  useEffect(() => {
    if (!selectedResource) return;
    const next = resources.find((item) => item.id === selectedResource.id) || null;
    if (!next) {
      setSelectedResource(null);
      return;
    }
    if (next !== selectedResource) {
      setSelectedResource(next);
    }
  }, [resources, selectedResource]);

  const handleDelete = (resource: Resource) => {
    if (!resource.canDelete) return;
    const actionInput = toResourceActionInput(resource);
    deleteMutation.mutate(actionInput, {
      onSuccess: () => toast({ title: `${resource.title} deleted` }),
      onError: (err: any) => toast({ title: 'Delete failed', description: err.message, variant: 'destructive' }),
    });
  };

  const handleRetry = (resource: Resource) => {
    if (!resource.canRetry) return;
    if (resource.provider === 'youtube' && resource.transcriptStatus === 'failed') {
      handleRetryTranscript(resource);
      return;
    }

    const optimisticUpdatedAt = new Date().toISOString();
    setSelectedResource((prev) => (
      prev && prev.id === resource.id
        ? {
          ...prev,
          processingStatus: 'queued',
          processingError: null,
          updatedAt: optimisticUpdatedAt,
        }
        : prev
    ));

    const actionInput = toResourceActionInput(resource);
    retryMutation.mutate(actionInput, {
      onSuccess: () => toast({ title: 'Retry queued', description: `${resource.title} will be processed again.` }),
      onError: (err: any) => toast({ title: 'Retry failed', description: err.message, variant: 'destructive' }),
    });
  };

  const handleRetryTranscript = (resource: Resource) => {
    if (resource.provider !== 'youtube') return;
    if (!resource.transcriptStatus || resource.transcriptStatus !== 'failed') return;

    retryTranscriptMutation.mutate(toResourceActionInput(resource), {
      onSuccess: () => {
        toast({ title: 'Transcript retry queued', description: 'Transcript ingestion is running again.' });
      },
      onError: (err: any) => {
        toast({ title: 'Transcript retry failed', description: err.message, variant: 'destructive' });
      },
    });
  };

  const handleOpen = (resource: Resource) => {
    if (!resource.canOpen || !resource.containerId) return;
    if (resource.chatId) {
      setSelectedProjectId(resource.projectId || resource.containerId);
      setSelectedChatId(resource.chatId);
      setActiveView('chat-documents');
      return;
    }
    if (resource.containerType === 'project') {
      setSelectedProjectId(resource.containerId);
      setSelectedChatId(null);
      setActiveView('project-documents');
      return;
    }
    if (resource.containerType === 'notebook') {
      setSelectedNotebookId(resource.containerId);
      setActiveView('notebook-documents');
    }
  };

  const handleViewDetails = (resource: Resource) => {
    if (!resource.canViewDetails) return;
    setSelectedResource(resource);
    setDetailsOpen(true);
  };

  const handleDownload = async (resource: Resource) => {
    if (!resource.canDownload) return;
    try {
      const signedUrl = await downloadResourceFromStorage(resource.storagePath);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast({ title: 'Download failed', description: err.message || 'Unable to create download link', variant: 'destructive' });
    }
  };

  const openRenameDialog = (resource: Resource) => {
    if (!resource.canRename) return;
    setRenameResource(resource);
    setRenameValue(resource.title);
    setRenameOpen(true);
  };

  const handleRenameSubmit = () => {
    if (!renameResource) return;

    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      toast({ title: 'Rename failed', description: 'Title cannot be empty.', variant: 'destructive' });
      return;
    }

    if (nextTitle === renameResource.title) {
      setRenameOpen(false);
      setRenameResource(null);
      return;
    }

    const actionInput = toResourceActionInput(renameResource);
    const targetId = renameResource.id;
    const previousTitle = renameResource.title;
    const previousUpdatedAt = renameResource.updatedAt;
    const optimisticUpdatedAt = new Date().toISOString();

    setSelectedResource(prev => (
      prev && prev.id === targetId ? { ...prev, title: nextTitle, updatedAt: optimisticUpdatedAt } : prev
    ));

    setRenameOpen(false);
    setRenameResource(null);

    renameMutation.mutate(
      { resource: actionInput, newTitle: nextTitle },
      {
        onSuccess: (result) => {
          setSelectedResource(prev => (
            prev && prev.id === result.id ? { ...prev, title: result.title, updatedAt: result.updatedAt } : prev
          ));
          toast({ title: 'Resource renamed', description: `Renamed to ${result.title}` });
        },
        onError: (err: any) => {
          setSelectedResource(prev => (
            prev && prev.id === targetId ? { ...prev, title: previousTitle, updatedAt: previousUpdatedAt } : prev
          ));
          toast({ title: 'Rename failed', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleOpenPersonalFallback = (resource: Resource) => {
    setOwnershipFilter(resource.isOwnedByMe ? 'mine' : 'all');
    setContainerFilter('personal');
    setSearch(resource.title);
    setDetailsOpen(false);
    toast({ title: 'Showing personal resources', description: 'Applied personal filter and focused this resource.' });
  };

  const handleOpenFromDrawer = (resource: Resource) => {
    if (resource.canOpen && resource.containerId) {
      handleOpen(resource);
      setDetailsOpen(false);
      return;
    }
    handleOpenPersonalFallback(resource);
  };

  const resetAddSourceDialog = () => {
    setLinkUrl('');
    setLinkTitle('');
    setLinkProvider('unknown');
    setLinkContainerType('personal');
    setLinkContainerId(null);
  };

  const handleAddSource = () => {
    if (!linkUrl.trim()) {
      toast({ title: 'Add source failed', description: 'URL is required.', variant: 'destructive' });
      return;
    }

    const requiresContainerId = linkContainerType !== 'personal';
    if (requiresContainerId && !linkContainerId) {
      toast({ title: 'Add source failed', description: 'Choose a target workspace.', variant: 'destructive' });
      return;
    }

    createLinkMutation.mutate(
      {
        url: linkUrl,
        title: linkTitle || undefined,
        provider: linkProvider,
        containerType: linkContainerType,
        containerId: requiresContainerId ? linkContainerId : null,
      },
      {
        onSuccess: () => {
          toast({ title: 'Source added', description: 'Your resource now appears in Resources.' });
          setAddSourceOpen(false);
          resetAddSourceDialog();
        },
        onError: (err: any) => {
          toast({ title: 'Add source failed', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border bg-card shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Globe className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">{t('resources.title')}</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {t('resources.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md">
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                  Add a specific URL or supported source now so it appears in Resources immediately. Some providers support richer enrichment. Unavailable providers are marked Soon.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button size="sm" className="gap-1.5" onClick={() => setAddSourceOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> {t('resources.addSource')}
            </Button>
          </div>
        </div>

        {/* ── Summary stats ───────────────────────────────────── */}
        <div className="flex items-center gap-5 flex-wrap">
          <StatPill label={t('resources.stats.total')} value={totalCount} />
          <StatPill label={t('resources.stats.ready')} value={readyCount} variant="success" />
          <StatPill label={t('resources.stats.processing')} value={processingCount} variant="warning" />
          {failedCount > 0 && <StatPill label={t('resources.stats.failed')} value={failedCount} variant="error" />}
          <div className="h-4 w-px bg-border" />
          <StatPill label={t('resources.stats.mine')} value={myCount} />
          {sharedCount > 0 && <StatPill label={t('resources.stats.shared')} value={sharedCount} variant="info" />}
        </div>
      </div>

      {/* ── Controls ──────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-border bg-muted/30 shrink-0 space-y-3">
        {/* Row 1: Search + Sort */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t('resources.search.placeholder')}
              className="pl-9 h-8 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[150px] h-8 text-sm">
              <ArrowUpDown className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t('resources.sort.newest')}</SelectItem>
              <SelectItem value="oldest">{t('resources.sort.oldest')}</SelectItem>
              <SelectItem value="name">{t('resources.sort.name')}</SelectItem>
              <SelectItem value="type">{t('resources.sort.type')}</SelectItem>
              <SelectItem value="status">{t('resources.sort.status')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Row 2: Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

          {/* Ownership */}
          <Tabs value={ownershipFilter} onValueChange={(v) => setOwnershipFilter(v as OwnershipFilter)}>
            <TabsList className="h-7 p-0.5">
              <TabsTrigger value="all" className="text-xs px-2.5 h-6">{t('resources.filters.ownership.all')}</TabsTrigger>
              <TabsTrigger value="mine" className="text-xs px-2.5 h-6">{t('resources.filters.ownership.mine')}</TabsTrigger>
              <TabsTrigger value="shared" className="text-xs px-2.5 h-6">{t('resources.filters.ownership.shared')}</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="h-4 w-px bg-border" />

          {/* Status */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[120px] h-7 text-xs">
              <SelectValue placeholder={t('resources.filters.status.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('resources.filters.status.all')}</SelectItem>
              <SelectItem value="ready">{t('resources.filters.status.ready')}</SelectItem>
              <SelectItem value="processing">{t('resources.filters.status.processing')}</SelectItem>
              <SelectItem value="failed">{t('resources.filters.status.failed')}</SelectItem>
            </SelectContent>
          </Select>

          {/* Type */}
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
            <SelectTrigger className="w-[130px] h-7 text-xs">
              <SelectValue placeholder={t('resources.filters.type.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('resources.filters.type.all')}</SelectItem>
              {activeResourceTypes.map(rt => (
                <SelectItem key={rt} value={rt}>{t(`resources.types.${rt}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Container */}
          <Select value={containerFilter} onValueChange={(v) => setContainerFilter(v as ContainerFilter)}>
            <SelectTrigger className="w-[130px] h-7 text-xs">
              <SelectValue placeholder={t('resources.filters.container.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('resources.filters.container.all')}</SelectItem>
              <SelectItem value="project">{t('resources.filters.container.project')}</SelectItem>
              <SelectItem value="notebook">{t('resources.filters.container.notebook')}</SelectItem>
              <SelectItem value="personal">{t('resources.filters.container.personal')}</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
              onClick={() => { setSearch(''); setOwnershipFilter('all'); setStatusFilter('all'); setTypeFilter('all'); setContainerFilter('all'); }}
            >
              <X className="h-3 w-3" /> {t('resources.filters.clear')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Resource list ─────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasResources={resources.length > 0} hasFilters={hasActiveFilters} />
          ) : (
            <div className="space-y-1">
              {/* Table header */}
              <div className="grid grid-cols-[minmax(0,1fr)_120px_220px_100px_100px_40px] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
                <span>{t('resources.table.resource')}</span>
                <span>{t('resources.table.type')}</span>
                <span>{t('resources.table.location')}</span>
                <span>{t('resources.table.status')}</span>
                <span>{t('resources.table.updated')}</span>
                <span></span>
              </div>

              {filtered.map(resource => (
                <ResourceRow
                  key={resource.id}
                  resource={resource}
                  onOpen={() => handleOpen(resource)}
                  onViewDetails={() => handleViewDetails(resource)}
                  onRename={() => openRenameDialog(resource)}
                  onDownload={() => handleDownload(resource)}
                  onDelete={() => handleDelete(resource)}
                  onRetry={() => handleRetry(resource)}
                  isDeleting={deleteMutation.isPending}
                  isRetrying={retryMutation.isPending || retryTranscriptMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <ResourceDetailsDrawer
        resource={selectedResource}
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setSelectedResource(null);
        }}
        onOpenResource={handleOpenFromDrawer}
        onRename={openRenameDialog}
        onDownload={handleDownload}
        onRetry={handleRetry}
        onRetryTranscript={handleRetryTranscript}
        onDelete={handleDelete}
        onOpenPersonalFallback={handleOpenPersonalFallback}
        isRetrying={retryMutation.isPending}
        isRetryingTranscript={retryTranscriptMutation.isPending}
        isDeleting={deleteMutation.isPending}
      />

      <RenameResourceDialog
        open={renameOpen}
        value={renameValue}
        currentTitle={renameResource?.title || ''}
        submitting={renameMutation.isPending}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) {
            setRenameResource(null);
            setRenameValue('');
          }
        }}
        onValueChange={setRenameValue}
        onSubmit={handleRenameSubmit}
      />

      <AddSourceDialog
        open={addSourceOpen}
        url={linkUrl}
        title={linkTitle}
        provider={linkProvider}
        containerType={linkContainerType}
        containerId={linkContainerId}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        notebooks={notebooks.map((n) => ({ id: n.id, name: n.name }))}
        submitting={createLinkMutation.isPending}
        onOpenChange={(open) => {
          setAddSourceOpen(open);
          if (!open) resetAddSourceDialog();
        }}
        onUrlChange={setLinkUrl}
        onTitleChange={setLinkTitle}
        onProviderChange={setLinkProvider}
        onContainerTypeChange={(value) => {
          setLinkContainerType(value);
          setLinkContainerId(null);
        }}
        onContainerIdChange={setLinkContainerId}
        onSubmit={handleAddSource}
      />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function StatPill({ label, value, variant }: {
  label: string;
  value: number;
  variant?: 'success' | 'warning' | 'error' | 'info';
}) {
  const colorClass = variant === 'success' ? 'text-green-600'
    : variant === 'warning' ? 'text-amber-600'
    : variant === 'error' ? 'text-destructive'
    : variant === 'info' ? 'text-blue-600'
    : 'text-foreground';

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("text-base font-semibold tabular-nums", colorClass)}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function ReadinessBadge({ readiness }: { readiness: ReadinessStatus }) {
  const { t } = useTranslation();
  switch (readiness) {
    case 'ready':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 border-green-500/20">
          <CheckCircle2 className="h-2.5 w-2.5" /> {t('resources.badges.ready')}
        </Badge>
      );
    case 'processing':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-amber-500/10 text-amber-700 border-amber-500/20">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t('resources.badges.processing')}
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-destructive/10 text-destructive border-destructive/20">
          <AlertCircle className="h-2.5 w-2.5" /> {t('resources.badges.failed')}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {t('resources.badges.unknown')}
        </Badge>
      );
  }
}

function ResourceRow({ resource, onOpen, onViewDetails, onRename, onDownload, onDelete, onRetry, isDeleting, isRetrying }: {
  resource: Resource;
  onOpen: () => void;
  onViewDetails: () => void;
  onRename: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRetry: () => void;
  isDeleting: boolean;
  isRetrying: boolean;
}) {
  const { t } = useTranslation();
  const Icon = RESOURCE_ICONS[resource.resourceType] || File;
  const color = RESOURCE_COLORS[resource.resourceType] || 'text-muted-foreground';
  const ContainerIcon = CONTAINER_ICONS[resource.containerType] || Globe;
  const LocationIcon = resource.chatName ? MessageSquare : ContainerIcon;
  const canRetry = resource.canRetry && resource.readiness === 'failed';
  const canDelete = resource.canDelete;
  const canOpen = resource.canOpen && !!resource.containerId;
  const canViewDetails = resource.canViewDetails;
  const canDownload = resource.canDownload && !!resource.storagePath;
  const canRename = resource.canRename;
  const showActions = canOpen || canViewDetails || canDownload || canRetry || canDelete || canRename;
  const isLinkedResource = resource.resourceType === 'link' || resource.sourceType === 'linked';
  const previewImage = resource.mediaThumbnailUrl || resource.previewFaviconUrl;
  const retryLabel = resource.provider === 'youtube' && resource.transcriptStatus === 'failed'
    ? t('resources.actions.retryTranscript')
    : t('resources.actions.retryProcessing');
  const locationText = formatResourceLocation(resource);

  const relativeDate = useMemo(() => {
    const d = new Date(resource.updatedAt);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t('resources.time.justNow');
    if (diffMins < 60) return t('resources.time.minutesAgo', { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('resources.time.hoursAgo', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return t('resources.time.daysAgo', { count: diffDays });
    return d.toLocaleDateString();
  }, [resource.updatedAt, t]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px_220px_100px_100px_40px] gap-3 items-center px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group">
      {/* Resource info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('p-1.5 rounded-md bg-muted shrink-0', color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate" title={resource.title}>
            {truncateFileName(resource.title)}
          </p>
          {resource.mediaChannelName && resource.mediaChannelName.trim().toLowerCase() !== 'youtube' && (
            <p className="text-[11px] text-muted-foreground truncate" title={resource.mediaChannelName}>
              {resource.mediaChannelName}
            </p>
          )}
          {isLinkedResource ? (
            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {previewImage && (
                  <img
                    src={previewImage}
                    alt="site icon"
                    className="h-3.5 w-3.5 rounded-sm shrink-0"
                    loading="lazy"
                  />
                )}
                <p className="text-[11px] text-muted-foreground truncate">
                  {resource.previewDomain || resource.normalizedUrl || resource.linkUrl || t('resources.row.linkedResource')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{resource.sourceType}</Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{formatProvider(resource.provider)}</Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{resource.processingStatus}</Badge>
                {resource.transcriptStatus && resource.transcriptStatus !== 'none' && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t('resources.row.transcriptStatus', { status: resource.transcriptStatus })}</Badge>
                )}
                {resource.isSharedWithMe && (
                  <span className="text-[10px] text-muted-foreground">{t('resources.row.by', { name: resource.ownerDisplayName })}</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground truncate">
              {resource.extension.toUpperCase()} • {formatFileSize(resource.sizeBytes)}
              {resource.isSharedWithMe && (
                <span> • {t('resources.row.by', { name: resource.ownerDisplayName })}</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Type */}
      <div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
          {t(`resources.types.${resource.resourceType}`)}
        </Badge>
      </div>

      {/* Location */}
      <div className="flex items-center gap-1.5 min-w-0">
        <LocationIcon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate" title={locationText}>
          {locationText}
        </span>
      </div>

      {/* Status */}
      <div>
        <ReadinessBadge readiness={resource.readiness} />
      </div>

      {/* Updated */}
      <div className="flex items-center gap-1">
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{relativeDate}</span>
      </div>

      {/* Actions */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        {showActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {canOpen && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onOpen}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('resources.actions.openWorkspace')}
                </DropdownMenuItem>
              )}
              {canViewDetails && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onViewDetails}>
                  <Eye className="h-3.5 w-3.5" />
                  {t('resources.actions.viewDetails')}
                </DropdownMenuItem>
              )}
              {canDownload && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onDownload}>
                  <Download className="h-3.5 w-3.5" />
                  {t('resources.actions.download')}
                </DropdownMenuItem>
              )}
              {canRename && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onRename}>
                  <FileType className="h-3.5 w-3.5" />
                  {t('resources.actions.rename')}
                </DropdownMenuItem>
              )}
              {canRetry && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onRetry} disabled={isRetrying}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {retryLabel}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs gap-2 text-destructive focus:text-destructive"
                    onClick={onDelete}
                    disabled={isDeleting}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('resources.actions.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ hasResources, hasFilters }: { hasResources: boolean; hasFilters: boolean }) {
  const { t } = useTranslation();
  if (hasFilters) {
    return (
      <div className="text-center py-20">
        <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-sm font-medium text-foreground mb-1">{t('resources.empty.noMatches.title')}</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {t('resources.empty.noMatches.description')}
        </p>
      </div>
    );
  }
  return (
    <div className="text-center py-20">
      <Globe className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
      <h3 className="text-sm font-medium text-foreground mb-1">{t('resources.empty.none.title')}</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        {t('resources.empty.none.description')}
      </p>
    </div>
  );
}

function RenameResourceDialog({
  open,
  value,
  currentTitle,
  submitting,
  onOpenChange,
  onValueChange,
  onSubmit,
}: {
  open: boolean;
  value: string;
  currentTitle: string;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('resources.rename.title')}</DialogTitle>
          <DialogDescription>
            {t('resources.rename.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('resources.rename.currentTitle')}</p>
          <p className="text-sm truncate" title={currentTitle}>{currentTitle || t('resources.rename.untitled')}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('resources.rename.newTitle')}</p>
          <Input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={t('resources.rename.placeholder')}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{t('resources.rename.cancel')}</Button>
          <Button onClick={onSubmit} disabled={submitting || !value.trim()}>
            {submitting ? t('resources.rename.submitting') : t('resources.rename.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSourceDialog({
  open,
  url,
  title,
  provider,
  containerType,
  containerId,
  projects,
  notebooks,
  submitting,
  onOpenChange,
  onUrlChange,
  onTitleChange,
  onProviderChange,
  onContainerTypeChange,
  onContainerIdChange,
  onSubmit,
}: {
  open: boolean;
  url: string;
  title: string;
  provider: string;
  containerType: ContainerType;
  containerId: string | null;
  projects: Array<{ id: string; name: string }>;
  notebooks: Array<{ id: string; name: string }>;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onUrlChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onContainerTypeChange: (value: ContainerType) => void;
  onContainerIdChange: (value: string | null) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const targetOptions = containerType === 'project' ? projects : notebooks;

  const IMPLEMENTED_PROVIDERS = new Set(['unknown', 'youtube', 'internal']);

  const providerOptions: Array<{ value: string; labelKey: string; implemented: boolean }> = [
    { value: 'unknown', labelKey: 'anyUrl', implemented: true },
    { value: 'youtube', labelKey: 'youtube', implemented: true },
    { value: 'google_drive', labelKey: 'googleDrive', implemented: false },
    { value: 'dropbox', labelKey: 'dropbox', implemented: false },
    { value: 'notion', labelKey: 'notion', implemented: false },
    { value: 'internal', labelKey: 'internal', implemented: true },
  ];

  const containerLabel = t(`resources.addSourceDialog.locations.${containerType}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{t('resources.addSourceDialog.title')}</DialogTitle>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded-sm">
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                  {t('resources.addSourceDialog.tooltip')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <DialogDescription>
            {t('resources.addSourceDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('resources.addSourceDialog.url')}</p>
          <Input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={t('resources.addSourceDialog.urlPlaceholder')}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('resources.addSourceDialog.titleLabel')}</p>
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t('resources.addSourceDialog.titlePlaceholder')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('resources.addSourceDialog.provider')}</p>
            <Select
              value={provider}
              onValueChange={(v) => {
                if (IMPLEMENTED_PROVIDERS.has(v)) onProviderChange(v);
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={!opt.implemented}
                    className={cn(!opt.implemented && 'opacity-50')}
                  >
                    <span className="flex items-center gap-2">
                      {t(`resources.addSourceDialog.providers.${opt.labelKey}`)}
                      {!opt.implemented && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground border-muted-foreground/30">
                          {t('resources.badges.soon')}
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('resources.addSourceDialog.location')}</p>
            <Select value={containerType} onValueChange={(v) => onContainerTypeChange(v as ContainerType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">{t('resources.addSourceDialog.locations.personal')}</SelectItem>
                <SelectItem value="project">{t('resources.addSourceDialog.locations.project')}</SelectItem>
                <SelectItem value="notebook">{t('resources.addSourceDialog.locations.notebook')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {containerType !== 'personal' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('resources.addSourceDialog.target', { type: containerLabel })}</p>
            <Select value={containerId ?? undefined} onValueChange={(v) => onContainerIdChange(v || null)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={t('resources.addSourceDialog.selectTarget', { type: containerLabel })} />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {t('resources.addSourceDialog.footnote')}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{t('resources.addSourceDialog.cancel')}</Button>
          <Button onClick={onSubmit} disabled={submitting || !url.trim()}>
            {submitting ? t('resources.addSourceDialog.submitting') : t('resources.addSourceDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionRow({ label, enabled }: { label: string; enabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant={enabled ? 'secondary' : 'outline'} className="text-[10px] px-1.5 py-0">
        {enabled ? t('resources.badges.allowed') : t('resources.badges.notAllowed')}
      </Badge>
    </div>
  );
}

function ResourceDetailsDrawer({
  resource,
  open,
  onOpenChange,
  onOpenResource,
  onRename,
  onDownload,
  onRetry,
  onRetryTranscript,
  onDelete,
  onOpenPersonalFallback,
  isRetrying,
  isRetryingTranscript,
  isDeleting,
}: {
  resource: Resource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenResource: (resource: Resource) => void;
  onRename: (resource: Resource) => void;
  onDownload: (resource: Resource) => void;
  onRetry: (resource: Resource) => void;
  onRetryTranscript: (resource: Resource) => void;
  onDelete: (resource: Resource) => void;
  onOpenPersonalFallback: (resource: Resource) => void;
  isRetrying: boolean;
  isRetryingTranscript: boolean;
  isDeleting: boolean;
}) {
  const { t } = useTranslation();
  const resourceId = resource?.id ?? null;
  const [detailsTab, setDetailsTab] = useState<'overview' | 'content'>('overview');

  // Determine resource category
  const isVideo = resource?.provider === 'youtube' || !!resource?.transcriptStatus;
  const isDocument = !isVideo && resource?.resourceKind === 'document';
  const showContentTab = isVideo || isDocument;

  // Video transcript data
  const transcriptPreviewEnabled = !!resource && isVideo && resource.transcriptStatus === 'ready';
  const { data: transcriptPreviewChunks = [], isLoading: isTranscriptPreviewLoading } = useResourceTranscriptPreview(
    isVideo ? resourceId : null,
    transcriptPreviewEnabled && open,
  );
  const { data: transcriptDebug } = useResourceTranscriptDebug(
    isVideo ? resourceId : null,
    !!resource && isVideo && open,
  );

  // Document extracted text data
  const extractedTextEnabled = !!resource && isDocument && open;
  const { data: extractedTextResult, isLoading: isExtractedTextLoading } = useResourceExtractedText(
    isDocument ? resourceId : null,
    extractedTextEnabled,
  );

  useEffect(() => {
    setDetailsTab('overview');
  }, [resourceId, open]);

  if (!resource) return null;

  const canOpenWorkspace = resource.canOpen && !!resource.containerId;
  const canFallbackPersonalOpen = resource.containerType === 'personal';
  const canRetryTranscript = resource.provider === 'youtube' && resource.transcriptStatus === 'failed';
  const locationText = formatResourceLocation(resource);
  const contentTabLabel = isVideo ? t('resources.drawer.tabs.transcript') : t('resources.drawer.tabs.extractedText');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 overflow-hidden">
        <div className="h-full flex flex-col">
          <SheetHeader className="px-6 py-4 border-b border-border text-left">
            <SheetTitle className="pr-10 truncate">{resource.title}</SheetTitle>
            <SheetDescription>
              {locationText} • {resource.ownerDisplayName}
            </SheetDescription>
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t(`resources.types.${resource.resourceType}`)}</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{resource.sourceType}</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{formatProvider(resource.provider)}</Badge>
              <ReadinessBadge readiness={resource.readiness} />
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="px-6 py-4">
              <Tabs value={detailsTab} onValueChange={(value) => setDetailsTab(value as 'overview' | 'content')}>
                <TabsList className="h-8 p-0.5">
                  <TabsTrigger value="overview" className="text-xs h-7 px-3">{t('resources.drawer.tabs.overview')}</TabsTrigger>
                  {showContentTab && (
                    <TabsTrigger value="content" className="text-xs h-7 px-3">{contentTabLabel}</TabsTrigger>
                  )}
                </TabsList>

                {/* ═══ OVERVIEW TAB ═══ */}
                <TabsContent value="overview" className="mt-3 space-y-5">
                  {/* Preview / Thumbnail */}
                  {resource.mediaThumbnailUrl && (
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <img
                        src={resource.mediaThumbnailUrl}
                        alt="media thumbnail"
                        className="w-full h-auto max-h-48 object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}

                  {/* Summary */}
                  {resource.summary && (
                    <section className="space-y-1.5">
                      <h3 className="text-sm font-medium">{t('resources.drawer.sections.summary')}</h3>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{resource.summary}</p>
                    </section>
                  )}

                  {/* Metadata */}
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">{t('resources.drawer.sections.metadata')}</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <MetaCell label="Resource ID" value={resource.id} mono />
                      <MetaCell label="File size" value={formatFileSize(resource.sizeBytes)} />
                      <MetaCell label="MIME type" value={resource.mimeType || 'Unknown'} breakAll />
                      <MetaCell label="Extension" value={resource.extension.toUpperCase()} />
                      <MetaCell label="Source type" value={resource.sourceType} />
                      <MetaCell label="Provider" value={formatProvider(resource.provider)} />
                      <MetaCell label="Uploaded" value={formatTimestamp(resource.uploadedAt)} />
                      <MetaCell label="Last updated" value={formatTimestamp(resource.updatedAt)} />
                      <MetaCell label="Location" value={locationText} span={2} />
                      <MetaCell label="Owner" value={resource.ownerDisplayName} span={2} />
                      {resource.linkUrl && (
                        <div className="rounded-md border border-border/60 p-2 col-span-2">
                          <p className="text-muted-foreground">Original URL</p>
                          <a href={resource.linkUrl} target="_blank" rel="noopener noreferrer"
                            className="mt-1 block text-primary underline break-all">{resource.linkUrl}</a>
                        </div>
                      )}
                      {resource.previewTitle && <MetaCell label="Preview title" value={resource.previewTitle} span={2} />}
                      {(resource.previewDomain || resource.previewFaviconUrl) && (
                        <div className="rounded-md border border-border/60 p-2 col-span-2">
                          <p className="text-muted-foreground">Preview domain</p>
                          <div className="mt-1 flex items-center gap-2 min-w-0">
                            {resource.previewFaviconUrl && (
                              <img src={resource.previewFaviconUrl} alt="site icon" className="h-4 w-4 rounded-sm shrink-0" loading="lazy" />
                            )}
                            <p className="truncate">{resource.previewDomain || 'Unknown domain'}</p>
                          </div>
                        </div>
                      )}
                      {/* Video-specific metadata in overview */}
                      {resource.mediaVideoId && <MetaCell label="Video ID" value={resource.mediaVideoId} mono />}
                      {resource.mediaChannelName && <MetaCell label="Channel" value={resource.mediaChannelName} />}
                      {resource.mediaDurationSeconds !== null && (
                        <MetaCell label="Duration" value={`${Math.floor((resource.mediaDurationSeconds || 0) / 60)}m ${(resource.mediaDurationSeconds || 0) % 60}s`} />
                      )}
                    </div>
                  </section>

                  {/* Processing */}
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">{t('resources.drawer.sections.processing')}</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <MetaCell label="Status" value={resource.processingStatus} />
                      <MetaCell label="Language" value={resource.detectedLanguage || 'Unknown'} />
                      {resource.pageCount !== null && <MetaCell label="Page count" value={String(resource.pageCount)} />}
                      {resource.wordCount !== null && <MetaCell label="Word count" value={String(resource.wordCount)} />}
                      {resource.processingError && (
                        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 col-span-2">
                          <p className="text-muted-foreground">Processing error</p>
                          <p className="mt-1 text-destructive break-words">{resource.processingError}</p>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Permissions */}
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">{t('resources.drawer.sections.permissions')}</h3>
                    <div className="grid grid-cols-1 gap-2">
                      <PermissionRow label={t('resources.drawer.permissions.open')} enabled={resource.canOpen} />
                      <PermissionRow label={t('resources.drawer.permissions.viewDetails')} enabled={resource.canViewDetails} />
                      <PermissionRow label={t('resources.drawer.permissions.download')} enabled={resource.canDownload} />
                      <PermissionRow label={t('resources.drawer.permissions.rename')} enabled={resource.canRename} />
                      <PermissionRow label={t('resources.drawer.permissions.delete')} enabled={resource.canDelete} />
                      <PermissionRow label={t('resources.drawer.permissions.retryProcessing')} enabled={resource.canRetry} />
                    </div>
                  </section>
                </TabsContent>

                {/* ═══ CONTENT TAB (Transcript / Extracted Text) ═══ */}
                {showContentTab && (
                  <TabsContent value="content" className="mt-3 space-y-3">
                    {isVideo ? (
                      <VideoContentTab
                        resource={resource}
                        chunks={transcriptPreviewChunks}
                        isLoading={isTranscriptPreviewLoading}
                        debug={transcriptDebug ?? null}
                      />
                    ) : isDocument ? (
                      <DocumentContentTab
                        resource={resource}
                        extractedText={extractedTextResult}
                        isLoading={isExtractedTextLoading}
                      />
                    ) : null}
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </ScrollArea>

          <div className="border-t border-border px-6 py-3 flex items-center gap-2 flex-wrap">
            {canOpenWorkspace && (
              <Button size="sm" className="gap-1.5" onClick={() => onOpenResource(resource)}>
                <ExternalLink className="h-3.5 w-3.5" /> {t('resources.actions.openWorkspace')}
              </Button>
            )}
            {!canOpenWorkspace && canFallbackPersonalOpen && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenPersonalFallback(resource)}>
                <Globe className="h-3.5 w-3.5" /> {t('resources.actions.viewInPersonal')}
              </Button>
            )}
            {resource.canDownload && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onDownload(resource)}>
                <Download className="h-3.5 w-3.5" /> {t('resources.actions.download')}
              </Button>
            )}
            {resource.canRename && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRename(resource)}>
                <FileType className="h-3.5 w-3.5" /> {t('resources.actions.rename')}
              </Button>
            )}
            {resource.canRetry && resource.readiness === 'failed' && !canRetryTranscript && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(resource)} disabled={isRetrying}>
                <RotateCcw className="h-3.5 w-3.5" /> {t('resources.actions.retry')}
              </Button>
            )}
            {canRetryTranscript && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetryTranscript(resource)} disabled={isRetryingTranscript}>
                <RotateCcw className="h-3.5 w-3.5" /> {t('resources.actions.retryTranscript')}
              </Button>
            )}
            {resource.canDelete && (
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-destructive border-destructive/30 hover:text-destructive"
                onClick={() => onDelete(resource)} disabled={isDeleting}
              >
                <Trash2 className="h-3.5 w-3.5" /> {t('resources.actions.delete')}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Shared detail cell component ── */
function MetaCell({ label, value, mono, breakAll, span }: {
  label: string; value: string; mono?: boolean; breakAll?: boolean; span?: number;
}) {
  return (
    <div className={cn("rounded-md border border-border/60 p-2", span === 2 && "col-span-2")}>
      <p className="text-muted-foreground">{label}</p>
      <p className={cn("mt-1", mono && "font-mono break-all", breakAll && "break-all")}>{value}</p>
    </div>
  );
}

/* ── Content status banner ── */
function ContentStatusBanner({ status, error, type }: { status: string; error?: string | null; type: 'transcript' | 'extraction' }) {
  const label = type === 'transcript' ? 'Transcript' : 'Extraction';
  return (
    <div className="rounded-md border border-border/60 p-3 text-xs space-y-1">
      <p className="text-muted-foreground">{label} status</p>
      <p className="font-medium">{status}</p>
      {error && <p className="text-destructive break-words">{error}</p>}
    </div>
  );
}

/* ── Transcript Debug Section ── */
function TranscriptDebugSection({ debug }: { debug: TranscriptDebugPayload | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!debug) {
    return (
      <div className="rounded-md border border-border/40 p-3 text-xs text-muted-foreground">
        No debug diagnostics available for this transcript attempt.
      </div>
    );
  }

  function maskKey(key: string | null | undefined): string {
    if (!key) return '—';
    if (key.length <= 10) return key;
    return key.slice(0, 6) + '••••' + key.slice(-4);
  }

  return (
    <div className="rounded-md border border-border/60 p-3 text-xs space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground font-medium w-full text-left"
      >
        <ScanText className="h-3.5 w-3.5" />
        Debug diagnostics
        <span className="ml-auto text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-1.5">
            <MetaCell label="Winning strategy" value={debug.winningStrategy || 'none (all failed)'} />
            <MetaCell label="Processing duration" value={`${debug.totalDurationMs}ms`} />
            <MetaCell label="Page variants tried" value={debug.pageVariantsAttempted.length > 0 ? debug.pageVariantsAttempted.join(', ') : 'none'} />
            <MetaCell label="Env key present" value={debug.envInnertubeKeyPresent ? 'Yes' : 'No'} />
            <MetaCell label="Fallback search attempted" value={debug.serpapiAttempted ? 'Yes' : 'No'} />
            <MetaCell label="Fallback search language" value={debug.serpapiLanguageCode || 'Unknown'} />
            {debug.serpapiSearchId && <MetaCell label="Fallback search id" value={debug.serpapiSearchId} mono />}
          </div>

          {debug.serpapiError && (
            <div className="rounded bg-muted/50 p-2 space-y-0.5">
              <p className="text-muted-foreground">Fallback search error</p>
              <p className="text-[11px] break-all">{debug.serpapiError}</p>
            </div>
          )}

          {debug.pageExtractedInnertubeKey && (
            <div className="rounded bg-muted/50 p-2 space-y-0.5">
              <p className="text-muted-foreground">Page-extracted INNERTUBE_API_KEY</p>
              <p className="font-mono text-[11px] break-all">{debug.pageExtractedInnertubeKey}</p>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Stages</p>
            {debug.stages.map((s, i) => (
              <div key={i} className="flex items-start gap-2 rounded bg-muted/30 p-1.5">
                <span className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0',
                  s.status === 'success' ? 'bg-emerald-500' : s.status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground'
                )} />
                <div className="min-w-0">
                  <span className="font-medium">{s.stage}</span>
                  {s.pageVariant && <span className="text-muted-foreground ml-1">({s.pageVariant})</span>}
                  <span className={cn('ml-1.5', s.status === 'success' ? 'text-emerald-600' : 'text-muted-foreground')}>
                    {s.status}
                  </span>
                  {s.reason && <p className="text-muted-foreground break-words">{s.reason}</p>}
                  {s.trackCount !== undefined && <span className="text-muted-foreground ml-1">tracks: {s.trackCount}</span>}
                  {s.chosenLang && <span className="text-muted-foreground ml-1">lang: {s.chosenLang}</span>}
                  {s.chosenKind && <span className="text-muted-foreground ml-1">kind: {s.chosenKind}</span>}
                  {s.innertubeKeySource && (
                    <span className="text-muted-foreground ml-1">
                      key: {s.innertubeKeySource === 'page_extracted' ? (s.innertubeKey || '—') : maskKey(s.innertubeKey)}
                      ({s.innertubeKeySource})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Video Content Tab ── */
function VideoContentTab({
  resource, chunks, isLoading, debug,
}: {
  resource: Resource;
  chunks: { chunkIndex: number; chunkText: string; tokenCount: number; matchRank: number | null }[];
  isLoading: boolean;
  debug: TranscriptDebugPayload | null;
}) {
  const transcriptText = chunks
    .slice()
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((chunk) => chunk.chunkText)
    .join('\n\n')
    .trim();

  return (
    <>
      <ContentStatusBanner status={resource.transcriptStatus || 'none'} error={resource.transcriptError} type="transcript" />

      {/* Transcript metadata */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {resource.mediaChannelName && <MetaCell label="Channel" value={resource.mediaChannelName} />}
        {resource.mediaDurationSeconds !== null && (
          <MetaCell label="Duration" value={`${Math.floor((resource.mediaDurationSeconds || 0) / 60)}m ${(resource.mediaDurationSeconds || 0) % 60}s`} />
        )}
      </div>

      {resource.transcriptStatus === 'ready' ? (
        <>
          <ContentTranscriptBlock transcriptText={transcriptText} isLoading={isLoading} emptyMessage="No transcript text available." />
          <TranscriptDebugSection debug={debug} />
        </>
      ) : resource.transcriptStatus === 'failed' ? (
        <>
          <ContentFailedBlock
            title="Transcript fetch failed"
            error={resource.transcriptError || resource.processingError}
            hint="Use Retry transcript to queue another attempt."
          />
          <TranscriptDebugSection debug={debug} />
        </>
      ) : resource.transcriptStatus === 'queued' || resource.transcriptStatus === 'running' ? (
        <ContentProcessingBlock message="Transcript ingestion is in progress. This tab will populate when processing is complete." />
      ) : (
        <ContentEmptyBlock message="Transcript is not available for this resource yet." />
      )}
    </>
  );
}

function ContentTranscriptBlock({
  transcriptText,
  isLoading,
  emptyMessage,
}: {
  transcriptText: string;
  isLoading: boolean;
  emptyMessage: string;
}) {
  if (isLoading) {
    return (
      <div className="py-6 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!transcriptText) {
    return <ContentEmptyBlock message={emptyMessage} />;
  }

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/60">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ScanText className="h-3.5 w-3.5" />
          <span>Transcript text</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{transcriptText.length.toLocaleString()} chars</span>
      </div>
      <div className="max-h-[400px] overflow-y-auto p-3">
        <pre className="text-xs whitespace-pre-wrap leading-relaxed font-sans">{transcriptText}</pre>
      </div>
    </div>
  );
}

/* ── Document Content Tab ── */
function DocumentContentTab({
  resource, extractedText, isLoading,
}: {
  resource: Resource;
  extractedText: import('@/hooks/useResourceExtractedText').ExtractedTextResult | null | undefined;
  isLoading: boolean;
}) {
  const processingInProgress = ['uploaded', 'extracting_metadata', 'extracting_content', 'detecting_language',
    'summarizing', 'indexing', 'chunking', 'generating_embeddings', 'generating_chunk_questions',
    'pending', 'queued', 'claimed', 'running', 'waiting_retry'].includes(resource.processingStatus);

  const extractionStatus = extractedText?.extractorStatus || (extractedText?.extractedText ? 'completed' : resource.processingStatus);

  return (
    <>
      <ContentStatusBanner status={extractionStatus} error={resource.processingError} type="extraction" />

      {/* Extraction metadata */}
      {extractedText && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetaCell label="OCR applied" value={extractedText.ocrUsed ? 'Yes' : 'No'} />
          {extractedText.extractorSelected && <MetaCell label="Extraction method" value={extractedText.extractorSelected} />}
          {extractedText.textLength > 0 && <MetaCell label="Text length" value={`${extractedText.textLength.toLocaleString()} chars`} />}
          {resource.wordCount !== null && <MetaCell label="Word count" value={String(resource.wordCount)} />}
          {resource.pageCount !== null && <MetaCell label="Page count" value={String(resource.pageCount)} />}
          {extractedText.qualityReason && <MetaCell label="Quality" value={extractedText.qualityReason} />}
        </div>
      )}

      {isLoading ? (
        <div className="py-10 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : resource.processingStatus === 'failed' ? (
        <>
          <ContentFailedBlock
            title="Text extraction failed"
            error={resource.processingError}
            hint={resource.canRetry ? "Use Retry to queue another attempt." : undefined}
          />
          <DocumentDebugSection debug={extractedText?.debug ?? null} />
        </>
      ) : processingInProgress ? (
        <>
          <ContentProcessingBlock message="Document extraction is in progress. Extracted text will appear here when processing is complete." />
          <DocumentDebugSection debug={extractedText?.debug ?? null} />
        </>
      ) : extractedText?.extractedText ? (
        <>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/60">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ScanText className="h-3.5 w-3.5" />
                <span>Extracted text</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{extractedText.textLength.toLocaleString()} chars</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-3">
              <pre className="text-xs whitespace-pre-wrap leading-relaxed font-sans">{extractedText.extractedText}</pre>
            </div>
          </div>
          <DocumentDebugSection debug={extractedText?.debug ?? null} />
        </>
      ) : (
        <>
          <ContentEmptyBlock message="No extracted text available for this document." />
          <DocumentDebugSection debug={extractedText?.debug ?? null} />
        </>
      )}
    </>
  );
}

function DocumentDebugSection({
  debug,
}: {
  debug: import('@/hooks/useResourceExtractedText').DocumentProcessingDebugPayload | null;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!debug) {
    return (
      <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
        No debug diagnostics available for this extraction attempt.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60 p-3 text-xs space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground font-medium w-full text-left"
      >
        <ScanText className="h-3.5 w-3.5" />
        Debug diagnostics
        <span className="ml-auto text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <MetaCell label="File category" value={debug.normalizedFileCategory || 'unknown'} />
            <MetaCell label="Extractor" value={debug.extractorSelected || 'unknown'} />
            <MetaCell label="Extractor status" value={debug.extractorStatus || 'unknown'} />
            <MetaCell label="Last completed stage" value={debug.lastCompletedStage || 'none'} />
            {debug.qualityScore !== null && <MetaCell label="Quality score" value={String(debug.qualityScore)} />}
            {debug.qualityReason && <MetaCell label="Quality reason" value={debug.qualityReason} />}
            {debug.extractedCharCount !== null && <MetaCell label="Extracted chars" value={String(debug.extractedCharCount)} />}
            {debug.structuralNoiseRatio !== null && <MetaCell label="Structural noise ratio" value={String(debug.structuralNoiseRatio)} />}
            {debug.structuralNoiseFiltered !== null && <MetaCell label="Structural noise filtered" value={debug.structuralNoiseFiltered ? 'Yes' : 'No'} />}
            {debug.pdfTextStatus && <MetaCell label="PDF text status" value={debug.pdfTextStatus} />}
            {debug.inspectionMethod && <MetaCell label="Inspection method" value={debug.inspectionMethod} />}
            {debug.ocrPdfStatus && <MetaCell label="OCR PDF status" value={debug.ocrPdfStatus} />}
            {debug.ocrPdfEngine && <MetaCell label="OCR PDF engine" value={debug.ocrPdfEngine} />}
            {debug.ocrPdfConfidence !== null && <MetaCell label="OCR PDF confidence" value={String(debug.ocrPdfConfidence)} />}
            {debug.ocrImageStatus && <MetaCell label="OCR image status" value={debug.ocrImageStatus} />}
            {debug.ocrImageEngine && <MetaCell label="OCR image engine" value={debug.ocrImageEngine} />}
          </div>

          {(debug.extractionWarnings || debug.inspectionWarning || debug.ocrPdfWarning || debug.ocrImageWarning) && (
            <div className="space-y-1 text-[11px]">
              <p className="text-muted-foreground font-medium">Warnings</p>
              {debug.extractionWarnings && <p className="text-muted-foreground break-words">• {debug.extractionWarnings}</p>}
              {debug.inspectionWarning && <p className="text-muted-foreground break-words">• {debug.inspectionWarning}</p>}
              {debug.ocrPdfWarning && <p className="text-muted-foreground break-words">• {debug.ocrPdfWarning}</p>}
              {debug.ocrImageWarning && <p className="text-muted-foreground break-words">• {debug.ocrImageWarning}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Shared content state blocks ── */
function ContentChunkList({ chunks, isLoading, emptyMessage }: {
  chunks: { chunkIndex: number; chunkText: string; tokenCount: number }[];
  isLoading: boolean;
  emptyMessage: string;
}) {
  if (isLoading) {
    return (
      <div className="py-6 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (chunks.length === 0) {
    return <ContentEmptyBlock message={emptyMessage} />;
  }
  return (
    <div className="space-y-2">
      {chunks.slice(0, 20).map((chunk) => (
        <div key={`${chunk.chunkIndex}-${chunk.chunkText.slice(0, 16)}`} className="rounded-md border border-border/60 p-3 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Chunk {chunk.chunkIndex + 1}</span>
            <span>{chunk.tokenCount} tokens</span>
          </div>
          <p className="text-xs whitespace-pre-wrap leading-relaxed">{chunk.chunkText}</p>
        </div>
      ))}
    </div>
  );
}

function ContentFailedBlock({ title, error, hint }: { title: string; error?: string | null; hint?: string }) {
  return (
    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs space-y-1.5">
      <p className="font-medium text-destructive">{title}</p>
      {error ? (
        <p className="text-destructive/90 break-words">{error}</p>
      ) : (
        <p className="text-destructive/70">No additional error details available.</p>
      )}
      {hint && <p className="text-muted-foreground pt-1">{hint}</p>}
    </div>
  );
}

function ContentProcessingBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs flex items-center gap-2">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function ContentEmptyBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
      {message}
    </div>
  );
}
