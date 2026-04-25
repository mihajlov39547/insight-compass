import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ChevronLeft, ChevronRight, Plus, Search, MessageSquare, FolderOpen,
  MoreHorizontal, Bell, ChevronDown, ChevronUp,
  ArrowUpAZ, ArrowDownAZ, Clock, ChevronsUpDown, ChevronsDownUp, FileText,
  Settings, Share2, Archive, Trash2, Pencil, Sparkles, Loader2, BookOpenCheck,
  Home, Star, FolderPlus, BookPlus, Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/useApp';
import { useAuth } from '@/contexts/useAuth';
import { cn } from '@/lib/utils';
import { useProjects, useDeleteProject, useArchiveProject, useUpdateProject, DbProject } from '@/hooks/useProjects';
import { useChats, useCreateChat, useDeleteChat, useUpdateChat, DbChat } from '@/hooks/useChats';
import { useNotebooks, useCreateNotebook, useDeleteNotebook, useArchiveNotebook, useUpdateNotebook, DbNotebook } from '@/hooks/useNotebooks';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';

import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ProjectActionsMenuContent, ChatActionsMenuContent, NotebookActionsMenuContent } from '@/components/actions/EntityActionMenus';
import { planIcons, planLabels } from '@/lib/planConfig';
import { formatDistanceToNow } from 'date-fns';
import { useRecentChats } from '@/hooks/useRecentChats';
import { useItemRole } from '@/hooks/useItemRole';
import { getItemPermissions } from '@/lib/permissions';
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguageCode, type AvailableLanguageCode } from '@/lib/languages';
import { isDefaultChatName } from '@/lib/chatNames';

