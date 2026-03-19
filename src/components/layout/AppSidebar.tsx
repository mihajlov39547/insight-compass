import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Search, 
  Users, 
  MessageSquare, 
  FolderOpen,
  MoreHorizontal,
  Bell,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Crown,
  Zap,
  Building2,
  ArrowUpAZ,
  ArrowDownAZ,
  Clock,
  ChevronsUpDown,
  ChevronsDownUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';
import { Project, Chat } from '@/data/mockData';
import { WorkspaceSearchResults } from '@/components/search/WorkspaceSearchResults';

const planIcons = {
  free: Sparkles,
  basic: Zap,
  premium: Crown,
  enterprise: Building2,
};

const planLabels = {
  free: 'Free',
  basic: 'Basic',
  premium: 'Premium',
  enterprise: 'Enterprise',
};

export function AppSidebar() {
  const { 
    sidebarCollapsed, 
    setSidebarCollapsed, 
    projects, 
    sharedWithMeProjects,
    selectedProject, 
    setSelectedProject,
    selectedChat,
    setSelectedChat,
    user,
    unreadCount,
    setShowNewProject,
    addChat,
    setShowNotifications,
  } = useApp();

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set([selectedProject?.id || ''])
  );
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showSharedWithMe, setShowSharedWithMe] = useState(false);
  const [alphaSort, setAlphaSort] = useState<'none' | 'asc' | 'desc'>('none');
  const [dateSort, setDateSort] = useState<'updated' | 'newest' | 'oldest'>('updated');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sortedProjects = useMemo(() => {
    const sorted = [...projects];
    if (alphaSort === 'asc') return sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (alphaSort === 'desc') return sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (dateSort === 'newest') return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (dateSort === 'oldest') return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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

  const expandAll = () => {
    setExpandedProjects(new Set(projects.map(p => p.id)));
  };

  const collapseAll = () => {
    setExpandedProjects(new Set());
  };

  // Handle search input changes
  useEffect(() => {
    if (searchQuery.trim()) {
      setShowSearchResults(true);
    } else {
      setShowSearchResults(false);
    }
  }, [searchQuery]);

  // Focus search input when search is shown
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  const handleProjectSelect = (project: Project) => {
    setSelectedProject(project);
    setSelectedChat(null);
    if (!expandedProjects.has(project.id)) {
      toggleProject(project.id);
    }
  };

  const handleChatSelect = (chat: Chat, project: Project) => {
    setSelectedProject(project);
    setSelectedChat(chat);
  };

  const handleNewChatFromSidebar = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    addChat(projectId);
  };

  const handleCloseSearch = () => {
    setShowSearchResults(false);
    setSearchQuery('');
  };

  const PlanIcon = planIcons[user.plan];

  if (sidebarCollapsed) {
    return (
      <div className="w-14 h-screen bg-sidebar flex flex-col items-center py-4 border-r border-sidebar-border">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-sidebar-foreground hover:bg-sidebar-accent mb-4"
              onClick={() => setSidebarCollapsed(false)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-sidebar-primary hover:bg-sidebar-accent mb-2"
              onClick={() => setShowNewProject(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New Project</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent mb-2"
              onClick={() => setSidebarCollapsed(false)}
            >
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Search workspace</TooltipContent>
        </Tooltip>

        {selectedProject && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent mb-2"
                onClick={() => addChat(selectedProject.id)}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New Chat</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent"
            >
              <Users className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Shared with me</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-3 mb-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center",
                `plan-badge-${user.plan}`
              )}>
                <PlanIcon className="h-4 w-4" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{planLabels[user.plan]} Plan</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-sidebar-foreground/70 hover:bg-sidebar-accent" onClick={() => setShowNotifications(true)}>
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Notifications</TooltipContent>
          </Tooltip>

          <Avatar className="h-8 w-8 cursor-pointer">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-xs">
              {user.initials}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-sidebar flex flex-col border-r border-sidebar-border animate-slide-in-left">
      {/* Header */}
      <div className="p-3 flex items-center justify-between border-b border-sidebar-border">
        <Button 
          className="flex-1 justify-start gap-2 bg-sidebar-primary hover:bg-sidebar-primary/90 text-sidebar-primary-foreground"
          size="sm"
          onClick={() => setShowNewProject(true)}
        >
          <Plus className="h-4 w-4" />
          New Project
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="ml-2 text-sidebar-foreground/70 hover:bg-sidebar-accent"
          onClick={() => setSidebarCollapsed(true)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="p-3 relative">
        <button 
          className="sidebar-item w-full justify-start"
          onClick={() => setShowSearch(!showSearch)}
        >
          <Search className="h-4 w-4" />
          <span className="text-sm">Search workspace</span>
        </button>
        {showSearch && (
          <div className="mt-2 animate-fade-in relative">
            <Input 
              ref={searchInputRef}
              placeholder="Search projects, chats, documents..." 
              className="bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-muted text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {showSearchResults && (
              <WorkspaceSearchResults 
                query={searchQuery} 
                onClose={handleCloseSearch} 
              />
            )}
          </div>
        )}
      </div>

      {/* Projects List */}
      <ScrollArea className="flex-1 px-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 py-2">
            <p className="text-xs font-medium text-sidebar-muted uppercase tracking-wider">
              My Projects
            </p>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                      alphaSort !== 'none' ? "text-primary" : "text-sidebar-muted"
                    )}
                    onClick={cycleAlphaSort}
                  >
                    {alphaSort === 'desc' ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">{alphaLabel}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                      alphaSort === 'none' ? "text-primary" : "text-sidebar-muted"
                    )}
                    onClick={cycleDateSort}
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">{dateLabel}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    onClick={expandedProjects.size === projects.length ? collapseAll : expandAll}
                  >
                    {expandedProjects.size === projects.length ? 
                      <ChevronsDownUp className="h-3.5 w-3.5" /> : 
                      <ChevronsUpDown className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {expandedProjects.size === projects.length ? 'Collapse all' : 'Expand all'}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          
          {sortedProjects.map((project) => (
            <Collapsible 
              key={project.id}
              open={expandedProjects.has(project.id)}
              onOpenChange={() => toggleProject(project.id)}
            >
              <div className="group flex items-center">
                <CollapsibleTrigger asChild>
                  <button className="p-1 hover:bg-sidebar-accent rounded">
                    {expandedProjects.has(project.id) ? (
                      <ChevronDown className="h-3 w-3 text-sidebar-muted" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-sidebar-muted" />
                    )}
                  </button>
                </CollapsibleTrigger>
                
                <button
                  className={cn(
                    "flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    selectedProject?.id === project.id && !selectedChat
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                  onClick={() => handleProjectSelect(project)}
                >
                  <div className={cn(
                    "h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0",
                    selectedProject?.id === project.id && !selectedChat
                      ? "bg-primary/20 text-primary"
                      : "bg-primary/10 text-primary/70"
                  )}>
                    <FolderOpen className="h-3.5 w-3.5" />
                  </div>
                  <span className="truncate">{project.name}</span>
                </button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-sidebar-primary hover:text-sidebar-primary hover:bg-sidebar-accent"
                      onClick={(e) => handleNewChatFromSidebar(project.id, e)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New Chat</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem>Rename project</DropdownMenuItem>
                    <DropdownMenuItem>Share project</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>Archive project</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">Delete project</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <CollapsibleContent className="pl-4 ml-3 border-l border-sidebar-border space-y-0.5 animate-fade-in">
                {project.chats.map((chat) => (
                  <button
                    key={chat.id}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
                      selectedChat?.id === chat.id
                        ? "bg-accent/50 text-accent-foreground font-medium"
                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                    onClick={() => handleChatSelect(chat, project)}
                  >
                    <div className={cn(
                      "h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0",
                      selectedChat?.id === chat.id
                        ? "bg-accent/30 text-accent-foreground"
                        : "bg-muted text-muted-foreground"
                    )}>
                      <MessageSquare className="h-3 w-3" />
                    </div>
                    <span className="truncate">{chat.name}</span>
                  </button>
                ))}
                {project.chats.length === 0 && (
                  <p className="text-xs text-sidebar-muted px-2 py-1">No chats yet</p>
                )}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>

        {/* Shared with me */}
        <div className="mt-4 space-y-1">
          <Collapsible open={showSharedWithMe} onOpenChange={setShowSharedWithMe}>
            <CollapsibleTrigger className="sidebar-item w-full">
              <Users className="h-4 w-4" />
              <span className="flex-1 text-left text-sm">Shared with me</span>
              {showSharedWithMe ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-4 mt-1 space-y-1 animate-fade-in">
              {sharedWithMeProjects.map((project) => (
                <button
                  key={project.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
                    selectedProject?.id === project.id
                      ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                  onClick={() => handleProjectSelect(project)}
                >
                  <FolderOpen className="h-4 w-4 flex-shrink-0" />
                  <div className="flex-1 text-left truncate">
                    <span className="block truncate">{project.name}</span>
                    <span className="text-xs text-sidebar-muted">by {project.sharedBy}</span>
                  </div>
                </button>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-3 border-t border-sidebar-border space-y-3">
        {/* Plan Badge */}
        <div className={cn(
          "rounded-lg p-3 flex items-center gap-3",
          `plan-badge-${user.plan}`
        )}>
          <PlanIcon className="h-5 w-5" />
          <div className="flex-1">
            <p className="text-sm font-medium">{planLabels[user.plan]} Plan</p>
            {user.plan !== 'enterprise' && (
              <p className="text-xs opacity-80">Upgrade for more features</p>
            )}
          </div>
        </div>

        {/* User Area */}
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-sm">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
            <p className="text-xs text-sidebar-muted truncate">{user.email}</p>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="relative text-sidebar-foreground/70 hover:bg-sidebar-accent"
            onClick={() => setShowNotifications(true)}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
