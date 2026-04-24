import React, { useEffect, useRef, useMemo, useState } from 'react';
import { MessageSquarePlus, FileText, Zap, Shield, AlertCircle, RefreshCw, Sparkles, ArrowUp, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatMessage } from './ChatMessage';
import { useCreateChat, useChats } from '@/hooks/useChats';
import { useDeleteMessagePair } from '@/hooks/useMessages';
import { ChatInput } from './ChatInput';
import { useApp } from '@/contexts/useApp';
import { useMessages } from '@/hooks/useMessages';
import { useProjects } from '@/hooks/useProjects';
import { useAIChat } from '@/hooks/useAIChat';
import { ProjectsLanding } from '@/components/projects/ProjectsLanding';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ProjectChatGrid } from '@/components/dashboard/ProjectChatGrid';
import { useItemRole } from '@/hooks/useItemRole';
import { getItemPermissions } from '@/lib/permissions';
import { Badge } from '@/components/ui/badge';
import { ResearchTrace } from './ResearchTrace';
import { WebSearchTrace } from './WebSearchTrace';
import { useExtractFollowUp } from '@/hooks/useExtractFollowUp';
import { useCrawlFollowUp } from '@/hooks/useCrawlFollowUp';
import { useCreateLinkResource } from '@/hooks/useResourceActions';
import { useResources } from '@/hooks/useResources';
import { toast } from 'sonner';
import type { ChatSendPayload } from './ChatInput';
import type { SourceItem } from './SourceAttribution';
import { useTranslation } from 'react-i18next';

