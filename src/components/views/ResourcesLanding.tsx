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
import {
  type Resource, type ResourceType, type ReadinessStatus, type ContainerType,
  RESOURCE_TYPE_LABELS, formatFileSize, truncateFileName, formatResourceLocation
} from '@/lib/resourceClassification';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

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
              <h1 className="text-lg font-semibold text-foreground">Resources</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              All documents and resources across your projects and notebooks
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
              <Plus className="h-3.5 w-3.5" /> Add source
            </Button>
          </div>
        </div>

        {/* ── Summary stats ───────────────────────────────────── */}
        <div className="flex items-center gap-5 flex-wrap">
          <StatPill label="Total" value={totalCount} />
          <StatPill label="Ready" value={readyCount} variant="success" />
          <StatPill label="Processing" value={processingCount} variant="warning" />
          {failedCount > 0 && <StatPill label="Failed" value={failedCount} variant="error" />}
          <div className="h-4 w-px bg-border" />
          <StatPill label="Mine" value={myCount} />
          {sharedCount > 0 && <StatPill label="Shared" value={sharedCount} variant="info" />}
        </div>
      </div>

      {/* ── Controls ──────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-border bg-muted/30 shrink-0 space-y-3">
        {/* Row 1: Search + Sort */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search resources…"
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
              <SelectItem value="newest">Last updated (newest)</SelectItem>
              <SelectItem value="oldest">Last updated (oldest)</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="type">Type</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Row 2: Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

          {/* Ownership */}
          <Tabs value={ownershipFilter} onValueChange={(v) => setOwnershipFilter(v as OwnershipFilter)}>
            <TabsList className="h-7 p-0.5">
              <TabsTrigger value="all" className="text-xs px-2.5 h-6">All</TabsTrigger>
              <TabsTrigger value="mine" className="text-xs px-2.5 h-6">Mine</TabsTrigger>
              <TabsTrigger value="shared" className="text-xs px-2.5 h-6">Shared</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="h-4 w-px bg-border" />

          {/* Status */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[120px] h-7 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          {/* Type */}
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
            <SelectTrigger className="w-[130px] h-7 text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {activeResourceTypes.map(t => (
                <SelectItem key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Container */}
          <Select value={containerFilter} onValueChange={(v) => setContainerFilter(v as ContainerFilter)}>
            <SelectTrigger className="w-[130px] h-7 text-xs">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              <SelectItem value="project">Projects</SelectItem>
              <SelectItem value="notebook">Notebooks</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
              onClick={() => { setSearch(''); setOwnershipFilter('all'); setStatusFilter('all'); setTypeFilter('all'); setContainerFilter('all'); }}
            >
              <X className="h-3 w-3" /> Clear
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
                <span>Resource</span>
                <span>Type</span>
                <span>Location</span>
                <span>Status</span>
                <span>Updated</span>
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
  switch (readiness) {
    case 'ready':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 border-green-500/20">
          <CheckCircle2 className="h-2.5 w-2.5" /> Ready
        </Badge>
      );
    case 'processing':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-amber-500/10 text-amber-700 border-amber-500/20">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> Processing
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-destructive/10 text-destructive border-destructive/20">
          <AlertCircle className="h-2.5 w-2.5" /> Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          Unknown
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
    ? 'Retry transcript'
    : 'Retry processing';
  const locationText = formatResourceLocation(resource);

  const relativeDate = useMemo(() => {
    const d = new Date(resource.updatedAt);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }, [resource.updatedAt]);

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
                  {resource.previewDomain || resource.normalizedUrl || resource.linkUrl || 'Linked resource'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{resource.sourceType}</Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{formatProvider(resource.provider)}</Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{resource.processingStatus}</Badge>
                {resource.transcriptStatus && resource.transcriptStatus !== 'none' && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">transcript {resource.transcriptStatus}</Badge>
                )}
                {resource.isSharedWithMe && (
                  <span className="text-[10px] text-muted-foreground">by {resource.ownerDisplayName}</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground truncate">
              {resource.extension.toUpperCase()} • {formatFileSize(resource.sizeBytes)}
              {resource.isSharedWithMe && (
                <span> • by {resource.ownerDisplayName}</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Type */}
      <div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
          {RESOURCE_TYPE_LABELS[resource.resourceType]}
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
                  Open workspace
                </DropdownMenuItem>
              )}
              {canViewDetails && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onViewDetails}>
                  <Eye className="h-3.5 w-3.5" />
                  View details
                </DropdownMenuItem>
              )}
              {canDownload && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onDownload}>
                  <Download className="h-3.5 w-3.5" />
                  Download
                </DropdownMenuItem>
              )}
              {canRename && (
                <DropdownMenuItem className="text-xs gap-2" onClick={onRename}>
                  <FileType className="h-3.5 w-3.5" />
                  Rename
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
                    Delete
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
  if (hasFilters) {
    return (
      <div className="text-center py-20">
        <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-sm font-medium text-foreground mb-1">No matching resources</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Try adjusting your filters or search query to find what you're looking for.
        </p>
      </div>
    );
  }
  return (
    <div className="text-center py-20">
      <Globe className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
      <h3 className="text-sm font-medium text-foreground mb-1">No resources yet</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Upload documents to your projects or notebooks to see them here. Resources from shared workspaces will also appear once available.
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename resource</DialogTitle>
          <DialogDescription>
            Update the resource title shown across Resources and related workspaces.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Current title</p>
          <p className="text-sm truncate" title={currentTitle}>{currentTitle || 'Untitled resource'}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">New title</p>
          <Input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Enter new title"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={onSubmit} disabled={submitting || !value.trim()}>
            {submitting ? 'Renaming...' : 'Rename'}
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
  const targetOptions = containerType === 'project' ? projects : notebooks;

  const IMPLEMENTED_PROVIDERS = new Set(['unknown', 'youtube', 'internal']);

  const providerOptions: Array<{ value: string; label: string; implemented: boolean }> = [
    { value: 'unknown', label: 'Any URL', implemented: true },
    { value: 'youtube', label: 'YouTube', implemented: true },
    { value: 'google_drive', label: 'Google Drive', implemented: false },
    { value: 'dropbox', label: 'Dropbox', implemented: false },
    { value: 'notion', label: 'Notion', implemented: false },
    { value: 'internal', label: 'Internal', implemented: true },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Add source</DialogTitle>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded-sm">
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                  Add a specific URL or supported source now so it appears in Resources immediately. Some providers support richer enrichment. Unavailable providers are marked Soon.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <DialogDescription>
            Add a URL or supported source so content can appear in Resources.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">URL</p>
          <Input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://example.com/resource"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Title (optional)</p>
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Readable resource title"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Provider</p>
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
                      {opt.label}
                      {!opt.implemented && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground border-muted-foreground/30">
                          Soon
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Location</p>
            <Select value={containerType} onValueChange={(v) => onContainerTypeChange(v as ContainerType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="notebook">Notebook</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {containerType !== 'personal' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Target {containerType}</p>
            <Select value={containerId ?? undefined} onValueChange={(v) => onContainerIdChange(v || null)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={`Select a ${containerType}`} />
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
          Supported sources are available now. Others are marked Soon.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={onSubmit} disabled={submitting || !url.trim()}>
            {submitting ? 'Adding...' : 'Add source'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant={enabled ? 'secondary' : 'outline'} className="text-[10px] px-1.5 py-0">
        {enabled ? 'Allowed' : 'Not allowed'}
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
  const resourceId = resource?.id ?? null;
  const [detailsTab, setDetailsTab] = useState<'overview' | 'transcript'>('overview');
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const showTranscriptTab = resource?.provider === 'youtube' || !!resource?.transcriptStatus;
  const transcriptPreviewEnabled = !!resource && showTranscriptTab && resource.transcriptStatus === 'ready';
  const { data: transcriptPreviewChunks = [], isLoading: isTranscriptPreviewLoading } = useResourceTranscriptPreview(
    resourceId,
    transcriptQuery,
    transcriptPreviewEnabled && open,
  );

  useEffect(() => {
    setDetailsTab('overview');
    setTranscriptQuery('');
  }, [resourceId, open]);

  if (!resource) return null;

  const canOpenWorkspace = resource.canOpen && !!resource.containerId;
  const canFallbackPersonalOpen = resource.containerType === 'personal';
  const canRetryTranscript = resource.provider === 'youtube' && resource.transcriptStatus === 'failed';
  const locationText = formatResourceLocation(resource);

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
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{RESOURCE_TYPE_LABELS[resource.resourceType]}</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{resource.sourceType}</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{formatProvider(resource.provider)}</Badge>
              <ReadinessBadge readiness={resource.readiness} />
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="px-6 py-4">
              <Tabs value={detailsTab} onValueChange={(value) => setDetailsTab(value as 'overview' | 'transcript')}>
                <TabsList className="h-8 p-0.5">
                  <TabsTrigger value="overview" className="text-xs h-7 px-3">Overview</TabsTrigger>
                  {showTranscriptTab && <TabsTrigger value="transcript" className="text-xs h-7 px-3">Transcript</TabsTrigger>}
                </TabsList>

                <TabsContent value="overview" className="mt-3 space-y-5">
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Metadata</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Resource ID</p>
                    <p className="font-mono break-all mt-1">{resource.id}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">File size</p>
                    <p className="mt-1">{formatFileSize(resource.sizeBytes)}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">MIME type</p>
                    <p className="mt-1 break-all">{resource.mimeType || 'Unknown'}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Extension</p>
                    <p className="mt-1">{resource.extension.toUpperCase()}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Source type</p>
                    <p className="mt-1">{resource.sourceType}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Provider</p>
                    <p className="mt-1">{formatProvider(resource.provider)}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Uploaded</p>
                    <p className="mt-1">{formatTimestamp(resource.uploadedAt)}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Last updated</p>
                    <p className="mt-1">{formatTimestamp(resource.updatedAt)}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2 col-span-2">
                    <p className="text-muted-foreground">Location</p>
                    <p className="mt-1">
                      {locationText}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2 col-span-2">
                    <p className="text-muted-foreground">Owner</p>
                    <p className="mt-1">{resource.ownerDisplayName}</p>
                  </div>
                  {resource.linkUrl && (
                    <div className="rounded-md border border-border/60 p-2 col-span-2">
                      <p className="text-muted-foreground">Original URL</p>
                      <a
                        href={resource.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block text-primary underline break-all"
                      >
                        {resource.linkUrl}
                      </a>
                    </div>
                  )}
                  {resource.normalizedUrl && (
                    <div className="rounded-md border border-border/60 p-2 col-span-2">
                      <p className="text-muted-foreground">Normalized URL</p>
                      <p className="mt-1 break-all">{resource.normalizedUrl}</p>
                    </div>
                  )}
                  {resource.previewTitle && (
                    <div className="rounded-md border border-border/60 p-2 col-span-2">
                      <p className="text-muted-foreground">Preview title</p>
                      <p className="mt-1">{resource.previewTitle}</p>
                    </div>
                  )}
                  {(resource.previewDomain || resource.previewFaviconUrl) && (
                    <div className="rounded-md border border-border/60 p-2 col-span-2">
                      <p className="text-muted-foreground">Preview domain</p>
                      <div className="mt-1 flex items-center gap-2 min-w-0">
                        {resource.previewFaviconUrl && (
                          <img
                            src={resource.previewFaviconUrl}
                            alt="site icon"
                            className="h-4 w-4 rounded-sm shrink-0"
                            loading="lazy"
                          />
                        )}
                        <p className="truncate">{resource.previewDomain || 'Unknown domain'}</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Processing</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Status</p>
                    <p className="mt-1">{resource.processingStatus}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Language</p>
                    <p className="mt-1">{resource.detectedLanguage || 'Unknown'}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Page count</p>
                    <p className="mt-1">{resource.pageCount ?? 'N/A'}</p>
                  </div>
                  <div className="rounded-md border border-border/60 p-2">
                    <p className="text-muted-foreground">Word count</p>
                    <p className="mt-1">{resource.wordCount ?? 'N/A'}</p>
                  </div>
                  {resource.processingError && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 col-span-2">
                      <p className="text-muted-foreground">Processing error</p>
                      <p className="mt-1 text-destructive break-words">{resource.processingError}</p>
                    </div>
                  )}
                  {resource.summary && (
                    <div className="rounded-md border border-border/60 p-2 col-span-2">
                      <p className="text-muted-foreground">Summary</p>
                      <p className="mt-1 whitespace-pre-wrap">{resource.summary}</p>
                    </div>
                  )}
                </div>
              </section>

              {(resource.mediaVideoId || resource.mediaChannelName || resource.mediaThumbnailUrl || resource.transcriptStatus) && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Media</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {resource.mediaVideoId && (
                      <div className="rounded-md border border-border/60 p-2">
                        <p className="text-muted-foreground">Video ID</p>
                        <p className="mt-1 font-mono break-all">{resource.mediaVideoId}</p>
                      </div>
                    )}
                    {resource.mediaChannelName && (
                      <div className="rounded-md border border-border/60 p-2">
                        <p className="text-muted-foreground">Channel</p>
                        <p className="mt-1">{resource.mediaChannelName}</p>
                      </div>
                    )}
                    {resource.mediaDurationSeconds !== null && (
                      <div className="rounded-md border border-border/60 p-2">
                        <p className="text-muted-foreground">Duration (seconds)</p>
                        <p className="mt-1">{resource.mediaDurationSeconds}</p>
                      </div>
                    )}
                    {resource.transcriptStatus && (
                      <div className="rounded-md border border-border/60 p-2">
                        <p className="text-muted-foreground">Transcript status</p>
                        <p className="mt-1">{resource.transcriptStatus}</p>
                      </div>
                    )}
                    {resource.transcriptError && (
                      <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 col-span-2">
                        <p className="text-muted-foreground">Transcript error</p>
                        <p className="mt-1 text-destructive break-words">{resource.transcriptError}</p>
                      </div>
                    )}
                    {resource.transcriptStatus === 'ready' && (
                      <div className="rounded-md border border-green-500/20 bg-green-500/5 p-2 col-span-2">
                        <p className="text-muted-foreground">Transcript</p>
                        <p className="mt-1 text-green-700">Available</p>
                      </div>
                    )}
                    {resource.mediaThumbnailUrl && (
                      <div className="rounded-md border border-border/60 p-2 col-span-2">
                        <p className="text-muted-foreground">Thumbnail</p>
                        <img
                          src={resource.mediaThumbnailUrl}
                          alt="media thumbnail"
                          className="mt-2 h-24 w-auto rounded-md border border-border/60"
                          loading="lazy"
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Permissions</h3>
                <div className="grid grid-cols-1 gap-2">
                  <PermissionRow label="Open" enabled={resource.canOpen} />
                  <PermissionRow label="View details" enabled={resource.canViewDetails} />
                  <PermissionRow label="Download" enabled={resource.canDownload} />
                  <PermissionRow label="Rename" enabled={resource.canRename} />
                  <PermissionRow label="Delete" enabled={resource.canDelete} />
                  <PermissionRow label="Retry processing" enabled={resource.canRetry} />
                </div>
              </section>
                </TabsContent>

                {showTranscriptTab && (
                  <TabsContent value="transcript" className="mt-3 space-y-3">
                    <div className="rounded-md border border-border/60 p-3 text-xs space-y-1">
                      <p className="text-muted-foreground">Transcript status</p>
                      <p className="font-medium">{resource.transcriptStatus || 'none'}</p>
                      {resource.transcriptError && (
                        <p className="text-destructive break-words">{resource.transcriptError}</p>
                      )}
                    </div>

                    {resource.transcriptStatus === 'ready' ? (
                      <>
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Search transcript</p>
                          <Input
                            value={transcriptQuery}
                            onChange={(e) => setTranscriptQuery(e.target.value)}
                            placeholder="Find a phrase in transcript"
                            className="h-8 text-sm"
                          />
                        </div>

                        <div className="space-y-2">
                          {isTranscriptPreviewLoading ? (
                            <div className="py-6 flex items-center justify-center">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : transcriptPreviewChunks.length === 0 ? (
                            <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
                              No transcript excerpts found.
                            </div>
                          ) : (
                            transcriptPreviewChunks.slice(0, 20).map((chunk) => (
                              <div key={`${chunk.chunkIndex}-${chunk.chunkText.slice(0, 16)}`} className="rounded-md border border-border/60 p-3 space-y-1">
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span>Chunk {chunk.chunkIndex + 1}</span>
                                  <span>{chunk.tokenCount} tokens</span>
                                </div>
                                <p className="text-xs whitespace-pre-wrap leading-relaxed">{chunk.chunkText}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    ) : resource.transcriptStatus === 'failed' ? (
                      <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs space-y-1.5">
                        <p className="font-medium text-destructive">Transcript fetch failed</p>
                        {(resource.transcriptError || resource.processingError) ? (
                          <p className="text-destructive/90 break-words">{resource.transcriptError || resource.processingError}</p>
                        ) : (
                          <p className="text-destructive/70">No additional error details available.</p>
                        )}
                        <p className="text-muted-foreground pt-1">Use Retry transcript to queue another attempt.</p>
                      </div>
                    ) : resource.transcriptStatus === 'queued' || resource.transcriptStatus === 'running' ? (
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                        Transcript ingestion is in progress. This tab will populate when processing is complete.
                      </div>
                    ) : (
                      <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
                        Transcript is not available for this resource yet.
                      </div>
                    )}
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </ScrollArea>

          <div className="border-t border-border px-6 py-3 flex items-center gap-2 flex-wrap">
            {canOpenWorkspace && (
              <Button size="sm" className="gap-1.5" onClick={() => onOpenResource(resource)}>
                <ExternalLink className="h-3.5 w-3.5" /> Open workspace
              </Button>
            )}
            {!canOpenWorkspace && canFallbackPersonalOpen && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenPersonalFallback(resource)}>
                <Globe className="h-3.5 w-3.5" /> View in personal resources
              </Button>
            )}
            {resource.canDownload && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onDownload(resource)}>
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
            )}
            {resource.canRename && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRename(resource)}>
                <FileType className="h-3.5 w-3.5" /> Rename
              </Button>
            )}
            {resource.canRetry && resource.readiness === 'failed' && !canRetryTranscript && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(resource)} disabled={isRetrying}>
                <RotateCcw className="h-3.5 w-3.5" /> Retry
              </Button>
            )}
            {canRetryTranscript && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => onRetryTranscript(resource)}
                disabled={isRetryingTranscript}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Retry transcript
              </Button>
            )}
            {resource.canDelete && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive border-destructive/30 hover:text-destructive"
                onClick={() => onDelete(resource)}
                disabled={isDeleting}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
