import React, { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus, FileText, MoreHorizontal, Loader2, Sparkles,
  Atom, FlaskConical, Microscope, Scale, Landmark,
  Scroll, Wrench, Rocket, Cpu, Leaf, Globe, BookOpen,
  Brain, Library, Lightbulb, Palette, Music, Heart,
  BarChart3, GraduationCap, Camera, BookOpenCheck
} from 'lucide-react';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { authedFetchHeaders } from '@/lib/edge/invokeWithAuth';
import { useNotebooks, useDeleteNotebook, useUpdateNotebook, useCreateNotebook, DbNotebook } from '@/hooks/useNotebooks';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { useAuth } from '@/contexts/useAuth';
import { useApp } from '@/contexts/useApp';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NotebookActionsMenuContent } from '@/components/actions/EntityActionMenus';
import { useItemRole } from '@/hooks/useItemRole';
import { getItemPermissions } from '@/lib/permissions';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE, getDateLocale, normalizeLanguageCode, type AvailableLanguageCode } from '@/lib/languages';

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

function formatLastActivity(dateStr: string, t: any, locale: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t('notebooksLanding.time.today');
    if (diffDays === 1) return t('notebooksLanding.time.yesterday');
    if (diffDays < 7) return formatDistanceToNow(date, { addSuffix: true });
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function NotebooksLanding() {
  const { t, i18n } = useTranslation();
  const currentLanguage = normalizeLanguageCode(i18n.resolvedLanguage || i18n.language);
  const dateLocale = getDateLocale(i18n.resolvedLanguage || i18n.language);
  const { user } = useAuth();
  const { setSelectedNotebookId, setActiveView, setShowPricing } = useApp();
  const { limits: planLimits } = usePlanLimits();
  const { data: notebooks = [], isLoading } = useNotebooks();
  const deleteNotebook = useDeleteNotebook();
  const updateNotebook = useUpdateNotebook();
  const createNotebook = useCreateNotebook();

  const [showCreate, setShowCreate] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createLanguage, setCreateLanguage] = useState<AvailableLanguageCode>(currentLanguage);

  const [editNotebook, setEditNotebook] = useState<DbNotebook | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLanguage, setEditLanguage] = useState<AvailableLanguageCode>(DEFAULT_LANGUAGE);
  const [improvingDescription, setImprovingDescription] = useState(false);

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
    if (planLimits.maxNotebooks !== null && notebooks.length >= planLimits.maxNotebooks) {
      toast.error(t('planLimits.notebooksReached'));
      setShowCreate(false);
      setShowPricing(true);
      return;
    }
    createNotebook.mutate({ name: createName.trim(), description: createDescription.trim(), language: createLanguage }, {
      onSuccess: () => {
        toast.success(t('notebooksLanding.create.success'));
        setShowCreate(false);
        setCreateName('');
        setCreateDescription('');
        setCreateLanguage(currentLanguage);
      },
    });
  };

  const handleManage = (nb: DbNotebook) => {
    setEditNotebook(nb);
    setEditName(nb.name);
    setEditDescription(nb.description || '');
    setEditLanguage(normalizeLanguageCode(nb.language));
  };

  const handleManageSubmit = () => {
    if (!editNotebook || !editName.trim()) return;
    updateNotebook.mutate({ id: editNotebook.id, name: editName.trim(), description: editDescription.trim() }, {
      onSuccess: () => {
        toast.success(t('notebooksLanding.manage.updated'));
        setEditNotebook(null);
      },
    });
  };

  const handleArchive = (id: string) => {
    archiveNotebook.mutate(id, { onSuccess: () => toast.success(t('notebooksLanding.delete.archived')) });
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDeleteNotebook = () => {
    if (!pendingDeleteId) return;
    deleteNotebook.mutate(pendingDeleteId, {
      onSuccess: () => {
        toast.success(t('notebooksLanding.delete.success'));
        setPendingDeleteId(null);
      },
    });
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
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">{t('notebooksLanding.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasNotebooks
              ? t('notebooksLanding.count', { count: notebooks.length })
              : t('notebooksLanding.empty')}
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {/* Create Card */}
          <button
            onClick={() => {
              setCreateLanguage(currentLanguage);
              setShowCreate(true);
            }}
            className="group relative flex flex-col items-center justify-center min-h-[200px] rounded-xl border-2 border-dashed border-border bg-background hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
          >
            <div className="w-14 h-14 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center mb-3 group-hover:border-primary/40 group-hover:text-primary transition-colors">
              <Plus className="h-7 w-7 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
              {hasNotebooks ? t('notebooksLanding.createNew') : t('notebooksLanding.createFirst')}
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
                    setSelectedNotebookId(notebook.id); setActiveView('notebook-workspace');
                  }
                }}
                className={`group relative flex flex-col justify-between min-h-[200px] rounded-xl border p-5 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-[0.98] ${CARD_COLORS[colorIdx]}`}
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <NotebookCardActions
                  notebook={notebook}
                  onManageNotebook={() => handleManage(notebook)}
                  onManageDocuments={() => {
                    setSelectedNotebookId(notebook.id);
                    setActiveView('notebook-documents');
                  }}
                  onArchiveNotebook={() => handleArchive(notebook.id)}
                  onDeleteNotebook={() => handleDelete(notebook.id)}
                />
                <div>
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3 ${ICON_COLORS[colorIdx]} bg-white/60`}>
                    <IconComponent className="h-7 w-7" />
                  </div>
                  <h3 className="pr-8 font-semibold text-foreground text-sm leading-snug line-clamp-2">
                    {notebook.name}
                  </h3>
                </div>
                <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
                  <span>{formatLastActivity(notebook.updated_at, t, dateLocale)}</span>
                  <span>·</span>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <span>{t('notebooksLanding.sources', { count: docCount })}</span>
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
              {t('notebooksLanding.intro')}
            </p>
          </div>
        )}
      </div>

      {/* Create Notebook Dialog */}
      <Dialog open={showCreate} onOpenChange={(nextOpen) => {
        setShowCreate(nextOpen);
        if (!nextOpen) {
          setCreateName('');
          setCreateDescription('');
          setCreateLanguage(currentLanguage);
        }
      }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('notebooksLanding.create.title')}</DialogTitle>
            <DialogDescription>{t('notebooksLanding.create.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="create-nb-name">{t('notebooksLanding.create.nameLabel')} <span className="text-destructive">*</span></Label>
              <Input
                id="create-nb-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('notebooksLanding.create.namePlaceholder')}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-nb-desc">{t('notebooksLanding.create.descriptionLabel')}</Label>
              <Textarea
                id="create-nb-desc"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder={t('notebooksLanding.create.descriptionPlaceholder')}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-nb-lang">{t('notebooksLanding.create.languageLabel')}</Label>
              <Select value={createLanguage} onValueChange={(val: AvailableLanguageCode) => setCreateLanguage(val)}>
                <SelectTrigger id="create-nb-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_LANGUAGES.map((availableLanguage) => (
                    <SelectItem key={availableLanguage.code} value={availableLanguage.code}>
                      {t(availableLanguage.translationKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => {
              setShowCreate(false);
              setCreateName('');
              setCreateDescription('');
              setCreateLanguage(currentLanguage);
            }}>{t('notebooksLanding.create.cancel')}</Button>
            <Button onClick={handleCreate} disabled={!createName.trim()}>{t('notebooksLanding.create.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Notebook Dialog */}
      <Dialog open={!!editNotebook} onOpenChange={(open) => !open && setEditNotebook(null)}>
        <DialogContent className="sm:max-w-[480px]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t('notebooksLanding.manage.title')}</DialogTitle>
            <DialogDescription>{t('notebooksLanding.manage.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-nb-name">{t('notebooksLanding.manage.nameLabel')} <span className="text-destructive">*</span></Label>
              <Input
                id="edit-nb-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t('notebooksLanding.manage.namePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-nb-desc">{t('notebooksLanding.manage.descriptionLabel')}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  disabled={improvingDescription}
                  onClick={async () => {
                    if (!editNotebook) return;
                    setImprovingDescription(true);
                    try {
                      const { data: nbDocs } = await supabase
                        .from('documents' as any)
                        .select('file_name, summary')
                        .eq('notebook_id', editNotebook.id)
                        .eq('processing_status', 'completed')
                        .limit(15);

                      const resp = await fetch(getFunctionUrl('/functions/v1/improve-notebook'), {
                        method: 'POST',
                        headers: {
                          ...(await authedFetchHeaders()),
                        },
                        body: JSON.stringify({
                          notebookName: editName,
                          currentDescription: editDescription,
                          documents: (nbDocs || []).map((d: any) => ({ fileName: d.file_name, summary: d.summary })),
                          mode: 'description',
                          responseLanguage: editLanguage,
                        }),
                      });

                      const data = await resp.json();
                      if (!resp.ok) throw new Error(data.error || t('notebooksLanding.manage.improveFailed'));
                      if (data.description) {
                        setEditDescription(data.description);
                        toast.success(t('notebooksLanding.manage.improveSuccess'));
                      }
                    } catch (err: any) {
                      console.error('Improve description error:', err);
                      toast.error(err.message || t('notebooksLanding.manage.improveFailed'));
                    } finally {
                      setImprovingDescription(false);
                    }
                  }}
                >
                  {improvingDescription ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {improvingDescription ? t('notebooksLanding.manage.improving') : t('notebooksLanding.manage.improveWithAi')}
                </Button>
              </div>
              <Textarea
                id="edit-nb-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t('notebooksLanding.manage.descriptionPlaceholder')}
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">{t('notebooksLanding.manage.descriptionHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-nb-lang">{t('notebooksLanding.manage.languageLabel')}</Label>
              <Select value={editLanguage} disabled>
                <SelectTrigger id="edit-nb-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_LANGUAGES.map((availableLanguage) => (
                    <SelectItem key={availableLanguage.code} value={availableLanguage.code}>
                      {t(availableLanguage.translationKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setEditNotebook(null)}>{t('notebooksLanding.manage.cancel')}</Button>
            <Button onClick={handleManageSubmit} disabled={!editName.trim()}>{t('notebooksLanding.manage.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('notebooksLanding.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('notebooksLanding.delete.intro')}
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>{t('notebooksLanding.delete.items.chats')}</li>
                <li>{t('notebooksLanding.delete.items.documents')}</li>
                <li>{t('notebooksLanding.delete.items.notes')}</li>
                <li>{t('notebooksLanding.delete.items.extracted')}</li>
                <li>{t('notebooksLanding.delete.items.resources')}</li>
                <li>{t('notebooksLanding.delete.items.sharing')}</li>
              </ul>
              <span className="block mt-2 font-medium">{t('notebooksLanding.delete.irreversible')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('notebooksLanding.delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteNotebook}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('notebooksLanding.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NotebookCardActions({
  notebook,
  onManageNotebook,
  onManageDocuments,
  onArchiveNotebook,
  onDeleteNotebook,
}: {
  notebook: DbNotebook;
  onManageNotebook: () => void;
  onManageDocuments: () => void;
  onArchiveNotebook: () => void;
  onDeleteNotebook: () => void;
}) {
  const { data: myRole } = useItemRole(notebook.id, 'notebook');
  const permissions = getItemPermissions(myRole);

  return (
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
          permissions={permissions}
          onManageNotebook={onManageNotebook}
          onManageDocuments={onManageDocuments}
          onArchiveNotebook={onArchiveNotebook}
          onDeleteNotebook={onDeleteNotebook}
        />
      </DropdownMenu>
    </div>
  );
}
