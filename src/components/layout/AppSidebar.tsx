import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChevronLeft, ChevronRight, Plus, Search, Users, MessageSquare, FolderOpen,
  MoreHorizontal, Bell, ChevronDown, ChevronUp,
  ArrowUpAZ, ArrowDownAZ, Clock, ChevronsUpDown, ChevronsDownUp, FileText,
  Settings, Share2, Archive, Trash2, Pencil, Sparkles, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useProjects, useDeleteProject, useArchiveProject, useUpdateProject, DbProject } from '@/hooks/useProjects';
import { useChats, useCreateChat, useDeleteChat, useUpdateChat, DbChat } from '@/hooks/useChats';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkspaceSearchResults } from '@/components/search/WorkspaceSearchResults';
import { toast } from 'sonner';

import { planIcons, planLabels } from '@/lib/planConfig';

export function AppSidebar() {
  const { 
    sidebarCollapsed, setSidebarCollapsed, 
    selectedProjectId, setSelectedProjectId,
    selectedChatId, setSelectedChatId,
    setActiveView,
    unreadCount, setShowNewProject, setShowNotifications,
  } = useApp();

  const { user: authUser, profile } = useAuth();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);
  const createChat = useCreateChat();
  const deleteProject = useDeleteProject();
  const archiveProject = useArchiveProject();
  const updateProject = useUpdateProject();
  const deleteChat = useDeleteChat();
  const updateChat = useUpdateChat();

  const [editProject, setEditProject] = useState<DbProject | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLanguage, setEditLanguage] = useState<'en' | 'sr-lat'>('en');
  const [isImprovingDesc, setIsImprovingDesc] = useState(false);
  const [renameChatId, setRenameChatId] = useState<string | null>(null);
  const [renameChatValue, setRenameChatValue] = useState('');

  const displayName = profile?.full_name || authUser?.user_metadata?.full_name || authUser?.email || '';
  const displayEmail = profile?.email || authUser?.email || '';
  const avatarUrl = profile?.avatar_url || authUser?.user_metadata?.avatar_url || '';
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : displayEmail?.[0]?.toUpperCase() || '?';

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [alphaSort, setAlphaSort] = useState<'none' | 'asc' | 'desc'>('none');
  const [dateSort, setDateSort] = useState<'updated' | 'newest' | 'oldest'>('updated');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-expand selected project
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

  const alphaLabel = { none: 'Sort A→Z', asc: 'Sorted A→Z', desc: 'Sorted Z→A' }[alphaSort];
  const dateLabel = { updated: 'Recently updated', newest: 'Newest first', oldest: 'Oldest first' }[dateSort];

  const expandAll = () => setExpandedProjects(new Set(projects.map(p => p.id)));
  const collapseAll = () => setExpandedProjects(new Set());

  useEffect(() => { searchQuery.trim() ? setShowSearchResults(true) : setShowSearchResults(false); }, [searchQuery]);
  useEffect(() => { if (showSearch && searchInputRef.current) searchInputRef.current.focus(); }, [showSearch]);

  const toggleProject = (projectId: string) => {
    const next = new Set(expandedProjects);
    next.has(projectId) ? next.delete(projectId) : next.add(projectId);
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
      name: `New Chat`,
      language: project?.language || 'en',
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
        if (selectedProjectId === projectId) {
          setSelectedProjectId(null);
          setSelectedChatId(null);
        }
        toast.success('Project and all its chats deleted');
      }
    });
  };

  const handleArchiveProject = (projectId: string) => {
    archiveProject.mutate(projectId, {
      onSuccess: () => {
        if (selectedProjectId === projectId) {
          setSelectedProjectId(null);
          setSelectedChatId(null);
        }
        toast.success('Project archived');
      }
    });
  };

  const handleManageProject = (project: DbProject) => {
    setEditProject(project);
    setEditName(project.name);
    setEditDescription(project.description || '');
    setEditLanguage((project.language as 'en' | 'sr-lat') || 'en');
  };

  const handleManageSubmit = () => {
    if (!editProject || !editName.trim() || !editDescription.trim()) return;
    updateProject.mutate({ id: editProject.id, name: editName.trim(), description: editDescription.trim(), language: editLanguage }, {
      onSuccess: () => {
        toast.success('Project updated');
        setEditProject(null);
      }
    });
  };

  const handleCloseSearch = () => { setShowSearchResults(false); setSearchQuery(''); };

  const currentPlan = ((profile?.plan as keyof typeof planIcons) || 'free') as keyof typeof planIcons;
  const PlanIcon = planIcons[currentPlan];

  if (sidebarCollapsed) {
    return (
      <div className="w-14 h-screen bg-sidebar flex flex-col items-center py-4 border-r border-sidebar-border">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent mb-4" onClick={() => setSidebarCollapsed(false)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-primary hover:bg-sidebar-accent mb-2" onClick={() => setShowNewProject(true)}>
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New Project</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground/70 hover:bg-sidebar-accent mb-2" onClick={() => setSidebarCollapsed(false)}>
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Search workspace</TooltipContent>
        </Tooltip>
        {selectedProjectId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="text-sidebar-foreground/70 hover:bg-sidebar-accent mb-2" onClick={(e) => handleNewChat(selectedProjectId, e)}>
                <MessageSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New Chat</TooltipContent>
          </Tooltip>
        )}
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-3 mb-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", `plan-badge-${currentPlan}`)}>
                <PlanIcon className="h-4 w-4" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{planLabels[currentPlan]} Plan</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-sidebar-foreground/70 hover:bg-sidebar-accent" onClick={() => setShowNotifications(true)}>
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center">{unreadCount}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Notifications</TooltipContent>
          </Tooltip>
          <Avatar className="h-8 w-8 cursor-pointer">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-xs">{initials}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-sidebar flex flex-col border-r border-sidebar-border animate-slide-in-left">
      {/* Header */}
      <div className="p-3 flex items-center justify-between border-b border-sidebar-border">
        <Button className="flex-1 justify-start gap-2 bg-sidebar-primary hover:bg-sidebar-primary/90 text-sidebar-primary-foreground" size="sm" onClick={() => setShowNewProject(true)}>
          <Plus className="h-4 w-4" /> New Project
        </Button>
        <Button variant="ghost" size="icon" className="ml-2 text-sidebar-foreground/70 hover:bg-sidebar-accent" onClick={() => setSidebarCollapsed(true)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="p-3 relative">
        <button className="sidebar-item w-full justify-start" onClick={() => setShowSearch(!showSearch)}>
          <Search className="h-4 w-4" /><span className="text-sm">Search workspace</span>
        </button>
        {showSearch && (
          <div className="mt-2 animate-fade-in relative">
            <Input ref={searchInputRef} placeholder="Search projects, chats..." className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-muted text-sm" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {showSearchResults && <WorkspaceSearchResults query={searchQuery} onClose={handleCloseSearch} />}
          </div>
        )}
      </div>

      {/* Projects List */}
      <ScrollArea className="flex-1 px-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 py-2">
            <p className="text-xs font-medium text-sidebar-muted uppercase tracking-wider">My Projects</p>
            <div className="flex items-center gap-0.5">
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent", alphaSort !== 'none' ? "text-primary" : "text-sidebar-muted")} onClick={cycleAlphaSort}>
                  {alphaSort === 'desc' ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger><TooltipContent side="top" className="text-xs">{alphaLabel}</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent", alphaSort === 'none' ? "text-primary" : "text-sidebar-muted")} onClick={cycleDateSort}>
                  <Clock className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger><TooltipContent side="top" className="text-xs">{dateLabel}</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={expandedProjects.size === projects.length ? collapseAll : expandAll}>
                  {expandedProjects.size === projects.length ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger><TooltipContent side="top" className="text-xs">{expandedProjects.size === projects.length ? 'Collapse all' : 'Expand all'}</TooltipContent></Tooltip>
            </div>
          </div>
          
          {projectsLoading && <p className="text-xs text-sidebar-muted px-2 py-4 text-center">Loading projects...</p>}
          
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
              onDeleteChat={(chatId) => {
                deleteChat.mutate({ id: chatId, projectId: project.id }, {
                  onSuccess: () => {
                    if (selectedChatId === chatId) setSelectedChatId(null);
                    toast.success('Chat deleted');
                  }
                });
              }}
              onRenameChat={(chatId, currentName) => {
                setRenameChatId(chatId);
                setRenameChatValue(currentName);
              }}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-3 border-t border-sidebar-border space-y-3">
        <div className={cn("rounded-lg p-3 flex items-center gap-3", `plan-badge-${currentPlan}`)}>
          <PlanIcon className="h-5 w-5" />
          <div className="flex-1">
            <p className="text-sm font-medium">{planLabels[currentPlan]} Plan</p>
            {currentPlan !== 'enterprise' && <p className="text-xs opacity-80">Upgrade for more features</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-sm">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName || 'User'}</p>
            <p className="text-xs text-sidebar-muted truncate">{displayEmail}</p>
          </div>
          <Button variant="ghost" size="icon" className="relative text-sidebar-foreground/70 hover:bg-sidebar-accent" onClick={() => setShowNotifications(true)}>
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center">{unreadCount}</span>}
          </Button>
        </div>
      </div>

      {/* Manage Project Dialog */}
      <Dialog open={!!editProject} onOpenChange={(open) => !open && setEditProject(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Manage Project</DialogTitle>
            <DialogDescription>Update your project details. The description helps the AI provide better answers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-project-name">Project name <span className="text-destructive">*</span></Label>
              <Input
                id="edit-project-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Project name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-project-desc">Description <span className="text-destructive">*</span></Label>
              <Textarea
                id="edit-project-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Describe what this project is about..."
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">This helps the AI understand the project context and provide better answers.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-project-lang">Language</Label>
              <Select value={editLanguage} onValueChange={(val: 'en' | 'sr-lat') => setEditLanguage(val)}>
                <SelectTrigger id="edit-project-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="sr-lat">Serbian (Latin)</SelectItem>
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

      {/* Rename Chat Dialog */}
      <Dialog open={!!renameChatId} onOpenChange={(open) => !open && setRenameChatId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameChatValue}
            onChange={(e) => setRenameChatValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameChatId && renameChatValue.trim()) {
                updateChat.mutate({ id: renameChatId, name: renameChatValue.trim() }, {
                  onSuccess: () => { toast.success('Chat renamed'); setRenameChatId(null); }
                });
              }
            }}
            placeholder="Chat name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameChatId(null)}>Cancel</Button>
            <Button
              disabled={!renameChatValue.trim()}
              onClick={() => {
                if (!renameChatId || !renameChatValue.trim()) return;
                updateChat.mutate({ id: renameChatId, name: renameChatValue.trim() }, {
                  onSuccess: () => { toast.success('Chat renamed'); setRenameChatId(null); }
                });
              }}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Extracted project item with its own chats query
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
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, currentName: string) => void;
}) {
  const { data: chats = [] } = useChats(isExpanded ? project.id : undefined);
  const { setSelectedProjectId, setSelectedChatId, setActiveView } = useApp();

  const handleManageProjectDocs = () => {
    setSelectedProjectId(project.id);
    setSelectedChatId(null);
    setActiveView('project-documents');
  };

  const handleManageChatDocs = (chat: DbChat) => {
    setSelectedProjectId(project.id);
    setSelectedChatId(chat.id);
    setActiveView('chat-documents');
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="group flex items-center">
        <CollapsibleTrigger asChild>
          <button className="p-1 hover:bg-sidebar-accent rounded">
            {isExpanded ? <ChevronDown className="h-3 w-3 text-sidebar-muted" /> : <ChevronRight className="h-3 w-3 text-sidebar-muted" />}
          </button>
        </CollapsibleTrigger>
        <button
          className={cn(
            "flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
            isSelected
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          )}
          onClick={onSelect}
        >
          <div className={cn("h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0", isSelected ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary/70")}>
            <FolderOpen className="h-3.5 w-3.5" />
          </div>
          <span className="truncate">{project.name}</span>
        </button>
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-sidebar-primary hover:text-sidebar-primary hover:bg-sidebar-accent" onClick={onNewChat}>
            <Plus className="h-3 w-3" />
          </Button>
        </TooltipTrigger><TooltipContent>New Chat</TooltipContent></Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent">
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onRename}>
              <Settings className="h-3.5 w-3.5 mr-2" /> Manage project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleManageProjectDocs}>
              <FileText className="h-3.5 w-3.5 mr-2" /> Manage documents
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Share2 className="h-3.5 w-3.5 mr-2" /> Share project
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onArchive}>
              <Archive className="h-3.5 w-3.5 mr-2" /> Archive project
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollapsibleContent className="pl-4 ml-3 border-l border-sidebar-border space-y-0.5 animate-fade-in">
        {chats.map((chat) => (
          <div key={chat.id} className="group/chat flex items-center">
            <button
              className={cn(
                "flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
                selectedChatId === chat.id
                  ? "bg-accent/50 text-accent-foreground font-medium"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
              onClick={() => onChatSelect(chat)}
            >
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0", selectedChatId === chat.id ? "bg-accent/30 text-accent-foreground" : "bg-muted text-muted-foreground")}>
                <MessageSquare className="h-3 w-3" />
              </div>
              <span className="truncate">{chat.name}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover/chat:opacity-100 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => onRenameChat(chat.id, chat.name)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Rename chat
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleManageChatDocs(chat)}>
                  <FileText className="h-3.5 w-3.5 mr-2" /> Manage documents
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => onDeleteChat(chat.id)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {chats.length === 0 && <p className="text-xs text-sidebar-muted px-2 py-1">No chats yet</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