export function ChatWorkspace() {
  const { t } = useTranslation();
  const { selectedProjectId, selectedChatId, setSelectedChatId, setShowShare } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: messages = [], isLoading: messagesLoading } = useMessages(selectedChatId ?? undefined);
  const createChat = useCreateChat();
  const { mutate: deleteMessagePair } = useDeleteMessagePair();
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [activeMode, setActiveMode] = useState<'none' | 'web_search' | 'research' | 'youtube_search' | 'notebook'>('none');
  
  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);
  const selectedChat = chats.find(c => c.id === selectedChatId);

  const { data: myRole } = useItemRole(selectedProjectId, 'project');
  const permissions = getItemPermissions(myRole);

  const { sendMessage, isGenerating, streamingContent, error, clearError, retry, failedPrompt, researchTrace, webSearchTrace } = useAIChat({
    chatId: selectedChatId ?? '',
    chatName: selectedChat?.name,
    projectId: selectedProjectId ?? undefined,
    projectDescription: selectedProject?.description,
  });

  const { runExtract, extractingMessageId } = useExtractFollowUp();
  const { runCrawl, crawlingMessageId } = useCrawlFollowUp();
  const [crawlingUrl, setCrawlingUrl] = useState<string | null>(null);
  const [addingYouTubeUrl, setAddingYouTubeUrl] = useState<string | null>(null);
  const createLinkResource = useCreateLinkResource();
  const { data: resources = [] } = useResources();

  const addedYouTubeUrls = useMemo(() => {
    const set = new Set<string>();
    if (!selectedProjectId) return set;
    for (const r of resources) {
      if (r.provider !== 'youtube') continue;
      if (r.containerType !== 'project' || r.containerId !== selectedProjectId) continue;
      if (r.linkUrl) set.add(r.linkUrl);
      if (r.normalizedUrl) set.add(r.normalizedUrl);
    }
    return set;
  }, [resources, selectedProjectId]);

  const handleAddYouTubeToSources = async (source: SourceItem) => {
    if (!selectedProjectId || !source.url) return;
    setAddingYouTubeUrl(source.url);
    try {
      await createLinkResource.mutateAsync({
        url: source.url,
        title: source.title,
        provider: 'youtube',
        containerType: 'project',
        containerId: selectedProjectId,
      });
      toast.success('Added to sources — extracting transcript');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add video to sources');
    } finally {
      setAddingYouTubeUrl(null);
    }
  };


  const previousUserMessage = useMemo(() => {
    const userMsgs = messages.filter(m => m.role === 'user');
    return userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : undefined;
  }, [messages]);

  const previousAssistantMessage = useMemo(() => {
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    return assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].content : undefined;
  }, [messages]);

  const handleMessagesScroll = () => {
    const el = messagesViewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsNearBottom(distanceFromBottom < 120);
    setShowScrollTop(el.scrollTop > 240);
  };

  useEffect(() => {
    const el = messagesViewportRef.current;
    if (!el || !isNearBottom) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingContent, isNearBottom]);

  // When generation starts, force scroll to bottom so the user always sees
  // the streaming response — even if they had scrolled up earlier.
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (isGenerating && !wasGeneratingRef.current) {
      const el = messagesViewportRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        setIsNearBottom(true);
      }
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  if (!selectedProjectId || !selectedProject) {
    return <ProjectsLanding />;
  }

  if (!selectedChatId) {
    if (chats.length > 0) {
      return (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="max-w-6xl mx-auto animate-fade-in">
            <div className="flex items-center justify-end gap-2 mb-4">
              {!permissions.isOwner && myRole && (
                <Badge variant="outline" className="text-xs capitalize">{myRole}</Badge>
              )}
              {permissions.canManageSharing && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowShare(true)}>
                  <Share2 className="h-4 w-4" /> {t('projectDashboard.share')}
                </Button>
              )}
            </div>

            <div className="text-center space-y-6 max-w-3xl mx-auto mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                <FeatureCard icon={<FileText className="h-5 w-5" />} title={t('projectDashboard.features.documentAnalysis.title')} description={t('projectDashboard.features.documentAnalysis.description')} />
                <FeatureCard icon={<Zap className="h-5 w-5" />} title={t('projectDashboard.features.instantAnswers.title')} description={t('projectDashboard.features.instantAnswers.description')} />
                <FeatureCard icon={<Shield className="h-5 w-5" />} title={t('projectDashboard.features.secure.title')} description={t('projectDashboard.features.secure.description')} />
              </div>
              {permissions.canCreateChats && (
                <Button
                  className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground"
                  onClick={() => {
                    createChat.mutate(
                      { projectId: selectedProjectId!, name: 'New Chat', language: (selectedProject!.language as 'en' | 'sr') },
                      { onSuccess: (chat) => setSelectedChatId(chat.id) }
                    );
                  }}
                  disabled={createChat.isPending}
                >
                  <MessageSquarePlus className="h-4 w-4" /> {createChat.isPending ? t('projectDashboard.creating') : t('projectDashboard.createNewChat')}
                </Button>
              )}
            </div>

            <ProjectChatGrid chats={chats} permissions={permissions} />
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-6 max-w-lg px-4 animate-fade-in">
          <div className="grid grid-cols-3 gap-4 pt-4">
            <FeatureCard icon={<FileText className="h-5 w-5" />} title={t('projectDashboard.features.documentAnalysis.title')} description={t('projectDashboard.features.documentAnalysis.description')} />
            <FeatureCard icon={<Zap className="h-5 w-5" />} title={t('projectDashboard.features.instantAnswers.title')} description={t('projectDashboard.features.instantAnswers.description')} />
            <FeatureCard icon={<Shield className="h-5 w-5" />} title={t('projectDashboard.features.secure.title')} description={t('projectDashboard.features.secure.description')} />
          </div>
          {permissions.canCreateChats ? (
            <Button
              className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground"
              onClick={() => {
                createChat.mutate(
                  { projectId: selectedProjectId!, name: 'New Chat', language: (selectedProject!.language as 'en' | 'sr') },
                  { onSuccess: (chat) => setSelectedChatId(chat.id) }
                );
              }}
              disabled={createChat.isPending}
            >
              <MessageSquarePlus className="h-4 w-4" /> {createChat.isPending ? t('projectDashboard.creating') : t('projectDashboard.createNewChat')}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t('projectDashboard.noChatsYet')}</p>
          )}
        </div>
      </div>
    );
  }

  const handleSend = (payload: ChatSendPayload, modelId?: string) => {
    clearError();
    setActiveMode(payload.options.augmentationMode ?? 'none');
    sendMessage(payload.text, modelId, payload.options);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="relative flex-1 min-h-0">
        <div ref={messagesViewportRef} onScroll={handleMessagesScroll} className="h-full overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto space-y-6">
          {messagesLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">{t('projectDashboard.loadingMessages')}</p>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState 
              icon={<MessageSquarePlus className="h-10 w-10 text-accent" />}
              title={t('projectDashboard.noMessagesYet.title')}
              description={t('projectDashboard.noMessagesYet.description')}
            />
          ) : (
            messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={{
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  sources: message.sources || [],
                  timestamp: message.created_at,
                  modelId: message.model_id ?? undefined,
                }}
                onDeletePair={(id) => selectedChatId && deleteMessagePair({ messageId: id, chatId: selectedChatId })}
                onExtract={selectedChatId && message.role === 'assistant'
                  ? (selections, question) => runExtract({ kind: 'chat', chatId: selectedChatId }, message.id, selections, question)
                  : undefined}
                isExtracting={extractingMessageId === message.id}
                onCrawl={selectedChatId && message.role === 'assistant'
                  ? async (selection, instructions) => {
                      setCrawlingUrl(selection.url);
                      try {
                        await runCrawl({ kind: 'chat', chatId: selectedChatId }, message.id, selection, instructions);
                      } finally {
                        setCrawlingUrl(null);
                      }
                    }
                  : undefined}
                isCrawling={crawlingMessageId === message.id}
                crawlingUrl={crawlingMessageId === message.id ? crawlingUrl : null}
                onAddYouTubeToSources={message.role === 'assistant' ? handleAddYouTubeToSources : undefined}
                addingYouTubeUrl={addingYouTubeUrl}
                addedYouTubeUrls={addedYouTubeUrls}
              />
            ))
          )}

          {isGenerating && streamingContent !== null && (
            <div className="flex gap-3 animate-fade-in">
              <Avatar className="h-8 w-8 shrink-0 bg-gradient-to-br from-accent to-accent/70">
                <AvatarFallback className="bg-transparent text-accent-foreground">
                  <Sparkles className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="max-w-[75%] space-y-2">
                {activeMode === 'research' && researchTrace && (
                  <ResearchTrace trace={researchTrace} isLive defaultExpanded />
                )}
                {activeMode === 'web_search' && webSearchTrace && (
                  <WebSearchTrace trace={webSearchTrace} isLive defaultExpanded />
                )}
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
                      <span>{activeMode === 'research' ? t('projectDashboard.researching') : activeMode === 'web_search' ? t('projectDashboard.searchingWeb') : activeMode === 'notebook' ? t('projectDashboard.searchingNotebook') : t('projectDashboard.thinking')}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 animate-fade-in">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">{t('projectDashboard.failedResponse')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
              </div>
              <div className="flex items-center gap-2">
                {failedPrompt && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={retry}>
                    <RefreshCw className="h-3 w-3" /> {t('projectDashboard.retry')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-xs" onClick={clearError}>
                  {t('projectDashboard.dismiss')}
                </Button>
              </div>
            </div>
          )}

            <div className="h-0.5" />
          </div>
        </div>

        {showScrollTop && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute bottom-4 right-4 h-9 w-9 rounded-full shadow-md"
            onClick={() => messagesViewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
      {permissions.canSendMessages && (
        <ChatInput onSend={handleSend} isGenerating={isGenerating} previousUserMessage={previousUserMessage} previousAssistantMessage={previousAssistantMessage} />
      )}
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