export function AppSidebar() {
  const { 
    sidebarCollapsed, setSidebarCollapsed, 
    selectedProjectId, setSelectedProjectId,
    selectedChatId, setSelectedChatId,
    selectedNotebookId, setSelectedNotebookId,
    activeView, setActiveView,
    unreadCount, setShowNewProject, setShowNotifications,
  } = useApp();

  const { user: authUser, profile } = useAuth();
  const { t, i18n } = useTranslation();
  const currentLanguage = normalizeLanguageCode(i18n.resolvedLanguage || i18n.language);
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);
  const { data: notebooks = [] } = useNotebooks();
  const { data: recentChats = [] } = useRecentChats(10);
  const createChat = useCreateChat();
  const createNotebook = useCreateNotebook();
  const deleteProject = useDeleteProject();
  const archiveProject = useArchiveProject();
  const updateProject = useUpdateProject();
  const deleteChat = useDeleteChat();
  const updateChat = useUpdateChat();
  const deleteNotebook = useDeleteNotebook();
  const archiveNotebook = useArchiveNotebook();

  const [editProject, setEditProject] = useState<DbProject | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLanguage, setEditLanguage] = useState<AvailableLanguageCode>(DEFAULT_LANGUAGE);
  const [isImprovingDesc, setIsImprovingDesc] = useState(false);
  const [renameChatId, setRenameChatId] = useState<string | null>(null);
  const [renameChatValue, setRenameChatValue] = useState('');
  const [showCreateNotebook, setShowCreateNotebook] = useState(false);
  const [createNbName, setCreateNbName] = useState('');
  const [createNbDescription, setCreateNbDescription] = useState('');
  const [createNbLanguage, setCreateNbLanguage] = useState<AvailableLanguageCode>(currentLanguage);

  const displayName = profile?.full_name || authUser?.user_metadata?.full_name || authUser?.email || '';
  const displayEmail = profile?.email || authUser?.email || '';
  const avatarUrl = profile?.avatar_url || authUser?.user_metadata?.avatar_url || '';
  const firstName = displayName ? displayName.split(' ')[0] : 'User';
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : displayEmail?.[0]?.toUpperCase() || '?';

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [notebooksListOpen, setNotebooksListOpen] = useState(true);
  const [projectsSectionOpen, setProjectsSectionOpen] = useState(true);
  const [notebooksSectionOpen, setNotebooksSectionOpen] = useState(true);
  const [alphaSort, setAlphaSort] = useState<'none' | 'asc' | 'desc'>('none');
  const [dateSort, setDateSort] = useState<'updated' | 'newest' | 'oldest'>('updated');
  const [nbAlphaSort, setNbAlphaSort] = useState<'none' | 'asc' | 'desc'>('none');
  const [nbDateSort, setNbDateSort] = useState<'updated' | 'newest' | 'oldest'>('updated');

  const [editNotebook, setEditNotebook] = useState<DbNotebook | null>(null);
  const [editNbName, setEditNbName] = useState('');
  const [editNbDescription, setEditNbDescription] = useState('');
  const [editNbLanguage, setEditNbLanguage] = useState<AvailableLanguageCode>(DEFAULT_LANGUAGE);
  const [isImprovingNbDesc, setIsImprovingNbDesc] = useState(false);
  const updateNotebook = useUpdateNotebook();
  const [pendingDeleteChat, setPendingDeleteChat] = useState<{ id: string; projectId: string; name: string } | null>(null);
  const [pendingDeleteNotebook, setPendingDeleteNotebook] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (selectedProjectId) {
      setExpandedProjects(prev => {
        const next = new Set(prev);
        next.add(selectedProjectId);
        return next;
      });
    }
  }, [selectedProjectId]);

  const sortedProjects = useMemo(() => {
    const sorted = [...projects];
    if (alphaSort === 'asc') return sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (alphaSort === 'desc') return sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (dateSort === 'newest') return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (dateSort === 'oldest') return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [projects, alphaSort, dateSort]);

  const cycleAlphaSort = () => {
    const next = alphaSort === 'none' ? 'asc' : alphaSort === 'asc' ? 'desc' : 'none';
    setAlphaSort(next);
    if (next !== 'none') setDateSort('updated');
  };
  const cycleDateSort = () => {
    const next = dateSort === 'updated' ? 'newest' : dateSort === 'newest' ? 'oldest' : 'updated';
    setDateSort(next);
    if (next !== 'updated') setAlphaSort('none');
  };

  const alphaLabel = { none: t('sidebar.sort.alphaNone'), asc: t('sidebar.sort.alphaAsc'), desc: t('sidebar.sort.alphaDesc') }[alphaSort];
  const dateLabel = { updated: t('sidebar.sort.dateUpdated'), newest: t('sidebar.sort.dateNewest'), oldest: t('sidebar.sort.dateOldest') }[dateSort];

  const expandAll = () => setExpandedProjects(new Set(projects.map(p => p.id)));
  const collapseAll = () => setExpandedProjects(new Set());

  const sortedNotebooks = useMemo(() => {
    const sorted = [...notebooks];
    if (nbAlphaSort === 'asc') return sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (nbAlphaSort === 'desc') return sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (nbDateSort === 'newest') return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (nbDateSort === 'oldest') return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [notebooks, nbAlphaSort, nbDateSort]);

  const cycleNbAlphaSort = () => {
    const next = nbAlphaSort === 'none' ? 'asc' : nbAlphaSort === 'asc' ? 'desc' : 'none';
    setNbAlphaSort(next);
    if (next !== 'none') setNbDateSort('updated');
  };
  const cycleNbDateSort = () => {
    const next = nbDateSort === 'updated' ? 'newest' : nbDateSort === 'newest' ? 'oldest' : 'updated';
    setNbDateSort(next);
    if (next !== 'updated') setNbAlphaSort('none');
  };

  const nbAlphaLabel = { none: t('sidebar.sort.alphaNone'), asc: t('sidebar.sort.alphaAsc'), desc: t('sidebar.sort.alphaDesc') }[nbAlphaSort];
  const nbDateLabel = { updated: t('sidebar.sort.dateUpdated'), newest: t('sidebar.sort.dateNewest'), oldest: t('sidebar.sort.dateOldest') }[nbDateSort];

  // Recents data — notebooks and chats only, 2 items in sidebar
  const recentItems = useMemo(() => {
    const items = [
      ...recentChats.map(c => ({ type: 'chat' as const, id: c.id, name: c.name, updatedAt: c.updated_at, projectId: c.project_id })),
      ...notebooks.map(n => ({ type: 'notebook' as const, id: n.id, name: n.name, updatedAt: n.updated_at, projectId: undefined as string | undefined })),
    ]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 2);
    return items;
  }, [recentChats, notebooks]);


  const toggleProject = (projectId: string) => {
    const next = new Set(expandedProjects);
    if (next.has(projectId)) {
      next.delete(projectId);
    } else {
      next.add(projectId);
    }
    setExpandedProjects(next);
  };

  const handleProjectSelect = (project: DbProject) => {
    setSelectedProjectId(project.id);
    setSelectedChatId(null);
    setActiveView('default');
    if (!expandedProjects.has(project.id)) toggleProject(project.id);
  };

  const handleChatSelect = (chat: DbChat) => {
    setSelectedProjectId(chat.project_id);
    setSelectedChatId(chat.id);
    setActiveView('default');
  };

  const handleNewChat = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const project = projects.find(p => p.id === projectId);
    createChat.mutate({
      projectId,
      name: t('sidebar.newChatName'),
      language: normalizeLanguageCode(project?.language),
    }, {
      onSuccess: (chat) => {
        setSelectedProjectId(projectId);
        setSelectedChatId(chat.id);
      }
    });
  };

  const handleDeleteProject = (projectId: string) => {
    deleteProject.mutate(projectId, {
      onSuccess: () => {
        if (selectedProjectId === projectId) { setSelectedProjectId(null); setSelectedChatId(null); }
        toast.success(t('sidebar.toasts.projectDeleted'));
      }
    });
  };

  const handleArchiveProject = (projectId: string) => {
    archiveProject.mutate(projectId, {
      onSuccess: () => {
        if (selectedProjectId === projectId) { setSelectedProjectId(null); setSelectedChatId(null); }
        toast.success(t('sidebar.toasts.projectArchived'));
      }
    });
  };

  const handleManageProject = (project: DbProject) => {
    setEditProject(project);
    setEditName(project.name);
    setEditDescription(project.description || '');
    setEditLanguage(normalizeLanguageCode(project.language));
  };

  const handleManageSubmit = () => {
    if (!editProject || !editName.trim() || !editDescription.trim()) return;
    updateProject.mutate({ id: editProject.id, name: editName.trim(), description: editDescription.trim(), language: editLanguage }, {
      onSuccess: () => { toast.success(t('sidebar.toasts.projectUpdated')); setEditProject(null); }
    });
  };

  const handleImproveDescription = async () => {
    if (!editProject || isImprovingDesc) return;
    setIsImprovingDesc(true);
    try {
      const { data: docs } = await supabase.from('documents').select('file_name, summary').eq('project_id', editProject.id).eq('processing_status', 'completed').limit(15);
      const { data: chatList } = await supabase.from('chats').select('name').eq('project_id', editProject.id).eq('is_archived', false).order('updated_at', { ascending: false }).limit(10);
      const resp = await fetch(getFunctionUrl('/functions/v1/improve-description'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          projectName: editName, currentDescription: editDescription,
          documents: (docs ?? []).map(d => ({ fileName: d.file_name, summary: d.summary })),
          chats: (chatList ?? []).map(c => ({ name: c.name })),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || t('sidebar.manageProject.improveFailed'));
      if (data.description) { setEditDescription(data.description); toast.success(t('sidebar.manageProject.improveSuccess')); }
    } catch (err: any) {
      console.error('Improve description error:', err);
      toast.error(err.message || t('sidebar.manageProject.improveFailed'));
    } finally { setIsImprovingDesc(false); }
  };

  

  const handleCreateNotebook = () => {
    setCreateNbLanguage(currentLanguage);
    setShowCreateNotebook(true);
  };

  const handleCreateNotebookSubmit = () => {
    if (!createNbName.trim()) return;
    createNotebook.mutate({ name: createNbName.trim(), description: createNbDescription.trim(), language: createNbLanguage }, {
      onSuccess: (nb) => {
        setSelectedProjectId(null); setSelectedChatId(null);
        setSelectedNotebookId(nb.id); setActiveView('notebook-workspace');
        toast.success(t('sidebar.toasts.notebookCreated'));
        setShowCreateNotebook(false); setCreateNbName(''); setCreateNbDescription(''); setCreateNbLanguage(currentLanguage);
      }
    });
  };

  const handleManageNotebook = (nb: DbNotebook) => {
    setEditNotebook(nb); setEditNbName(nb.name); setEditNbDescription(nb.description || ''); setEditNbLanguage(normalizeLanguageCode(nb.language));
  };

  const handleManageNotebookSubmit = () => {
    if (!editNotebook || !editNbName.trim()) return;
    updateNotebook.mutate({ id: editNotebook.id, name: editNbName.trim(), description: editNbDescription.trim(), language: editNbLanguage }, {
      onSuccess: () => { toast.success(t('sidebar.toasts.notebookUpdated')); setEditNotebook(null); },
    });
  };

  const handleArchiveNotebookSidebar = (id: string) => {
    archiveNotebook.mutate(id, { onSuccess: () => { if (selectedNotebookId === id) setSelectedNotebookId(null); toast.success(t('sidebar.toasts.notebookArchived')); } });
  };

  const handleDeleteNotebookSidebar = (id: string, name: string) => {
    setPendingDeleteNotebook({ id, name });
  };

  const confirmDeleteNotebookSidebar = () => {
    if (!pendingDeleteNotebook) return;
    const { id } = pendingDeleteNotebook;
    deleteNotebook.mutate(id, {
      onSuccess: () => {
        if (selectedNotebookId === id) setSelectedNotebookId(null);
        toast.success(t('sidebar.toasts.notebookDeleted'));
        setPendingDeleteNotebook(null);
      },
    });
  };

  const requestDeleteChat = (chat: DbChat) => {
    setPendingDeleteChat({ id: chat.id, projectId: chat.project_id, name: chat.name });
  };

  const confirmDeleteChat = () => {
    if (!pendingDeleteChat) return;
    const { id, projectId } = pendingDeleteChat;
    deleteChat.mutate({ id, projectId }, {
      onSuccess: () => {
        if (selectedChatId === id) setSelectedChatId(null);
        toast.success(t('sidebar.toasts.chatDeleted'));
        setPendingDeleteChat(null);
      },
    });
  };

  const navigateTo = (view: typeof activeView) => {
    setSelectedProjectId(null); setSelectedChatId(null); setSelectedNotebookId(null);
    setActiveView(view);
  };

  const handleRecentClick = (item: { type: 'chat' | 'notebook'; id: string; projectId?: string }) => {
    if (item.type === 'chat') {
      setSelectedProjectId(item.projectId || null); setSelectedChatId(item.id); setSelectedNotebookId(null); setActiveView('default');
    } else {
      setSelectedProjectId(null); setSelectedChatId(null); setSelectedNotebookId(item.id); setActiveView('notebook-workspace');
    }
  };

  const currentPlan = ((profile?.plan as keyof typeof planIcons) || 'free') as keyof typeof planIcons;
  const PlanIcon = planIcons[currentPlan];

  // ─── COLLAPSED ─────────────────────────────────────────────────
  // Dialogs that must render regardless of collapsed/expanded state
  const sharedDialogs = (
    <>
      {/* Create Notebook Dialog */}
      <Dialog open={showCreateNotebook} onOpenChange={(open) => { if (!open) { setShowCreateNotebook(false); setCreateNbName(''); setCreateNbDescription(''); setCreateNbLanguage(currentLanguage); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.createNotebook.title')}</DialogTitle>
            <DialogDescription>{t('sidebar.createNotebook.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="create-nb-name">{t('sidebar.createNotebook.nameLabel')} <span className="text-destructive">*</span></Label>
              <Input id="create-nb-name" value={createNbName} onChange={(e) => setCreateNbName(e.target.value)} placeholder={t('sidebar.createNotebook.namePlaceholder')} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && createNbName.trim()) handleCreateNotebookSubmit(); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-nb-desc">{t('sidebar.createNotebook.descriptionLabel')}</Label>
              <Textarea id="create-nb-desc" value={createNbDescription} onChange={(e) => setCreateNbDescription(e.target.value)} placeholder={t('sidebar.createNotebook.descriptionPlaceholder')} rows={3} className="resize-none" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-nb-lang">{t('sidebar.createNotebook.languageLabel')}</Label>
              <Select value={createNbLanguage} onValueChange={(val: AvailableLanguageCode) => setCreateNbLanguage(val)}>
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
            <Button variant="outline" onClick={() => { setShowCreateNotebook(false); setCreateNbName(''); setCreateNbDescription(''); setCreateNbLanguage(currentLanguage); }}>{t('sidebar.createNotebook.cancel')}</Button>
            <Button onClick={handleCreateNotebookSubmit} disabled={!createNbName.trim()}>{t('sidebar.createNotebook.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Notebook Dialog */}
      <Dialog open={!!editNotebook} onOpenChange={(open) => !open && setEditNotebook(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.manageNotebook.title')}</DialogTitle>
            <DialogDescription>{t('sidebar.manageNotebook.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-nb-name-sidebar">{t('sidebar.manageNotebook.nameLabel')} <span className="text-destructive">*</span></Label>
              <Input id="edit-nb-name-sidebar" value={editNbName} onChange={(e) => setEditNbName(e.target.value)} placeholder={t('sidebar.manageNotebook.namePlaceholder')} autoFocus />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-nb-desc-sidebar">{t('sidebar.manageNotebook.descriptionLabel')}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-accent"
                  onClick={async () => {
                    if (!editNotebook || isImprovingNbDesc) return;
                    setIsImprovingNbDesc(true);
                    try {
                      const { data: nbDocs } = await supabase
                        .from('documents' as any)
                        .select('file_name, summary')
                        .eq('notebook_id', editNotebook.id)
                        .eq('processing_status', 'completed')
                        .limit(15);

                      const resp = await fetch(
                        getFunctionUrl('/functions/v1/improve-description'),
                        {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
                          },
                          body: JSON.stringify({
                            projectName: editNbName,
                            currentDescription: editNbDescription,
                            documents: (nbDocs || []).map((d: any) => ({ fileName: d.file_name, summary: d.summary })),
                          }),
                        }
                      );

                      const data = await resp.json();
                      if (!resp.ok) throw new Error(data.error || t('sidebar.manageNotebook.improveFailed'));
                      if (data.description) {
                        setEditNbDescription(data.description);
                        toast.success(t('sidebar.manageNotebook.improveSuccess'));
                      }
                    } catch (err: any) {
                      console.error('Improve description error:', err);
                      toast.error(err.message || t('sidebar.manageNotebook.improveFailed'));
                    } finally {
                      setIsImprovingNbDesc(false);
                    }
                  }}
                  disabled={isImprovingNbDesc}
                >
                  {isImprovingNbDesc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {isImprovingNbDesc ? t('sidebar.manageNotebook.improving') : t('sidebar.manageNotebook.improveWithAi')}
                </Button>
              </div>
              <Textarea id="edit-nb-desc-sidebar" value={editNbDescription} onChange={(e) => setEditNbDescription(e.target.value)} placeholder={t('sidebar.manageNotebook.descriptionPlaceholder')} rows={3} className="resize-none" />
              <p className="text-xs text-muted-foreground">{t('sidebar.manageNotebook.descriptionHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-nb-lang-sidebar">{t('sidebar.manageNotebook.languageLabel')}</Label>
              <Select value={editNbLanguage} onValueChange={(val: AvailableLanguageCode) => setEditNbLanguage(val)}>
                <SelectTrigger id="edit-nb-lang-sidebar">
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
            <Button variant="outline" onClick={() => setEditNotebook(null)}>{t('sidebar.manageNotebook.cancel')}</Button>
            <Button onClick={handleManageNotebookSubmit} disabled={!editNbName.trim()}>{t('sidebar.manageNotebook.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (sidebarCollapsed) {
    return (
      <>
      <div className="w-14 h-screen bg-sidebar flex flex-col items-center py-3 border-r border-sidebar-border">
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent mb-3" onClick={() => setSidebarCollapsed(false)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.expandSidebar')}</TooltipContent></Tooltip>

        {/* Global nav */}
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("mb-1", activeView === 'home' ? "text-primary bg-primary/10" : "text-sidebar-foreground/70 hover:bg-sidebar-accent")} onClick={() => navigateTo('home')}>
            <Home className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.nav.home')}</TooltipContent></Tooltip>

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("mb-1", activeView === 'search' ? "text-primary bg-primary/10" : "text-sidebar-foreground/70 hover:bg-sidebar-accent")} onClick={() => navigateTo('search')}>
            <Search className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.nav.search')}</TooltipContent></Tooltip>

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("mb-1", activeView === 'resources' ? "text-primary bg-primary/10" : "text-sidebar-foreground/70 hover:bg-sidebar-accent")} onClick={() => navigateTo('resources')}>
            <FileText className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.nav.resources')}</TooltipContent></Tooltip>

        <div className="w-6 border-t border-sidebar-border my-2" />

        {/* Create actions */}
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="text-sidebar-primary hover:bg-sidebar-accent mb-1" onClick={() => setShowNewProject(true)}>
            <FolderPlus className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.projects.newTooltip')}</TooltipContent></Tooltip>

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="text-sidebar-primary hover:bg-sidebar-accent mb-1" onClick={handleCreateNotebook}>
            <BookPlus className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.notebooks.newTooltip')}</TooltipContent></Tooltip>

        <div className="w-6 border-t border-sidebar-border my-2" />

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("mb-1", activeView === 'starred' ? "text-primary bg-primary/10" : "text-sidebar-foreground/70 hover:bg-sidebar-accent")} onClick={() => navigateTo('starred')}>
            <Star className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.nav.starred')}</TooltipContent></Tooltip>

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("mb-1", activeView === 'shared' ? "text-primary bg-primary/10" : "text-sidebar-foreground/70 hover:bg-sidebar-accent")} onClick={() => navigateTo('shared')}>
            <Users className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.nav.sharedWithMe')}</TooltipContent></Tooltip>

        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("mb-1", activeView === 'recents' ? "text-primary bg-primary/10" : "text-sidebar-foreground/70 hover:bg-sidebar-accent")} onClick={() => navigateTo('recents')}>
            <Clock className="h-4 w-4" />
          </Button>
        </TooltipTrigger><TooltipContent side="right">{t('sidebar.nav.recents')}</TooltipContent></Tooltip>

        <div className="flex-1" />

        {/* Bottom */}
        <div className="flex flex-col items-center gap-3 mb-3">
          <Tooltip><TooltipTrigger asChild>
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", `plan-badge-${currentPlan}`)}>
              <PlanIcon className="h-4 w-4" />
            </div>
          </TooltipTrigger><TooltipContent side="right">{planLabels[currentPlan]} {t('sidebar.plan.suffix')}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-sidebar-foreground/70 hover:bg-sidebar-accent" onClick={() => setShowNotifications(true)}>
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center">{unreadCount}</span>}
            </Button>
          </TooltipTrigger><TooltipContent side="right">{t('sidebar.notifications')}</TooltipContent></Tooltip>
          <Avatar className="h-8 w-8 cursor-pointer">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-xs">{initials}</AvatarFallback>
          </Avatar>
        </div>
      </div>
      {sharedDialogs}
      </>
    );
  }

  // ─── EXPANDED ──────────────────────────────────────────────────
  return (
    <>
    <div className="w-full h-screen bg-sidebar flex flex-col border-r border-sidebar-border animate-slide-in-left">
      {/* Workspace Banner */}
      <div className="p-3 flex items-center justify-between border-b border-sidebar-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-semibold text-sidebar-foreground truncate">Researcher</span>
        </div>
        <Button variant="ghost" size="icon" className="ml-2 text-sidebar-foreground/70 hover:bg-sidebar-accent flex-shrink-0 h-7 w-7" onClick={() => setSidebarCollapsed(true)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Global Navigation */}
      <div className="px-3 pt-3 pb-1 space-y-0.5">
        <button
          className={cn(
            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
            activeView === 'home' ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"
          )}
          onClick={() => navigateTo('home')}
        >
          <Home className="h-4 w-4 flex-shrink-0" />
          <span>{t('sidebar.nav.home')}</span>
        </button>

        <button
          className={cn(
            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
            activeView === 'search' ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"
          )}
          onClick={() => navigateTo('search')}
        >
          <Search className="h-4 w-4 flex-shrink-0" />
          <span>{t('sidebar.nav.search')}</span>
        </button>

        <button
          className={cn(
            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
            activeView === 'resources' ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"
          )}
          onClick={() => navigateTo('resources')}
        >
          <FileText className="h-4 w-4 flex-shrink-0" />
          <span>{t('sidebar.nav.resources')}</span>
        </button>
      </div>

      {/* Scrollable Collections */}
      <ScrollArea className="flex-1 px-3">
        <div className="space-y-1 pb-2">
          {/* ── My Projects ───────────────────────── */}
          <Collapsible open={projectsSectionOpen} onOpenChange={setProjectsSectionOpen}>
            <div className="flex items-center justify-between px-2 py-2 mt-1">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1 text-xs font-medium text-sidebar-muted uppercase tracking-wider hover:text-sidebar-foreground transition-colors">
                  {projectsSectionOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {t('sidebar.projects.section')}
                </button>
              </CollapsibleTrigger>
              <div className="flex items-center gap-0.5">
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={cn("h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent", alphaSort !== 'none' ? "text-primary" : "text-sidebar-muted")} onClick={(e) => { e.stopPropagation(); cycleAlphaSort(); }}>
                    {alphaSort === 'desc' ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger><TooltipContent side="top" className="text-xs">{alphaLabel}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={cn("h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent", alphaSort === 'none' ? "text-primary" : "text-sidebar-muted")} onClick={(e) => { e.stopPropagation(); cycleDateSort(); }}>
                    <Clock className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent side="top" className="text-xs">{dateLabel}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={(e) => { e.stopPropagation(); if (expandedProjects.size === projects.length) { collapseAll(); } else { expandAll(); } }}>
                    {expandedProjects.size === projects.length ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger><TooltipContent side="top" className="text-xs">{expandedProjects.size === projects.length ? t('sidebar.sort.collapseAll') : t('sidebar.sort.expandAll')}</TooltipContent></Tooltip>
              </div>
            </div>

            <CollapsibleContent className="space-y-0.5 animate-fade-in">
              <div className="flex items-center gap-1">
                <button
                  className={cn(
                    "flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    activeView === 'projects' && !selectedProjectId && !selectedChatId
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                  onClick={() => navigateTo('projects')}
                >
                  <div className={cn("h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0", activeView === 'projects' ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary/70")}>
                    <FolderOpen className="h-3.5 w-3.5" />
                  </div>
                  <span className="truncate">{t('sidebar.projects.all')}</span>
                </button>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-sidebar-primary hover:text-sidebar-primary hover:bg-sidebar-accent flex-shrink-0" onClick={() => setShowNewProject(true)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>{t('sidebar.projects.newTooltip')}</TooltipContent></Tooltip>
              </div>

              {projectsLoading && <p className="text-xs text-sidebar-muted px-2 py-4 text-center">{t('sidebar.projects.loading')}</p>}

              {sortedProjects.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  isExpanded={expandedProjects.has(project.id)}
                  isSelected={selectedProjectId === project.id && !selectedChatId}
                  selectedChatId={selectedChatId}
                  onToggle={() => toggleProject(project.id)}
                  onSelect={() => handleProjectSelect(project)}
                  onNewChat={(e) => handleNewChat(project.id, e)}
                  onDelete={() => handleDeleteProject(project.id)}
                  onArchive={() => handleArchiveProject(project.id)}
                  onRename={() => handleManageProject(project)}
                  onChatSelect={handleChatSelect}
                  onDeleteChat={requestDeleteChat}
                  onRenameChat={(chatId, currentName) => { setRenameChatId(chatId); setRenameChatValue(currentName); }}
                />
              ))}
              {!projectsLoading && projects.length === 0 && <p className="text-xs text-sidebar-muted px-2 py-1">{t('sidebar.projects.empty')}</p>}
            </CollapsibleContent>
          </Collapsible>

          {/* ── My Notebooks ──────────────────────── */}
          <Collapsible open={notebooksSectionOpen} onOpenChange={setNotebooksSectionOpen}>
            <div className="flex items-center justify-between px-2 py-2 mt-2">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1 text-xs font-medium text-sidebar-muted uppercase tracking-wider hover:text-sidebar-foreground transition-colors">
                  {notebooksSectionOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {t('sidebar.notebooks.section')}
                </button>
              </CollapsibleTrigger>
              <div className="flex items-center gap-0.5">
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={cn("h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent", nbAlphaSort !== 'none' ? "text-primary" : "text-sidebar-muted")} onClick={(e) => { e.stopPropagation(); cycleNbAlphaSort(); }}>
                    {nbAlphaSort === 'desc' ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger><TooltipContent side="top" className="text-xs">{nbAlphaLabel}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={cn("h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent", nbAlphaSort === 'none' ? "text-primary" : "text-sidebar-muted")} onClick={(e) => { e.stopPropagation(); cycleNbDateSort(); }}>
                    <Clock className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent side="top" className="text-xs">{nbDateLabel}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={(e) => { e.stopPropagation(); setNotebooksListOpen(prev => !prev); }}>
                    {notebooksListOpen ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger><TooltipContent side="top" className="text-xs">{notebooksListOpen ? t('sidebar.notebooks.collapse') : t('sidebar.notebooks.expand')}</TooltipContent></Tooltip>
              </div>
            </div>

            <CollapsibleContent className="space-y-0.5 animate-fade-in">
              <div className="flex items-center gap-1">
                <button
                  className={cn(
                    "flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    activeView === 'notebooks' && !selectedNotebookId
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                  onClick={() => navigateTo('notebooks')}
                >
                  <div className={cn("h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0", activeView === 'notebooks' && !selectedNotebookId ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary/70")}>
                    <BookOpenCheck className="h-3.5 w-3.5" />
                  </div>
                  <span className="truncate">{t('sidebar.notebooks.all')}</span>
                </button>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-sidebar-primary hover:text-sidebar-primary hover:bg-sidebar-accent flex-shrink-0" onClick={handleCreateNotebook}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>{t('sidebar.notebooks.newTooltip')}</TooltipContent></Tooltip>
              </div>

              {notebooksListOpen && (
                <div className="pl-4 ml-3 border-l border-sidebar-border space-y-0.5">
                  {sortedNotebooks.map((nb) => (
                    <SidebarNotebookItem
                      key={nb.id}
                      notebook={nb}
                      isSelected={selectedNotebookId === nb.id}
                      onOpenNotebook={() => {
                        setSelectedProjectId(null);
                        setSelectedChatId(null);
                        setSelectedNotebookId(nb.id);
                        setActiveView('notebook-workspace');
                      }}
                      onManageNotebook={() => handleManageNotebook(nb)}
                      onManageDocuments={() => {
                        setSelectedNotebookId(nb.id);
                        setActiveView('notebook-documents');
                      }}
                      onArchiveNotebook={() => handleArchiveNotebookSidebar(nb.id)}
                      onDeleteNotebook={() => handleDeleteNotebookSidebar(nb.id, nb.name)}
                    />
                  ))}
                  {notebooks.length === 0 && <p className="text-xs text-sidebar-muted px-2 py-1">{t('sidebar.notebooks.empty')}</p>}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* ── Starred ───────────────────────────── */}
          <div className="mt-3">
            <button
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                activeView === 'starred' ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"
              )}
              onClick={() => navigateTo('starred')}
            >
              <Star className="h-4 w-4 flex-shrink-0" />
              <span>{t('sidebar.nav.starred')}</span>
            </button>
          </div>

          {/* ── Shared with me ────────────────────── */}
          <div>
            <button
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors",
                activeView === 'shared' ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"
              )}
              onClick={() => navigateTo('shared')}
            >
              <Users className="h-4 w-4 flex-shrink-0" />
              <span>{t('sidebar.nav.sharedWithMe')}</span>
            </button>
          </div>

          {/* ── Recents ───────────────────────────── */}
          <Collapsible defaultOpen>
            <div className="flex items-center justify-between px-2 py-2 mt-1">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1 text-xs font-medium text-sidebar-muted uppercase tracking-wider hover:text-sidebar-foreground transition-colors">
                  <Clock className="h-3 w-3" />
                  {t('sidebar.nav.recents')}
                </button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="space-y-0.5 animate-fade-in">
              {recentItems.length === 0 ? (
                <p className="text-xs text-sidebar-muted px-2 py-1">{t('sidebar.recents.empty')}</p>
              ) : (
                recentItems.map((item) => (
                  <Tooltip key={`${item.type}-${item.id}`}>
                    <TooltipTrigger asChild>
                      <button
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                        onClick={() => handleRecentClick(item)}
                      >
                        {item.type === 'chat' ? <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" /> : <BookOpenCheck className="h-3.5 w-3.5 flex-shrink-0" />}
                        <span className="truncate flex-1 text-left">{item.name}</span>
                        <span className="text-[10px] text-sidebar-muted flex-shrink-0">
                          {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true }).replace('about ', '')}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-[350px] z-[100]">{item.name}</TooltipContent>
                  </Tooltip>
                ))
              )}
              {recentItems.length > 0 && (
                <button
                  className="w-full text-xs text-sidebar-muted hover:text-sidebar-foreground px-2.5 py-1 transition-colors text-left"
                  onClick={() => navigateTo('recents')}
                >
                  {t('sidebar.recents.viewAll')}
                </button>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-3 border-t border-sidebar-border space-y-3">
        <div className={cn("rounded-lg p-3 flex items-center gap-3", `plan-badge-${currentPlan}`)}>
          <PlanIcon className="h-5 w-5" />
          <div className="flex-1">
            <p className="text-sm font-medium">{planLabels[currentPlan]} {t('sidebar.plan.suffix')}</p>
            {currentPlan !== 'enterprise' && <p className="text-xs opacity-80">{t('sidebar.plan.upgrade')}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-sm">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName || t('sidebar.user')}</p>
            <p className="text-xs text-sidebar-muted truncate">{displayEmail}</p>
          </div>
          <Button variant="ghost" size="icon" className="relative text-sidebar-foreground/70 hover:bg-sidebar-accent" onClick={() => setShowNotifications(true)}>
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center">{unreadCount}</span>}
          </Button>
        </div>
      </div>

      {/* ── Dialogs ───────────────────────────────── */}
      {/* Manage Project Dialog */}
      <Dialog open={!!editProject} onOpenChange={(open) => !open && setEditProject(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.manageProject.title')}</DialogTitle>
            <DialogDescription>{t('sidebar.manageProject.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-project-name">{t('sidebar.manageProject.nameLabel')} <span className="text-destructive">*</span></Label>
              <Input id="edit-project-name" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('sidebar.manageProject.namePlaceholder')} autoFocus />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-project-desc">{t('sidebar.manageProject.descriptionLabel')} <span className="text-destructive">*</span></Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-accent" onClick={handleImproveDescription} disabled={isImprovingDesc}>
                  {isImprovingDesc ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {isImprovingDesc ? t('sidebar.manageProject.improving') : t('sidebar.manageProject.improveWithAi')}
                </Button>
              </div>
              <Textarea id="edit-project-desc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder={t('sidebar.manageProject.descriptionPlaceholder')} rows={3} className="resize-none" />
              <p className="text-xs text-muted-foreground">{t('sidebar.manageProject.descriptionHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-project-lang">{t('sidebar.manageProject.languageLabel')}</Label>
              <Select value={editLanguage} onValueChange={(val: AvailableLanguageCode) => setEditLanguage(val)}>
                <SelectTrigger id="edit-project-lang"><SelectValue /></SelectTrigger>
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
            <Button variant="outline" onClick={() => setEditProject(null)}>{t('sidebar.manageProject.cancel')}</Button>
            <Button onClick={handleManageSubmit} disabled={!editName.trim() || !editDescription.trim()}>{t('sidebar.manageProject.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Chat Dialog */}
      <Dialog open={!!renameChatId} onOpenChange={(open) => !open && setRenameChatId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('sidebar.renameChat.title')}</DialogTitle></DialogHeader>
          <Input value={renameChatValue} onChange={(e) => setRenameChatValue(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && renameChatId && renameChatValue.trim()) {
              updateChat.mutate({ id: renameChatId, name: renameChatValue.trim() }, { onSuccess: () => { toast.success(t('sidebar.toasts.chatRenamed')); setRenameChatId(null); } });
            }
          }} placeholder={t('sidebar.renameChat.placeholder')} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameChatId(null)}>{t('sidebar.renameChat.cancel')}</Button>
            <Button disabled={!renameChatValue.trim()} onClick={() => {
              if (!renameChatId || !renameChatValue.trim()) return;
              updateChat.mutate({ id: renameChatId, name: renameChatValue.trim() }, { onSuccess: () => { toast.success(t('sidebar.toasts.chatRenamed')); setRenameChatId(null); } });
            }}>{t('sidebar.renameChat.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDeleteChat} onOpenChange={(open) => !open && setPendingDeleteChat(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteChat.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteChat?.name
                ? t('sidebar.deleteChat.intro', { name: `"${pendingDeleteChat.name}"` })
                : t('sidebar.deleteChat.introNoName')}
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>{t('sidebar.deleteChat.items.messages')}</li>
                <li>{t('sidebar.deleteChat.items.documents')}</li>
                <li>{t('sidebar.deleteChat.items.extracted')}</li>
              </ul>
              <span className="block mt-2 font-medium">{t('sidebar.deleteChat.irreversible')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('sidebar.deleteChat.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteChat}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('sidebar.deleteChat.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDeleteNotebook} onOpenChange={(open) => !open && setPendingDeleteNotebook(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteNotebook.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteNotebook?.name
                ? t('sidebar.deleteNotebook.intro', { name: `"${pendingDeleteNotebook.name}"` })
                : t('sidebar.deleteNotebook.introNoName')}
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>{t('sidebar.deleteNotebook.items.chats')}</li>
                <li>{t('sidebar.deleteNotebook.items.documents')}</li>
                <li>{t('sidebar.deleteNotebook.items.notes')}</li>
                <li>{t('sidebar.deleteNotebook.items.extracted')}</li>
                <li>{t('sidebar.deleteNotebook.items.resources')}</li>
                <li>{t('sidebar.deleteNotebook.items.sharing')}</li>
              </ul>
              <span className="block mt-2 font-medium">{t('sidebar.deleteNotebook.irreversible')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('sidebar.deleteNotebook.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteNotebookSidebar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('sidebar.deleteNotebook.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
      {sharedDialogs}
    </>
  );
}

// ── ProjectItem ──────────────────────────────────────────────────
function ProjectItem({ project, isExpanded, isSelected, selectedChatId, onToggle, onSelect, onNewChat, onDelete, onArchive, onRename, onChatSelect, onDeleteChat, onRenameChat }: {
  project: DbProject;
  isExpanded: boolean;
  isSelected: boolean;
  selectedChatId: string | null;
  onToggle: () => void;
  onSelect: () => void;
  onNewChat: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onArchive: () => void;
  onRename: () => void;
  onChatSelect: (chat: DbChat) => void;
  onDeleteChat: (chat: DbChat) => void;
  onRenameChat: (chatId: string, currentName: string) => void;
}) {
  const { t } = useTranslation();
  const { data: chats = [] } = useChats(isExpanded ? project.id : undefined);
  const { data: myRole } = useItemRole(project.id, 'project');
  const permissions = getItemPermissions(myRole);
  const { setSelectedProjectId, setSelectedChatId, setActiveView } = useApp();

  const handleManageProjectDocs = () => { setSelectedProjectId(project.id); setSelectedChatId(null); setActiveView('project-documents'); };
  const handleManageChatDocs = (chat: DbChat) => { setSelectedProjectId(project.id); setSelectedChatId(chat.id); setActiveView('chat-documents'); };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="group flex items-center gap-0.5">
        <CollapsibleTrigger asChild>
          <button className="p-1 hover:bg-sidebar-accent rounded flex-shrink-0">
            {isExpanded ? <ChevronDown className="h-3 w-3 text-sidebar-muted" /> : <ChevronRight className="h-3 w-3 text-sidebar-muted" />}
          </button>
        </CollapsibleTrigger>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(
                "flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
                isSelected ? "bg-primary/10 text-primary border border-primary/20" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
              onClick={onSelect}
            >
              <div className={cn("h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0", isSelected ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary/70")}>
                <FolderOpen className="h-3.5 w-3.5" />
              </div>
              <span className="truncate">{project.name}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-[350px] z-[100]">{project.name}</TooltipContent>
        </Tooltip>
        <div className="flex items-center flex-shrink-0">
          {permissions.canCreateChats && (
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-sidebar-primary hover:text-sidebar-primary hover:bg-sidebar-accent" onClick={onNewChat}>
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger><TooltipContent>{t('sidebar.newChat')}</TooltipContent></Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent">
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <ProjectActionsMenuContent permissions={permissions} onManageProject={onRename} onManageDocuments={handleManageProjectDocs} onArchiveProject={onArchive} onDeleteProject={onDelete} />
          </DropdownMenu>
        </div>
      </div>

      <CollapsibleContent className="pl-4 ml-3 border-l border-sidebar-border space-y-0.5 animate-fade-in">
        {chats.map((chat) => (
          <div key={chat.id} className="group/chat flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
                    selectedChatId === chat.id ? "bg-accent/50 text-accent-foreground font-medium" : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                  onClick={() => onChatSelect(chat)}
                >
                  <div className={cn("h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0", selectedChatId === chat.id ? "bg-accent/30 text-accent-foreground" : "bg-muted text-muted-foreground")}>
                    <MessageSquare className="h-3 w-3" />
                  </div>
                  <span className="truncate">{isDefaultChatName(chat.name) ? t('sidebar.newChatName') : chat.name}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-[350px] z-[100]">{isDefaultChatName(chat.name) ? t('sidebar.newChatName') : chat.name}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <ChatActionsMenuContent permissions={permissions} onRenameChat={() => onRenameChat(chat.id, chat.name)} onManageDocuments={() => handleManageChatDocs(chat)} onDeleteChat={() => onDeleteChat(chat)} />
            </DropdownMenu>
          </div>
        ))}
        {chats.length === 0 && <p className="text-xs text-sidebar-muted px-2 py-1">{t('sidebar.noChats')}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SidebarNotebookItem({
  notebook,
  isSelected,
  onOpenNotebook,
  onManageNotebook,
  onManageDocuments,
  onArchiveNotebook,
  onDeleteNotebook,
}: {
  notebook: DbNotebook;
  isSelected: boolean;
  onOpenNotebook: () => void;
  onManageNotebook: () => void;
  onManageDocuments: () => void;
  onArchiveNotebook: () => void;
  onDeleteNotebook: () => void;
}) {
  const { data: myRole } = useItemRole(notebook.id, 'notebook');
  const permissions = getItemPermissions(myRole);

  return (
    <div className="group flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
              isSelected
                ? "bg-accent/50 text-accent-foreground font-medium"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
            onClick={onOpenNotebook}
          >
            <div className={cn("h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0", isSelected ? "bg-accent/30 text-accent-foreground" : "bg-muted text-muted-foreground")}>
              <BookOpenCheck className="h-3 w-3" />
            </div>
            <span className="truncate">{notebook.name}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-[350px] z-[100]">{notebook.name}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-5 w-5 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0">
            <MoreHorizontal className="h-3 w-3" />
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
