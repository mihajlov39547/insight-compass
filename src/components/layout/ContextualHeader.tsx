import React from 'react';
import { 
  Plus, Search, Settings, FileText, MessageSquare, FolderOpen, Calendar, Upload, Share2
} from 'lucide-react';
import { ProjectChatGrid } from '@/components/dashboard/ProjectChatGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { InlineRenameTitle } from '@/components/shared/InlineRenameTitle';
import { useApp } from '@/contexts/AppContext';
import { useProjects, useUpdateProject } from '@/hooks/useProjects';
import { useChats, useCreateChat, useUpdateChat } from '@/hooks/useChats';
import { useDocuments } from '@/hooks/useDocuments';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function ContextualHeader() {
  const { selectedProjectId, selectedChatId, setSelectedChatId, setShowSettings, setShowDocuments, setDocumentScope, setActiveView, setShowShare } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);
  const { data: documents = [] } = useDocuments(selectedProjectId ?? undefined, undefined);
  const createChat = useCreateChat();
  const updateProject = useUpdateProject();
  const updateChat = useUpdateChat();
  
  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedChat = chats.find(c => c.id === selectedChatId);

  const handleNewChat = () => {
    if (selectedProject) {
      createChat.mutate({
        projectId: selectedProject.id,
        name: 'New Chat',
        language: selectedProject.language || 'en',
      }, {
        onSuccess: (chat) => setSelectedChatId(chat.id),
      });
    }
  };

  if (!selectedProject) {
    return (
      <div className="h-12 bg-muted/30 border-b border-border flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Select a project to get started</p>
      </div>
    );
  }

  if (selectedChat) {
    return (
      <div className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-accent" />
            <InlineRenameTitle
              value={selectedChat.name}
              onSave={async (name) => {
                await updateChat.mutateAsync({ id: selectedChat.id, name });
                toast.success('Chat renamed');
              }}
              className="font-medium text-foreground text-base"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search in this chat..." className="pl-9 h-8 text-sm bg-secondary/50" />
          </div>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setShowSettings(true)}>
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger><TooltipContent>Chat Settings</TooltipContent></Tooltip>
        </div>
      </div>
    );
  }

  // Project selected view (no chat)
  return (
    <div className="bg-card border-b border-border px-6 py-4 shrink-0 animate-fade-in">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen className="h-5 w-5 text-accent" />
            <InlineRenameTitle
              value={selectedProject.name}
              onSave={async (name) => {
                await updateProject.mutateAsync({ id: selectedProject.id, name });
                toast.success('Project renamed');
              }}
              className="text-lg font-semibold text-foreground"
            />
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">{selectedProject.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowShare(true)}>
            <Share2 className="h-4 w-4" /> Share
          </Button>
          <Button className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleNewChat}>
            <Plus className="h-4 w-4" /> New Chat
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            <span>{chats.length} chat{chats.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Updated {new Date(selectedProject.updated_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setActiveView('project-documents')}>
            <FileText className="h-4 w-4" /> Manage Documents
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm mt-1.5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
        </div>
        {documents.length > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Upload className="h-4 w-4" />
            <span>Last upload {new Date(documents[0].created_at).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Chat grid */}
      {chats.length > 0 && <ProjectChatGrid chats={chats} />}
    </div>
  );
}
