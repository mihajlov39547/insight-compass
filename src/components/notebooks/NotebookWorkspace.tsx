import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus, Upload, FileText, Globe, ToggleLeft, ToggleRight,
  Trash2, Sparkles, Copy, BookmarkPlus, StickyNote,
  Pencil, X, Save, AlertCircle, RefreshCw, MessageSquare, Loader2, Bot, User,
  FileUp, ArrowUp, Video, RotateCcw
} from 'lucide-react';
import { SourceAttribution, SourceItem } from '@/components/chat/SourceAttribution';
import { ChatInput } from '@/components/chat/ChatInput';
import { InlineRenameTitle } from '@/components/shared/InlineRenameTitle';
import { NoteFormatToolbar } from '@/components/notebooks/NoteFormatToolbar';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { WorkspaceContextHeader } from '@/components/layout/WorkspaceContextHeader';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useApp } from '@/contexts/useApp';
import { useNotebooks, useUpdateNotebook } from '@/hooks/useNotebooks';
import { useNotebookDocuments } from '@/hooks/useNotebookDocuments';
import { useNotebookNotes, useCreateNotebookNote, useUpdateNotebookNote, useDeleteNotebookNote, DbNotebookNote } from '@/hooks/useNotebookNotes';
import { useNotebookMessages, useNotebookAIChat, useDeleteNotebookMessagePair } from '@/hooks/useNotebookChat';
import { useDeleteDocument, DbDocument } from '@/hooks/useDocuments';
import { useResources } from '@/hooks/useResources';
import { useDeleteResource, useRetryYouTubeTranscriptIngestion, useCreateLinkResource, type ResourceActionInput } from '@/hooks/useResourceActions';
import type { Resource } from '@/lib/resourceClassification';
import { useQueryClient } from '@tanstack/react-query';
import { UploadDocumentsDialog } from '@/components/dialogs/UploadDocumentsDialog';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { deriveDocumentStatusPresentation, useDocumentProcessingStatus } from '@/hooks/useDocumentProcessingStatus';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { modelOptions } from '@/config/modelOptions';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { ResearchTrace } from '@/components/chat/ResearchTrace';
import { WebSearchTrace } from '@/components/chat/WebSearchTrace';
import type { ResearchTraceState } from '@/services/research/tavilyResearch';
import type { WebSearchTraceState } from '@/services/web-search/webSearchTrace';
import { supabase } from '@/integrations/supabase/client';
import { useItemRole } from '@/hooks/useItemRole';
import { getItemPermissions } from '@/lib/permissions';
import { useExtractFollowUp } from '@/hooks/useExtractFollowUp';
import type { ExtractSelection } from '@/components/chat/SourceAttribution';

function NotebookSourceStatus({ doc }: { doc: DbDocument }) {
  const isProcessing = !['completed', 'failed'].includes(doc.processing_status);
  const { data: processingStatus } = useDocumentProcessingStatus(doc.id, isProcessing);
  const presentation = processingStatus
    ? deriveDocumentStatusPresentation(processingStatus)
    : null;

  const displayStatus = presentation?.primaryTone === 'ready'
    ? 'completed'
    : presentation?.primaryTone === 'failed'
      ? 'failed'
      : doc.processing_status;

  return (
    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
      <DocumentStatusBadge status={displayStatus} />
      {presentation?.secondaryLabel && (
        <span className="text-[10px] text-muted-foreground">• {presentation.secondaryLabel}</span>
      )}
    </div>
  );
}

function NotebookVideoSourceStatus({ resource }: { resource: Resource }) {
  const status = resource.transcriptStatus || 'none';
  const tone = status === 'ready' ? 'completed' : status === 'failed' ? 'failed' : 'processing';

  const display = tone === 'completed'
    ? 'completed'
    : tone === 'failed'
      ? 'failed'
      : status === 'running'
        ? 'generating_embeddings'
        : 'extracting_content';

  return (
    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
      <DocumentStatusBadge status={display} />
      <span className="text-[10px] text-muted-foreground">• transcript {status}</span>
    </div>
  );
}

