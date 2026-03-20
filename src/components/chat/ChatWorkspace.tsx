import React from 'react';
import { MessageSquarePlus, FileText, Zap, Shield } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChatMessage } from './ChatMessage';
import { useCreateChat } from '@/hooks/useChats';
import { ChatInput } from './ChatInput';
import { useApp } from '@/contexts/AppContext';
import { useMessages } from '@/hooks/useMessages';
import { useProjects } from '@/hooks/useProjects';
import { ProjectsLanding } from '@/components/projects/ProjectsLanding';

export function ChatWorkspace() {
  const { selectedProjectId, selectedChatId } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: messages = [], isLoading: messagesLoading } = useMessages(selectedChatId ?? undefined);
  
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  if (!selectedProjectId || !selectedProject) {
    return <ProjectsLanding />;
  }

  if (!selectedChatId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-6 max-w-lg px-4 animate-fade-in">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center">
            <MessageSquarePlus className="h-8 w-8 text-accent-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Start a New Chat</h2>
            <p className="text-muted-foreground">
              Create a new chat in <span className="font-medium text-foreground">{selectedProject.name}</span> to begin exploring your knowledge base.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4">
            <FeatureCard icon={<FileText className="h-5 w-5" />} title="Document Analysis" description="Query across all your uploaded documents" />
            <FeatureCard icon={<Zap className="h-5 w-5" />} title="Instant Answers" description="Get accurate responses with source citations" />
            <FeatureCard icon={<Shield className="h-5 w-5" />} title="Secure & Private" description="Your data stays within your workspace" />
          </div>
          <Button className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground">
            <MessageSquarePlus className="h-4 w-4" /> Create New Chat
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScrollArea className="flex-1 p-4">
        <div className="max-w-3xl mx-auto space-y-6">
          {messagesLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState 
              icon={<MessageSquarePlus className="h-10 w-10 text-accent" />}
              title="No messages yet"
              description="Start the conversation by asking a question about your documents."
            />
          ) : (
            messages.map((message) => (
              <ChatMessage key={message.id} message={{
                id: message.id,
                role: message.role,
                content: message.content,
                sources: message.sources || [],
                timestamp: message.created_at,
                modelId: message.model_id ?? undefined,
              }} />
            ))
          )}
        </div>
      </ScrollArea>
      <ChatInput />
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="text-center py-12 animate-fade-in">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mb-4">{icon}</div>
      <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">{description}</p>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 rounded-xl border border-border bg-card hover-lift">
      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent mb-3">{icon}</div>
      <h4 className="font-medium text-sm text-foreground mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
