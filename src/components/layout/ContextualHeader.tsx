import React from 'react';
import { 
  Plus, 
  Search, 
  Settings, 
  FileText, 
  MessageSquare,
  FolderOpen,
  Calendar,
  Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';

export function ContextualHeader() {
  const { selectedProject, selectedChat, setShowSettings, setShowDocuments, addChat } = useApp();

  const handleNewChat = () => {
    if (selectedProject) {
      addChat(selectedProject.id);
    }
  };

  if (!selectedProject) {
    return (
      <div className="h-12 bg-muted/30 border-b border-border flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Select a project to get started</p>
      </div>
    );
  }

  // Chat selected view
  if (selectedChat) {
    return (
      <div className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-accent" />
            <h2 className="font-medium text-foreground">{selectedChat.name}</h2>
          </div>
          
          {selectedChat.documents.length > 0 && (
            <>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {selectedChat.documents.length} document{selectedChat.documents.length !== 1 ? 's' : ''}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search in this chat..." 
              className="pl-9 h-8 text-sm bg-secondary/50"
            />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSettings('chat')}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat Settings</TooltipContent>
          </Tooltip>
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
            <h2 className="text-lg font-semibold text-foreground">{selectedProject.name}</h2>
            {selectedProject.isShared && (
              <Badge variant="secondary" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                Shared
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {selectedProject.description}
          </p>
        </div>

        <Button 
          className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground"
          onClick={handleNewChat}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Project Meta */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>{selectedProject.documents.length} documents</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            <span>{selectedProject.chats.length} chats</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Updated {new Date(selectedProject.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setShowDocuments(true)}
        >
          <FileText className="h-4 w-4" />
          Manage Documents
        </Button>
      </div>

      {/* Chats Preview - Limited to 3 most recent */}
      {selectedProject.chats.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <h3 className="text-sm font-medium text-foreground mb-2">Recent Chats</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {[...selectedProject.chats]
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
              .slice(0, 3)
              .map((chat) => (
                <ChatPreviewCard key={chat.id} chat={chat} />
              ))}
          </div>
          {selectedProject.chats.length > 3 && (
            <button 
              className="mt-3 text-sm text-accent hover:text-accent/80 transition-colors"
              onClick={() => {
                // Scroll sidebar into view or expand - mock interaction
                const sidebar = document.querySelector('[data-sidebar="sidebar"]');
                sidebar?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              View all {selectedProject.chats.length} chats →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChatPreviewCard({ chat }: { chat: { id: string; name: string; messages: any[]; updatedAt: string } }) {
  const { setSelectedChat, selectedProject } = useApp();
  
  const lastMessage = chat.messages[chat.messages.length - 1];
  
  return (
    <button
      className="p-3 rounded-lg border border-border bg-card hover:bg-secondary/50 text-left transition-colors hover-lift"
      onClick={() => setSelectedChat(chat as any)}
    >
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-3.5 w-3.5 text-accent" />
        <span className="font-medium text-sm text-foreground truncate">{chat.name}</span>
      </div>
      {lastMessage && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {lastMessage.content.slice(0, 80)}...
        </p>
      )}
      <p className="text-[10px] text-muted-foreground mt-1">
        {new Date(chat.updatedAt).toLocaleDateString()}
      </p>
    </button>
  );
}