export function NotebookWorkspace() {
  const { selectedNotebookId, setShowShare } = useApp();
  const queryClient = useQueryClient();
  const { data: myRole } = useItemRole(selectedNotebookId, 'notebook');
  const permissions = getItemPermissions(myRole);
  const { data: notebooks = [] } = useNotebooks();
  const updateNotebook = useUpdateNotebook();
  const notebook = notebooks.find(n => n.id === selectedNotebookId);
  const { data: documents = [] } = useNotebookDocuments(selectedNotebookId ?? undefined);
  const { data: resources = [] } = useResources();
  const { data: notes = [] } = useNotebookNotes(selectedNotebookId ?? undefined);
  const { data: messages = [], isLoading: messagesLoading } = useNotebookMessages(selectedNotebookId ?? undefined);
  const deleteDocument = useDeleteDocument();
  const deleteResource = useDeleteResource();
  const retryTranscript = useRetryYouTubeTranscriptIngestion();
  const createLinkResource = useCreateLinkResource();
  const [addingYouTubeUrl, setAddingYouTubeUrl] = useState<string | null>(null);
  const createNote = useCreateNotebookNote();
  const updateNote = useUpdateNotebookNote();
  const deleteNote = useDeleteNotebookNote();
  const { mutate: deleteMessagePair } = useDeleteNotebookMessagePair();

  const { sendMessage, isGenerating, streamingContent, error, clearError, researchTrace, webSearchTrace } = useNotebookAIChat({
    notebookId: selectedNotebookId ?? '',
    notebookName: notebook?.name,
    notebookDescription: notebook?.description,
  });
  const [activeMode, setActiveMode] = useState<'none' | 'web_search' | 'research' | 'youtube_search'>('none');

  const [showUpload, setShowUpload] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<DbNotebookNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [addingToSources, setAddingToSources] = useState(false);
  const chatViewportRef = useRef<HTMLDivElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isChatNearBottom, setIsChatNearBottom] = useState(true);
  const [showChatScrollTop, setShowChatScrollTop] = useState(false);

  const linkedVideos = useMemo(() => {
    if (!selectedNotebookId) return [] as Resource[];
    return resources.filter((r) =>
      r.provider === 'youtube'
      && r.sourceType === 'linked'
      && r.notebookId === selectedNotebookId
    );
  }, [resources, selectedNotebookId]);

  const hasSources = documents.length > 0 || linkedVideos.length > 0;
  const enabledDocs = documents.filter((d: any) => d.notebook_enabled !== false);
  const enabledVideoSources = linkedVideos.filter((v) => v.transcriptStatus === 'ready');
  const enabledSourceCount = enabledDocs.length + enabledVideoSources.length;

  const addedYouTubeUrls = useMemo(() => {
    const set = new Set<string>();
    if (!selectedNotebookId) return set;
    for (const r of resources) {
      if (r.provider !== 'youtube') continue;
      if (r.containerType !== 'notebook' || r.containerId !== selectedNotebookId) continue;
      if (r.linkUrl) set.add(r.linkUrl);
      if (r.normalizedUrl) set.add(r.normalizedUrl);
    }
    return set;
  }, [resources, selectedNotebookId]);

  const handleAddYouTubeToSources = async (source: SourceItem) => {
    if (!selectedNotebookId || !source.url) return;
    setAddingYouTubeUrl(source.url);
    try {
      await createLinkResource.mutateAsync({
        url: source.url,
        title: source.title,
        provider: 'youtube',
        containerType: 'notebook',
        containerId: selectedNotebookId,
      });
      toast.success('Added to sources — extracting transcript');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add video to sources');
    } finally {
      setAddingYouTubeUrl(null);
    }
  };


  const toResourceActionInput = (resource: Resource): ResourceActionInput => ({
    id: resource.id,
    title: resource.title,
    storagePath: resource.storagePath,
    ownerUserId: resource.ownerUserId,
    containerType: resource.containerType,
    containerId: resource.containerId,
    processingStatus: resource.processingStatus,
    resourceKind: resource.resourceKind,
  });

  const previousUserMessage = useMemo(() => {
    const userMsgs = messages.filter(m => m.role === 'user');
    return userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : undefined;
  }, [messages]);

  const previousAssistantMessage = useMemo(() => {
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    return assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].content : undefined;
  }, [messages]);

  const handleChatScroll = () => {
    const el = chatViewportRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsChatNearBottom(distanceFromBottom < 120);
    setShowChatScrollTop(el.scrollTop > 240);
  };

  useEffect(() => {
    const el = chatViewportRef.current;
    if (!el || !isChatNearBottom) return;

    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingContent, isChatNearBottom]);

  const handleToggleSource = async (doc: DbDocument) => {
    if (!permissions.canManageDocumentState) {
      toast.error('You do not have permission to manage notebook sources');
      return;
    }

    const currentEnabled = (doc as any).notebook_enabled !== false;
    await (supabase.from('documents') as any)
      .update({ notebook_enabled: !currentEnabled })
      .eq('id', doc.id);
    queryClient.invalidateQueries({ queryKey: ['notebook-documents', selectedNotebookId] });
  };

  const handleSaveToNote = (content: string) => {
    if (!permissions.canCreateNotes) {
      toast.error('You do not have permission to create notes');
      return;
    }

    if (!selectedNotebookId) return;
    createNote.mutate({
      notebookId: selectedNotebookId,
      title: 'AI Insight',
      content,
    }, {
      onSuccess: (note) => {
        setEditingNote(note);
        setEditTitle(note.title);
        setEditContent(note.content);
        setNoteModalOpen(true);
        toast.success('Saved to notes — you can edit it now');
      },
    });
  };

  const handleCopyContent = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  };

  const handleAddNote = () => {
    if (!permissions.canCreateNotes) {
      toast.error('You do not have permission to create notes');
      return;
    }

    if (!selectedNotebookId) return;
    createNote.mutate({ notebookId: selectedNotebookId, title: '', content: '' }, {
      onSuccess: (note) => {
        setEditingNote(note);
        setEditTitle('');
        setEditContent('');
        setNoteModalOpen(true);
      },
    });
  };

  const handleStartEdit = (note: DbNotebookNote) => {
    if (!permissions.canEditNotes) {
      return;
    }

    setEditingNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setNoteModalOpen(true);
  };

  const handleSaveNote = async () => {
    if (!permissions.canEditNotes) {
      toast.error('You do not have permission to edit notes');
      return;
    }

    if (!editingNote || !selectedNotebookId) return;
    updateNote.mutate({
      id: editingNote.id,
      notebookId: selectedNotebookId,
      title: editTitle,
      content: editContent,
    }, {
      onSuccess: async () => {
        // Check if this note has a linked source document — if so, reprocess it
        try {
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData.user?.id;
          if (userId) {
            const storagePath = `${userId}/${selectedNotebookId}/notes/${editingNote.id}.md`;
            const { data: existingDocs } = await supabase
              .from('documents')
              .select('id')
              .eq('storage_path', storagePath)
              .limit(1);

            if (existingDocs && existingDocs.length > 0) {
              const documentId = existingDocs[0].id;
              const noteTitle = editTitle || 'Untitled Note';
              const markdownContent = `# ${noteTitle}\n\n${editContent || ''}`;
              const blob = new Blob([markdownContent], { type: 'text/plain' });

              // Delete old file and upload fresh
              await supabase.storage.from('insight-navigator').remove([storagePath]);
              await supabase.storage.from('insight-navigator').upload(storagePath, blob);

              // Reset document for reprocessing
              await supabase.from('documents').update({
                file_name: `Note: ${noteTitle}.md`,
                file_size: blob.size,
                processing_status: 'uploaded',
                processing_error: null,
                summary: null,
                detected_language: null,
                word_count: null,
                char_count: null,
              }).eq('id', documentId);

              // Also clear old analysis
              await supabase.from('document_analysis').delete().eq('document_id', documentId);

              // Trigger reprocessing via workflow
              fetch(
                getFunctionUrl('/functions/v1/workflow-start'),
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
                  },
                  body: JSON.stringify({
                    definition_key: 'document_processing_v1',
                    input_payload: {
                      document_id: documentId,
                      source: 'notebook_reprocess',
                      source_document_id: documentId,
                      initiated_at: new Date().toISOString(),
                    },
                    trigger_entity_type: 'document',
                    trigger_entity_id: documentId,
                  }),
                }
              ).catch(() => {});

              queryClient.invalidateQueries({ queryKey: ['notebook-documents', selectedNotebookId] });
              toast.success('Note source updated — reprocessing started');
            }
          }
        } catch (err) {
          console.error('Failed to reprocess note source:', err);
        }
        setNoteModalOpen(false);
        setEditingNote(null);
      },
    });
  };

  const handleDeleteNote = (note: DbNotebookNote) => {
    if (!permissions.canDeleteNotes) {
      toast.error('You do not have permission to delete notes');
      return;
    }

    if (!selectedNotebookId) return;
    deleteNote.mutate({ id: note.id, notebookId: selectedNotebookId });
    if (editingNote?.id === note.id) {
      setNoteModalOpen(false);
      setEditingNote(null);
    }
  };

  const handleAddNoteToSources = async () => {
    if (!permissions.canManageDocumentState) {
      toast.error('You do not have permission to manage notebook sources');
      return;
    }

    if (!editingNote || !selectedNotebookId) return;
    // Save note first
    if (editTitle !== editingNote.title || editContent !== editingNote.content) {
      updateNote.mutate({
        id: editingNote.id,
        notebookId: selectedNotebookId,
        title: editTitle,
        content: editContent,
      });
    }
    setAddingToSources(true);
    try {
      const noteTitle = editTitle || 'Untitled Note';
      const noteBody = editContent || '';
      // Build markdown content with title as heading
      const markdownContent = `# ${noteTitle}\n\n${noteBody}`;
      const blob = new Blob([markdownContent], { type: 'text/plain' });
      const fileName = `Note: ${noteTitle}.md`;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user!.id;

      // Use note id in path for deduplication, prefixed with userId for RLS
      const storagePath = `${userId}/${selectedNotebookId}/notes/${editingNote.id}.md`;

      // Upload (upsert so re-adding updates the file)
      const { error: uploadError } = await supabase.storage
        .from('insight-navigator')
        .upload(storagePath, blob, { upsert: true });
      if (uploadError) throw uploadError;

      // Check if a document already exists for this note (same storage_path)
      const { data: existingDocs } = await supabase
        .from('documents')
        .select('id')
        .eq('storage_path', storagePath)
        .limit(1);

      let documentId: string;

      if (existingDocs && existingDocs.length > 0) {
        // Update existing document and re-process
        documentId = existingDocs[0].id;
        await supabase.from('documents').update({
          file_name: fileName,
          file_size: blob.size,
          processing_status: 'uploaded',
          processing_error: null,
          summary: null,
          detected_language: null,
          word_count: null,
          char_count: null,
        }).eq('id', documentId);
        toast.success('Note source updated — re-processing');
      } else {
        // Create new document
        const { data: docData, error: docError } = await supabase.from('documents').insert({
          user_id: userId,
          notebook_id: selectedNotebookId,
          file_name: fileName,
          file_type: 'md',
          mime_type: 'text/plain',
          file_size: blob.size,
          storage_path: storagePath,
          processing_status: 'uploaded',
          notebook_enabled: true,
        }).select('id').single();
        if (docError) throw docError;
        documentId = docData.id;
        toast.success('Note added to sources');
      }

      // Trigger processing via workflow
      fetch(
        getFunctionUrl('/functions/v1/workflow-start'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            definition_key: 'document_processing_v1',
            input_payload: {
              document_id: documentId,
              source: 'notebook_note_source',
              source_document_id: documentId,
              initiated_at: new Date().toISOString(),
            },
            trigger_entity_type: 'document',
            trigger_entity_id: documentId,
          }),
        }
      ).catch(() => { /* processing failure tracked server-side */ });

      queryClient.invalidateQueries({ queryKey: ['notebook-documents', selectedNotebookId] });
      setNoteModalOpen(false);
      setEditingNote(null);
    } catch (err: any) {
      console.error('Add note to sources error:', err);
      toast.error('Failed to add note to sources');
    } finally {
      setAddingToSources(false);
    }
  };

  if (!notebook) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <WorkspaceContextHeader
        title={(
          permissions.canRename ? (
            <InlineRenameTitle
              value={notebook.name}
              onSave={async (name) => {
                await updateNotebook.mutateAsync({ id: notebook.id, name });
                toast.success('Notebook renamed');
              }}
              as="h1"
              className="text-lg font-semibold text-foreground"
            />
          ) : (
            <span className="text-lg font-semibold text-foreground">{notebook.name}</span>
          )
        )}
        subtitle={notebook.description}
        showShare={permissions.canManageSharing}
        onShare={permissions.canManageSharing ? () => setShowShare(true) : undefined}
      />

      {/* 3-column layout */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* LEFT — Sources */}
        <ResizablePanel defaultSize={22} minSize={16} maxSize={35}>
          <div className="flex flex-col h-full border-r border-border">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Sources</h2>
              {permissions.canUploadDocuments && (
                <Button size="sm" className="h-7 gap-1 text-xs bg-accent hover:bg-accent/90 text-accent-foreground" onClick={() => setShowUpload(true)}>
                  <Plus className="h-3 w-3" /> Add source
                </Button>
              )}
            </div>
            <ScrollArea className="flex-1">
              {documents.length === 0 && linkedVideos.length === 0 ? (
                <div className="p-4 text-center">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-3">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">No sources yet</p>
                  <p className="text-xs text-muted-foreground mb-3">Upload documents or attach videos to start asking questions</p>
                  {permissions.canUploadDocuments && (
                    <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setShowUpload(true)}>
                      <Upload className="h-3 w-3" /> Upload
                    </Button>
                  )}
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {documents.map((doc) => {
                    const enabled = (doc as any).notebook_enabled !== false;
                    return (
                      <div key={doc.id} className={cn(
                        "flex items-start gap-2 p-2 rounded-lg transition-colors",
                        enabled ? "bg-card" : "bg-muted/50 opacity-60"
                      )}>
                        {permissions.canManageDocumentState ? (
                          <button
                            onClick={() => handleToggleSource(doc)}
                            className="mt-0.5 shrink-0"
                            title={enabled ? 'Disable source' : 'Enable source'}
                          >
                            {enabled ? (
                              <ToggleRight className="h-4 w-4 text-accent" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        ) : (
                          enabled ? (
                            <ToggleRight className="h-4 w-4 text-accent/50 mt-0.5 shrink-0" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          )
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{doc.file_name}</p>
                          <NotebookSourceStatus doc={doc} />
                        </div>
                        {permissions.canDeleteDocuments && (
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteDocument.mutate(doc)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    );
                  })}

                  {linkedVideos.map((video) => {
                    const isTranscriptReady = video.transcriptStatus === 'ready';
                    return (
                      <div key={video.id} className={cn(
                        "flex items-start gap-2 p-2 rounded-lg transition-colors",
                        isTranscriptReady ? "bg-card" : "bg-muted/50"
                      )}>
                        <Video className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{video.title}</p>
                          <NotebookVideoSourceStatus resource={video} />
                        </div>
                        {video.transcriptStatus === 'failed' && permissions.canManageDocumentState && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-accent"
                            onClick={() => retryTranscript.mutate(toResourceActionInput(video))}
                            title="Retry transcript"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                        {permissions.canDeleteDocuments && (
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteResource.mutate(toResourceActionInput(video))}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* CENTER — Chat */}
        <ResizablePanel defaultSize={50} minSize={30}>
          <div className="flex flex-col h-full min-h-0">
            {!hasSources ? (
              /* Empty state: no sources */
              <div className="flex-1 flex items-center justify-center px-6">
                <div className="text-center max-w-md animate-fade-in">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-muted flex items-center justify-center mb-4">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-2">Add a source to get started</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Upload a document or add a website URL to begin asking questions.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No sources added yet. Check the Sources panel on the left.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Chat messages */}
                <div className="relative flex-1 min-h-0">
                  <div ref={chatViewportRef} onScroll={handleChatScroll} className="h-full overflow-y-auto p-4">
                    <div className="max-w-2xl mx-auto space-y-4">
                    {messagesLoading ? (
                      <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mx-auto" />
                        <p className="text-sm text-muted-foreground mt-2">Loading…</p>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center py-12 animate-fade-in">
                        <div className="w-14 h-14 mx-auto rounded-2xl bg-muted flex items-center justify-center mb-4">
                          <MessageSquare className="h-7 w-7 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-medium text-foreground mb-2">Ask questions about your sources</h3>
                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                          Use the chat to summarize, compare, extract insights, or explore ideas from your attached materials.
                        </p>
                      </div>
                    ) : (
                      messages.map((msg) => (
                        <NotebookChatMessage
                          key={msg.id}
                          message={msg}
                          onSaveToNote={handleSaveToNote}
                          onCopy={handleCopyContent}
                          canSaveToNotes={permissions.canCreateNotes}
                          onDeletePair={(id) => selectedNotebookId && deleteMessagePair({ messageId: id, notebookId: selectedNotebookId })}
                        />
                      ))
                    )}

                    {/* Streaming */}
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
                                <span>{activeMode === 'research' ? 'Researching the web…' : activeMode === 'web_search' ? 'Searching the web…' : 'Working…'}</span>
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
                          <p className="text-sm font-medium text-destructive">Failed to get response</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
                        </div>
                        <Button variant="ghost" size="sm" className="text-xs" onClick={clearError}>Dismiss</Button>
                      </div>
                    )}
                      <div className="h-0.5" />
                    </div>
                  </div>

                  {showChatScrollTop && (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute bottom-4 right-4 h-9 w-9 rounded-full shadow-md"
                      onClick={() => chatViewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* Chat input — shared component */}
                {permissions.canSendMessages ? (
                  <ChatInput
                    onSend={(payload, modelId) => {
                      setActiveMode(payload.options.augmentationMode ?? 'none');
                      sendMessage(payload.text, modelId, payload.options);
                    }}
                    isGenerating={isGenerating}
                    previousUserMessage={previousUserMessage}
                    previousAssistantMessage={previousAssistantMessage}
                    variant="notebook"
                    footerLeft={
                      <span className="text-xs text-muted-foreground">
                        {enabledSourceCount} source{enabledSourceCount !== 1 ? 's' : ''} enabled
                      </span>
                    }
                  />
                ) : (
                  <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
                    You have read-only access to this notebook.
                  </div>
                )}
              </>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* RIGHT — Notes */}
        <ResizablePanel defaultSize={28} minSize={16} maxSize={40}>
          <div className="flex flex-col h-full border-l border-border">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Notes</h2>
              {permissions.canCreateNotes && (
                <Button size="sm" className="h-7 gap-1 text-xs bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleAddNote} disabled={createNote.isPending}>
                  <Plus className="h-3 w-3" /> Add note
                </Button>
              )}
            </div>
            <ScrollArea className="flex-1">
              {notes.length === 0 ? (
                <div className="p-4 text-center">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-3">
                    <StickyNote className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">No notes yet</p>
                  <p className="text-xs text-muted-foreground">Save insights from chat or create your own note.</p>
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {notes.map((note) => (
                    <button
                      key={note.id}
                      className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors cursor-pointer"
                      onClick={() => permissions.canEditNotes && handleStartEdit(note)}
                    >
                      {note.title && <p className="text-sm font-medium text-foreground mb-1 truncate">{note.title}</p>}
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{note.content || 'Empty note'}</p>
                      <div className="flex items-center gap-1 mt-2">
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {new Date(note.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Edit Note Modal */}
      <Dialog open={noteModalOpen} onOpenChange={(open) => { if (!open) { setNoteModalOpen(false); setEditingNote(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{permissions.canEditNotes ? 'Edit Note' : 'View Note'}</DialogTitle>
            <DialogDescription className="sr-only">Edit your notebook note</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Note title"
              className="text-base font-medium"
              autoFocus
              readOnly={!permissions.canEditNotes}
            />
            {permissions.canEditNotes && (
              <NoteFormatToolbar
                textareaRef={noteTextareaRef}
                value={editContent}
                onChange={setEditContent}
              />
            )}
            <Textarea
              ref={noteTextareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Write your note…"
              className="min-h-[200px] resize-none text-sm leading-relaxed font-mono"
              readOnly={!permissions.canEditNotes}
            />
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex items-center gap-2 mr-auto">
              {permissions.canManageDocumentState && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={handleAddNoteToSources}
                  disabled={addingToSources || !editContent.trim()}
                >
                  {addingToSources ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileUp className="h-3 w-3" />}
                  Add to sources
                </Button>
              )}
              {editingNote && permissions.canDeleteNotes && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => editingNote && handleDeleteNote(editingNote)}
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setNoteModalOpen(false); setEditingNote(null); }}>
                {permissions.canEditNotes ? 'Cancel' : 'Close'}
              </Button>
              {permissions.canEditNotes && (
                <Button size="sm" className="gap-1 bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleSaveNote} disabled={updateNote.isPending}>
                  {updateNote.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload dialog */}
      <UploadDocumentsDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        onUploadComplete={() => {}}
        context="notebook"
      />
    </div>
  );
}

/* --- Notebook Chat Message --- */
function NotebookChatMessage({ message, onSaveToNote, onCopy, canSaveToNotes, onDeletePair, onExtract, isExtracting }: {
  message: { id: string; role: string; content: string; sources?: any | null; created_at: string; model_id?: string | null };
  onSaveToNote: (content: string) => void;
  onCopy: (content: string) => void;
  canSaveToNotes: boolean;
  onDeletePair?: (id: string) => void;
  onExtract?: (selections: ExtractSelection[], question: string | null) => void | Promise<void>;
  isExtracting?: boolean;
}) {
  const isUser = message.role === 'user';
  const modelName = message.model_id ? modelOptions.find(m => m.id === message.model_id)?.name ?? message.model_id.split('/').pop() : null;

  const rawSources = message.sources;
  const sourceItems = Array.isArray(rawSources)
    ? rawSources
    : (rawSources && Array.isArray((rawSources as any).items) ? (rawSources as any).items : []);
  const responseLengthLabel = (() => {
    const value = typeof (rawSources as any)?.responseLength === 'string' ? (rawSources as any).responseLength.toLowerCase() : '';
    if (value === 'concise') return 'Concise';
    if (value === 'detailed') return 'Detailed';
    if (value === 'standard') return 'Standard';
    return null;
  })();

  const persistedResearchTrace: ResearchTraceState | null = (() => {
    if (!rawSources || typeof rawSources !== 'object' || Array.isArray(rawSources)) return null;
    const t = (rawSources as any).researchTrace;
    if (!t || typeof t !== 'object' || !Array.isArray(t.events)) return null;
    return t as ResearchTraceState;
  })();

  const persistedWebSearchTrace: WebSearchTraceState | null = (() => {
    if (!rawSources || typeof rawSources !== 'object' || Array.isArray(rawSources)) return null;
    const t = (rawSources as any).webSearchTrace;
    if (!t || typeof t !== 'object' || !Array.isArray(t.events)) return null;
    return t as WebSearchTraceState;
  })();

  return (
    <div className={cn("flex gap-3 animate-fade-in", isUser ? "flex-row-reverse" : "flex-row")}>
      <Avatar className={cn("h-8 w-8 shrink-0", isUser ? "bg-primary" : "bg-gradient-to-br from-accent to-accent/70")}>
        <AvatarFallback className={cn(isUser ? "bg-primary text-primary-foreground" : "bg-transparent text-accent-foreground")}>
          {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={cn("max-w-[75%] space-y-2", isUser ? "items-end" : "items-start")}>
        <div className={cn(isUser ? "chat-bubble-user" : "chat-bubble-assistant")}>
          {isUser ? <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div> : <MarkdownContent content={message.content} />}
        </div>

        {/* Persisted research trace */}
        {!isUser && persistedResearchTrace && (
          <ResearchTrace trace={persistedResearchTrace} />
        )}
        {/* Persisted web search trace */}
        {!isUser && !persistedResearchTrace && persistedWebSearchTrace && (
          <WebSearchTrace trace={persistedWebSearchTrace} />
        )}
        {/* Sources */}
        {!isUser && sourceItems.length > 0 && (
          <SourceAttribution
            sources={sourceItems.map((s: any, i: number) => ({
              id: s.id || `src-${i}`,
              type: s.type === 'web' ? 'web' : 'document',
              documentId: s.documentId || s.id || `src-${i}`,
              title: s.title,
              snippet: s.snippet || '',
              relevance: s.relevance ?? 0,
              page: s.page ?? null,
              section: s.section ?? null,
              url: s.url,
              favicon: s.favicon ?? null,
              score: s.score,
            }))}
            onExtract={onExtract}
            isExtracting={isExtracting}
          />
        )}

        {/* Meta + actions */}
        <div className={cn("flex items-center gap-2 px-1 flex-wrap", isUser ? "flex-row-reverse" : "flex-row")}>
          <p className="text-[10px] text-muted-foreground">
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          {isUser && onDeletePair && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  Delete
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Message</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this question and its corresponding answer from the system and database. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDeletePair(message.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!isUser && (
            <>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
                <Bot className="h-2.5 w-2.5" /> AI{modelName ? ` · ${modelName}` : ''}
              </span>
              {responseLengthLabel && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
                  {responseLengthLabel}
                </span>
              )}
              {canSaveToNotes && (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground" onClick={() => onSaveToNote(message.content)}>
                  <BookmarkPlus className="h-3 w-3" /> Save to note
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground" onClick={() => onCopy(message.content)}>
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
