import React, { useMemo, useState } from 'react';
import {
  Plus, FileText, MoreHorizontal, Loader2, Sparkles,
  Atom, FlaskConical, Microscope, Scale, Landmark,
  Scroll, Wrench, Rocket, Cpu, Leaf, Globe, BookOpen,
  Brain, Library, Lightbulb, Palette, Music, Heart,
  BarChart3, GraduationCap, Camera, BookOpenCheck
} from 'lucide-react';
import { useNotebooks, useDeleteNotebook, useArchiveNotebook, useUpdateNotebook, useCreateNotebook, DbNotebook } from '@/hooks/useNotebooks';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NotebookActionsMenuContent } from '@/components/actions/EntityActionMenus';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

const ICONS = [
  Atom, FlaskConical, Microscope, Scale, Landmark, Scroll,
  Wrench, Rocket, Cpu, Leaf, Globe, BookOpen, Brain,
  Library, Lightbulb, Palette, Music, Heart, BarChart3,
  GraduationCap, Camera,
];

const CARD_COLORS = [
  'bg-blue-50 border-blue-100',
  'bg-amber-50 border-amber-100',
  'bg-rose-50 border-rose-100',
  'bg-emerald-50 border-emerald-100',
  'bg-violet-50 border-violet-100',
  'bg-cyan-50 border-cyan-100',
  'bg-orange-50 border-orange-100',
  'bg-teal-50 border-teal-100',
  'bg-pink-50 border-pink-100',
  'bg-indigo-50 border-indigo-100',
];

const ICON_COLORS = [
  'text-blue-500',
  'text-amber-500',
  'text-rose-500',
  'text-emerald-500',
  'text-violet-500',
  'text-cyan-500',
  'text-orange-500',
  'text-teal-500',
  'text-pink-500',
  'text-indigo-500',
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatLastActivity(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return formatDistanceToNow(date, { addSuffix: true });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function NotebooksLanding() {
  const { user } = useAuth();
  const { setSelectedNotebookId, setActiveView } = useApp();
  const { data: notebooks = [], isLoading } = useNotebooks();
  const deleteNotebook = useDeleteNotebook();
  const archiveNotebook = useArchiveNotebook();
  const updateNotebook = useUpdateNotebook();
  const createNotebook = useCreateNotebook();

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  const [editNotebook, setEditNotebook] = useState<DbNotebook | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Get document counts per notebook
  const { data: allDocCounts = {} } = useQuery({
    queryKey: ['notebook-document-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents' as any)
        .select('notebook_id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((d: any) => {
        if (d.notebook_id) {
          counts[d.notebook_id] = (counts[d.notebook_id] || 0) + 1;
        }
      });
      return counts;
    },
    enabled: !!user,
  });

  const handleCreate = () => {
    if (!createName.trim()) return;
    createNotebook.mutate({ name: createName.trim(), description: createDescription.trim() }, {
      onSuccess: () => {
        toast.success('Notebook created');
        setShowCreate(false);
        setCreateName('');
        setCreateDescription('');
      },
    });
  };

  const handleManage = (nb: DbNotebook) => {
    setEditNotebook(nb);
    setEditName(nb.name);
    setEditDescription(nb.description || '');
  };

  const handleManageSubmit = () => {
    if (!editNotebook || !editName.trim()) return;
    updateNotebook.mutate({ id: editNotebook.id, name: editName.trim(), description: editDescription.trim() }, {
      onSuccess: () => {
        toast.success('Notebook updated');
        setEditNotebook(null);
      },
    });
  };

  const handleArchive = (id: string) => {
    archiveNotebook.mutate(id, { onSuccess: () => toast.success('Notebook archived') });
  };

  const handleDelete = (id: string) => {
    deleteNotebook.mutate(id, { onSuccess: () => toast.success('Notebook deleted') });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const hasNotebooks = notebooks.length > 0;

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-6xl mx-auto px-6 py-10 animate-fade-in">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">My Notebooks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasNotebooks
              ? `${notebooks.length} notebook${notebooks.length !== 1 ? 's' : ''}`
              : 'No notebooks yet'}
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {/* Create Card */}
          <button
            onClick={() => setShowCreate(true)}
            className="group relative flex flex-col items-center justify-center min-h-[200px] rounded-xl border-2 border-dashed border-border bg-background hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
          >
            <div className="w-14 h-14 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center mb-3 group-hover:border-primary/40 group-hover:text-primary transition-colors">
              <Plus className="h-7 w-7 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
              {hasNotebooks ? 'Create new notebook' : 'Create your first notebook'}
            </span>
          </button>

          {/* Notebook Cards */}
          {notebooks.map((notebook, idx) => {
            const h = hashCode(notebook.id);
            const colorIdx = h % CARD_COLORS.length;
            const iconIdx = h % ICONS.length;
            const IconComponent = ICONS[iconIdx];
            const docCount = allDocCounts[notebook.id] || 0;

            return (
              <div
                key={notebook.id}
                role="button"
                tabIndex={0}
                onClick={() => { setSelectedNotebookId(notebook.id); setActiveView('notebook-workspace'); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedNotebookId(notebook.id);
                  }
                }}
                className={`group relative flex flex-col justify-between min-h-[200px] rounded-xl border p-5 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-[0.98] ${CARD_COLORS[colorIdx]}`}
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div className="absolute top-2 right-2 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <NotebookActionsMenuContent
                      onManageNotebook={() => handleManage(notebook)}
                      onManageDocuments={() => {
                        setSelectedNotebookId(notebook.id);
                        setActiveView('notebook-documents');
                      }}
                      onArchiveNotebook={() => handleArchive(notebook.id)}
                      onDeleteNotebook={() => handleDelete(notebook.id)}
                    />
                  </DropdownMenu>
                </div>
                <div>
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3 ${ICON_COLORS[colorIdx]} bg-white/60`}>
                    <IconComponent className="h-7 w-7" />
                  </div>
                  <h3 className="pr-8 font-semibold text-foreground text-sm leading-snug line-clamp-2">
                    {notebook.name}
                  </h3>
                </div>
                <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
                  <span>{formatLastActivity(notebook.updated_at)}</span>
                  <span>·</span>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <span>{docCount} source{docCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state help text */}
        {!hasNotebooks && (
          <div className="max-w-xl mx-auto mt-10 text-center">
            <p className="text-muted-foreground text-sm">
              Create a notebook to organize your research, collect sources, and explore topics with AI-powered analysis.
            </p>
          </div>
        )}
      </div>

      {/* Create Notebook Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create Notebook</DialogTitle>
            <DialogDescription>Give your notebook a name and optional description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="create-nb-name">Notebook name <span className="text-destructive">*</span></Label>
              <Input
                id="create-nb-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Research on AI Safety"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-nb-desc">Description</Label>
              <Textarea
                id="create-nb-desc"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="What is this notebook about?"
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!createName.trim()}>Create Notebook</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Notebook Dialog */}
      <Dialog open={!!editNotebook} onOpenChange={(open) => !open && setEditNotebook(null)}>
        <DialogContent className="sm:max-w-[480px]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Manage Notebook</DialogTitle>
            <DialogDescription>Update your notebook details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-nb-name">Notebook name <span className="text-destructive">*</span></Label>
              <Input
                id="edit-nb-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Notebook name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-nb-desc">Description</Label>
              <Textarea
                id="edit-nb-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Describe what this notebook is about..."
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setEditNotebook(null)}>Cancel</Button>
            <Button onClick={handleManageSubmit} disabled={!editName.trim()}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
