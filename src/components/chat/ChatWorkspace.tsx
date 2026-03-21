import React, { useEffect, useRef } from 'react';
import { MessageSquarePlus, FileText, Zap, Shield, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChatMessage } from './ChatMessage';
import { useCreateChat, useChats } from '@/hooks/useChats';
import { ChatInput } from './ChatInput';
import { useApp } from '@/contexts/AppContext';
import { useMessages } from '@/hooks/useMessages';
import { useProjects } from '@/hooks/useProjects';
import { useAIChat } from '@/hooks/useAIChat';
import { ProjectsLanding } from '@/components/projects/ProjectsLanding';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export function ChatWorkspace() {
  const { selectedProjectId, selectedChatId, setSelectedChatId } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: messages = [], isLoading: messagesLoading } = useMessages(selectedChatId ?? undefined);
  const createChat = useCreateChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);
  const selectedChat = chats.find(c => c.id === selectedChatId);

  const { sendMessage, isGenerating, streamingContent, error, clearError, retry, failedPrompt } = useAIChat({
    chatId: selectedChatId ?? '',
    chatName: selectedChat?.name,
    projectId: selectedProjectId ?? undefined,
    projectDescription: selectedProject?.description,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent]);

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
          <div className="grid grid-cols-3 gap-4 pt-4">
            <FeatureCard icon={<FileText className="h-5 w-5" />} title="Document Analysis" description="Query across all your uploaded documents" />
            <FeatureCard icon={<Zap className="h-5 w-5" />} title="Instant Answers" description="Get accurate responses with source citations" />
            <FeatureCard icon={<Shield className="h-5 w-5" />} title="Secure & Private" description="Your data stays within your workspace" />
          </div>
          <Button
            className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={() => {
              createChat.mutate(
                { projectId: selectedProjectId!, name: 'New Chat', language: selectedProject!.language },
                { onSuccess: (chat) => setSelectedChatId(chat.id) }
              );
            }}
            disabled={createChat.isPending}
          >
            <MessageSquarePlus className="h-4 w-4" /> {createChat.isPending ? 'Creating...' : 'Create New Chat'}
          </Button>
        </div>
      </div>
    );
  }

  const handleSend = (content: string, modelId?: string) => {
    clearError();
    sendMessage(content, modelId);
  };

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

          {/* Streaming assistant message */}
          {isGenerating && streamingContent !== null && (
            <div className="flex gap-3 animate-fade-in">
              <Avatar className="h-8 w-8 shrink-0 bg-gradient-to-br from-accent to-accent/70">
                <AvatarFallback className="bg-transparent text-accent-foreground">
                  <Sparkles className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="max-w-[75%] space-y-2">
                <div className="chat-bubble-assistant">
                  {streamingContent ? (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">{streamingContent}</div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span>Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error state with retry */}
          {error && (
            <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 animate-fade-in">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">Failed to get response</p>
                <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
              </div>
              <div className="flex items-center gap-2">
                {failedPrompt && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={retry}>
                    <RefreshCw className="h-3 w-3" /> Retry
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-xs" onClick={clearError}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      <ChatInput onSend={handleSend} isGenerating={isGenerating} />
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
