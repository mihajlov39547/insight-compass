import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, FileText, Zap, Shield, MessageSquare,
  Atom, FlaskConical, Microscope, Scale, Landmark,
  Scroll, Wrench, Rocket, Cpu, Leaf, Globe, BookOpen,
  Brain, Library, Lightbulb, Palette, Music, Heart,
  BarChart3, GraduationCap, Camera, MoreHorizontal, Sparkles, Loader2
} from 'lucide-react';
import { useApp } from '@/contexts/useApp';
import { useProjects, useDeleteProject, useArchiveProject, useUpdateProject, DbProject } from '@/hooks/useProjects';
import { useChats } from '@/hooks/useAllChats';
import { useDocuments } from '@/hooks/useDocuments';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/contexts/useAuth';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ProjectActionsMenuContent } from '@/components/actions/EntityActionMenus';
import { useItemRole } from '@/hooks/useItemRole';
import { getItemPermissions } from '@/lib/permissions';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

function formatLastActivity(dateStr: string, t: (key: string) => string, locale: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('projectsLanding.time.today');
    if (diffDays === 1) return t('projectsLanding.time.yesterday');
    if (diffDays < 7) return formatDistanceToNow(date, { addSuffix: true });
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ProjectsLanding() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.resolvedLanguage === 'sr' ? 'sr-Latn' : 'en-US';
  const {
    setShowNewProject,
    setSelectedProjectId,
    selectedProjectId,
    setSelectedChatId,
    setActiveView,
  } = useApp();
  const { data: projects = [], isLoading } = useProjects();
  const deleteProject = useDeleteProject();
  const archiveProject = useArchiveProject();
  const updateProject = useUpdateProject();
  const { data: allChats = [] } = useChats();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { user } = useAuth();

  const [editProject, setEditProject] = React.useState<DbProject | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [editLanguage, setEditLanguage] = React.useState<'en' | 'sr'>('en');
  const [isImprovingDesc, setIsImprovingDesc] = React.useState(false);

  const { data: allDocCounts = {} } = useQuery({
    queryKey: ['all-document-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents' as any)
        .select('project_id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((d: any) => {
        counts[d.project_id] = (counts[d.project_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!user,
  });

  const chatCountByProject = useMemo(() => {
    const map: Record<string, number> = {};
    allChats.forEach(c => {
      map[c.project_id] = (map[c.project_id] || 0) + 1;
    });
    return map;
  }, [allChats]);

  const handleManageProject = (project: DbProject) => {
    setEditProject(project);
    setEditName(project.name);
    setEditDescription(project.description || '');
    setEditLanguage((project.language as 'en' | 'sr') || 'en');
  };

  const handleManageSubmit = () => {
    if (!editProject || !editName.trim() || !editDescription.trim()) return;
    updateProject.mutate({
      id: editProject.id,
      name: editName.trim(),
      description: editDescription.trim(),
      language: editLanguage,
    }, {
      onSuccess: () => {
        toast.success(t('projectsLanding.manage.updated'));
        setEditProject(null);
      },
    });
  };

  const handleImproveDescription = async () => {
    if (!editProject || isImprovingDesc) return;
    setIsImprovingDesc(true);
    try {
      const { data: docs } = await supabase
        .from('documents')
        .select('file_name, summary')
        .eq('project_id', editProject.id)
        .eq('processing_status', 'completed')
        .limit(15);

      const { data: chatList } = await supabase
        .from('chats')
        .select('name')
        .eq('project_id', editProject.id)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(10);

      const resp = await fetch(
        getFunctionUrl('/functions/v1/improve-description'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            projectName: editName,
            currentDescription: editDescription,
            documents: (docs ?? []).map(d => ({ fileName: d.file_name, summary: d.summary })),
            chats: (chatList ?? []).map(c => ({ name: c.name })),
          }),
        }
      );

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to improve description');
      if (data.description) {
        setEditDescription(data.description);
        toast.success(t('projectsLanding.manage.improveSuccess'));
      }
    } catch (err: any) {
      console.error('Improve description error:', err);
      toast.error(err.message || t('projectsLanding.manage.improveFailed'));
    } finally {
      setIsImprovingDesc(false);
    }
  };

  const handleManageProjectDocs = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedChatId(null);
    setActiveView('project-documents');
  };

  const handleArchiveProject = (projectId: string) => {
    archiveProject.mutate(projectId, {
      onSuccess: () => {
        if (selectedProjectId === projectId) {
          setSelectedProjectId(null);
          setSelectedChatId(null);
        }
        toast.success(t('projectsLanding.delete.archived'));
      },
    });
  };

  const handleDeleteProject = (projectId: string) => {
    setPendingDeleteId(projectId);
  };

  const confirmDeleteProject = () => {
    if (!pendingDeleteId) return;
    deleteProject.mutate(pendingDeleteId, {
      onSuccess: () => {
        if (selectedProjectId === pendingDeleteId) {
          setSelectedProjectId(null);
          setSelectedChatId(null);
        }
        toast.success(t('projectsLanding.delete.success'));
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

  const hasProjects = projects.length > 0;

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-6xl mx-auto px-6 py-10 animate-fade-in">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">{t('projectsLanding.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasProjects
              ? t('projectsLanding.count', { count: projects.length })
              : t('projectsLanding.empty')}
          </p>
        </div>

        {hasProjects ? (
          /* Project Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Create Card */}
            <button
              onClick={() => setShowNewProject(true)}
              className="group relative flex flex-col items-center justify-center min-h-[180px] rounded-xl border-2 border-dashed border-border bg-background hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center mb-3 group-hover:border-primary/40 group-hover:text-primary transition-colors">
                <Plus className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Create new project
              </span>
            </button>

            {/* Project Cards */}
            {projects.map((project, idx) => {
              const h = hashCode(project.id);
              const colorIdx = h % CARD_COLORS.length;
              const iconIdx = h % ICONS.length;
              const IconComponent = ICONS[iconIdx];
              const chatCount = chatCountByProject[project.id] || 0;
              const docCount = allDocCounts[project.id] || 0;

              return (
                <div
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setSelectedProjectId(project.id); setSelectedChatId(null); setActiveView('default'); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedProjectId(project.id); setSelectedChatId(null); setActiveView('default');
                    }
                  }}
                  className={`group relative flex flex-col justify-between min-h-[180px] rounded-xl border p-5 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-[0.98] ${CARD_COLORS[colorIdx]}`}
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <ProjectCardActions
                    project={project}
                    onManageProject={() => handleManageProject(project)}
                    onManageDocuments={() => handleManageProjectDocs(project.id)}
                    onArchiveProject={() => handleArchiveProject(project.id)}
                    onDeleteProject={() => handleDeleteProject(project.id)}
                  />
                  <div>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${ICON_COLORS[colorIdx]}`}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <h3 className="pr-8 font-semibold text-foreground text-sm leading-snug line-clamp-2 overflow-wrap-break-word">
                      {project.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 mt-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>{chatCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{docCount}</span>
                    </div>
                    <span className="ml-auto">{formatLastActivity(project.updated_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty State */
          <div className="space-y-10">
            <div className="flex justify-center">
              <button
                onClick={() => setShowNewProject(true)}
                className="group flex flex-col items-center justify-center w-72 h-48 rounded-xl border-2 border-dashed border-border bg-background hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
              >
                <div className="w-14 h-14 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center mb-3 group-hover:border-primary/40 transition-colors">
                  <Plus className="h-7 w-7 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  Create your first project
                </span>
              </button>
            </div>

            <div className="max-w-3xl mx-auto">
              <p className="text-center text-muted-foreground text-sm mb-8">
                Create a project to organize your documents, build a knowledge base, and get grounded answers.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FeatureBlock
                  icon={<FileText className="h-5 w-5" />}
                  title="Document Analysis"
                  description="Query across all your uploaded documents"
                />
                <FeatureBlock
                  icon={<Zap className="h-5 w-5" />}
                  title="Instant Answers"
                  description="Get accurate responses with source-aware retrieval"
                />
                <FeatureBlock
                  icon={<Shield className="h-5 w-5" />}
                  title="Secure & Private"
                  description="Your data stays inside your workspace and project context"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!editProject} onOpenChange={(open) => !open && setEditProject(null)}>
        <DialogContent className="sm:max-w-[480px]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Manage Project</DialogTitle>
            <DialogDescription>Update your project details. The description helps the AI provide better answers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="card-edit-project-name">Project name <span className="text-destructive">*</span></Label>
              <Input
                id="card-edit-project-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Project name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="card-edit-project-desc">Description <span className="text-destructive">*</span></Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-accent"
                  onClick={handleImproveDescription}
                  disabled={isImprovingDesc}
                >
                  {isImprovingDesc ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {isImprovingDesc ? 'Improving…' : 'Improve with AI'}
                </Button>
              </div>
              <Textarea
                id="card-edit-project-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Describe what this project is about..."
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">This helps the AI understand the project context and provide better answers.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-edit-project-lang">Language</Label>
              <Select value={editLanguage} onValueChange={(val: 'en' | 'sr') => setEditLanguage(val)}>
                <SelectTrigger id="card-edit-project-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="sr">Serbian (Latin)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setEditProject(null)}>Cancel</Button>
            <Button onClick={handleManageSubmit} disabled={!editName.trim() || !editDescription.trim()}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this project and all of its data, including:
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>All chats and messages</li>
                <li>All uploaded documents and files</li>
                <li>All extracted text, summaries, and processed data</li>
                <li>All linked resources and transcripts</li>
                <li>All sharing settings</li>
              </ul>
              <span className="block mt-2 font-medium">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProjectCardActions({
  project,
  onManageProject,
  onManageDocuments,
  onArchiveProject,
  onDeleteProject,
}: {
  project: DbProject;
  onManageProject: () => void;
  onManageDocuments: () => void;
  onArchiveProject: () => void;
  onDeleteProject: () => void;
}) {
  const { data: myRole } = useItemRole(project.id, 'project');
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
        <ProjectActionsMenuContent
          permissions={permissions}
          onManageProject={onManageProject}
          onManageDocuments={onManageDocuments}
          onArchiveProject={onArchiveProject}
          onDeleteProject={onDeleteProject}
        />
      </DropdownMenu>
    </div>
  );
}

function FeatureBlock({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-5 rounded-xl border border-border bg-card text-center">
      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent mx-auto mb-3">
        {icon}
      </div>
      <h4 className="font-medium text-sm text-foreground mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
