import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft, Plus, Upload, FileText, Globe, ToggleLeft, ToggleRight,
  Trash2, Sparkles, Send, ChevronDown, Copy, BookmarkPlus, StickyNote,
  Pencil, X, Save, AlertCircle, RefreshCw, MessageSquare, Loader2, Bot, User,
  FileUp
} from 'lucide-react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useApp } from '@/contexts/AppContext';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useNotebookDocuments } from '@/hooks/useNotebookDocuments';
import { useNotebookNotes, useCreateNotebookNote, useUpdateNotebookNote, useDeleteNotebookNote, DbNotebookNote } from '@/hooks/useNotebookNotes';
import { useNotebookMessages, useNotebookAIChat } from '@/hooks/useNotebookChat';
import { useDeleteDocument, DbDocument } from '@/hooks/useDocuments';
import { useQueryClient } from '@tanstack/react-query';
import { UploadDocumentsDialog } from '@/components/dialogs/UploadDocumentsDialog';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { modelOptions, DEFAULT_MODEL_ID } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MarkdownContent } from '@/components/chat/MarkdownContent';

export function NotebookWorkspace() {
  const { selectedNotebookId, setSelectedNotebookId, setActiveView } = useApp();
  const queryClient = useQueryClient();
  const { data: notebooks = [] } = useNotebooks();
  const notebook = notebooks.find(n => n.id === selectedNotebookId);
  const { data: documents = [] } = useNotebookDocuments(selectedNotebookId ?? undefined);
  const { data: notes = [] } = useNotebookNotes(selectedNotebookId ?? undefined);
  const { data: messages = [], isLoading: messagesLoading } = useNotebookMessages(selectedNotebookId ?? undefined);
  const deleteDocument = useDeleteDocument();
  const createNote = useCreateNotebookNote();
  const updateNote = useUpdateNotebookNote();
  const deleteNote = useDeleteNotebookNote();

  const { sendMessage, isGenerating, streamingContent, error, clearError } = useNotebookAIChat({
    notebookId: selectedNotebookId ?? '',
    notebookName: notebook?.name,
    notebookDescription: notebook?.description,
  });

  const [showUpload, setShowUpload] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<DbNotebookNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [addingToSources, setAddingToSources] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentModel = modelOptions.find(m => m.id === selectedModel) ?? modelOptions[0];

  const hasSources = documents.length > 0;
  const enabledDocs = documents.filter((d: any) => d.notebook_enabled !== false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleBack = () => {
    setSelectedNotebookId(null);
    setActiveView('notebooks');
  };

  const handleSendChat = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (chatInput.trim() && !isGenerating) {
      sendMessage(chatInput.trim(), selectedModel);
      setChatInput('');
    }
  };

  const handleToggleSource = async (doc: DbDocument) => {
    const currentEnabled = (doc as any).notebook_enabled !== false;
    await (supabase.from('documents') as any)
      .update({ notebook_enabled: !currentEnabled })
      .eq('id', doc.id);
    queryClient.invalidateQueries({ queryKey: ['notebook-documents', selectedNotebookId] });
  };

  const handleSaveToNote = (content: string) => {
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
    setEditingNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setNoteModalOpen(true);
  };

  const handleSaveNote = () => {
    if (!editingNote || !selectedNotebookId) return;
    updateNote.mutate({
      id: editingNote.id,
      notebookId: selectedNotebookId,
      title: editTitle,
      content: editContent,
    }, {
      onSuccess: () => {
        setNoteModalOpen(false);
        setEditingNote(null);
      },
    });
  };

  const handleDeleteNote = (note: DbNotebookNote) => {
    if (!selectedNotebookId) return;
    deleteNote.mutate({ id: note.id, notebookId: selectedNotebookId });
    if (editingNote?.id === note.id) {
      setNoteModalOpen(false);
      setEditingNote(null);
    }
  };

  const handleAddNoteToSources = async () => {
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
      const noteContent = editContent || '';
      // Create a text blob from the note content and upload as a document source
      const blob = new Blob([noteContent], { type: 'text/plain' });
      const fileName = `Note: ${noteTitle}.txt`;
      const storagePath = `notebooks/${selectedNotebookId}/notes/${editingNote.id}.txt`;

      const { error: uploadError } = await supabase.storage
        .from('insight-navigator')
        .upload(storagePath, blob, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: userData } = await supabase.auth.getUser();
      const { error: docError } = await supabase.from('documents').insert({
        user_id: userData.user!.id,
        notebook_id: selectedNotebookId,
        file_name: fileName,
        file_type: 'txt',
        mime_type: 'text/plain',
        file_size: blob.size,
        storage_path: storagePath,
        processing_status: 'uploaded',
        notebook_enabled: true,
      });
      if (docError) throw docError;

      queryClient.invalidateQueries({ queryKey: ['notebook-documents', selectedNotebookId] });
      toast.success('Note added to sources');
      setNoteModalOpen(false);
      setEditingNote(null);
    } catch (err: any) {
      toast.error('Failed to add note to sources');
    } finally {
      setAddingToSources(false);
    }
  };

  if (!notebook) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-foreground truncate">{notebook.name}</h1>
          {notebook.description && (
            <p className="text-xs text-muted-foreground truncate">{notebook.description}</p>
          )}
        </div>
      </div>

      {/* 3-column layout */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* LEFT — Sources */}
        <ResizablePanel defaultSize={22} minSize={16} maxSize={35}>
          <div className="flex flex-col h-full border-r border-border">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Sources</h2>
              <Button size="sm" className="h-7 gap-1 text-xs bg-accent hover:bg-accent/90 text-accent-foreground" onClick={() => setShowUpload(true)}>
                <Plus className="h-3 w-3" /> Add source
              </Button>
            </div>
            <ScrollArea className="flex-1">
              {documents.length === 0 ? (
                <div className="p-4 text-center">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-3">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">No sources yet</p>
                  <p className="text-xs text-muted-foreground mb-3">Upload documents to start asking questions</p>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setShowUpload(true)}>
                    <Upload className="h-3 w-3" /> Upload
                  </Button>
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
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{doc.file_name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <DocumentStatusBadge status={doc.processing_status} />
                          </div>
                        </div>
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteDocument.mutate(doc)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
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
          <div className="flex flex-col h-full">
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
                <ScrollArea className="flex-1 p-4">
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
                        <div className="max-w-[75%]">
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
                                <span>Thinking…</span>
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
                    <div ref={scrollRef} />
                  </div>
                </ScrollArea>

                {/* Chat input */}
                <div className="border-t border-border bg-card p-4">
                  <form onSubmit={handleSendChat}>
                    <div className="relative rounded-xl border border-border focus-within:border-accent focus-within:shadow-lg focus-within:shadow-accent/10 transition-all">
                      <Textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                        placeholder={isGenerating ? 'Waiting for response…' : 'Ask a question about your sources…'}
                        className="min-h-[56px] max-h-[200px] resize-none border-0 bg-transparent pr-28 focus-visible:ring-0 focus-visible:ring-offset-0"
                        rows={1}
                        disabled={isGenerating}
                      />
                      <div className="absolute right-2 bottom-2 flex items-center gap-1">
                        <DropdownMenu>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground gap-1">
                                  <span className="max-w-[80px] truncate">{currentModel.name}</span>
                                  <ChevronDown className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p className="font-medium">{currentModel.name}</p></TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="end" className="w-48">
                            {modelOptions.map((model) => (
                              <DropdownMenuItem key={model.id} onClick={() => setSelectedModel(model.id)} className={cn("text-sm", selectedModel === model.id && "bg-accent/10 text-accent font-medium")}>
                                {model.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="h-4 w-px bg-border" />
                        <Button type="submit" size="icon" disabled={!chatInput.trim() || isGenerating} className={cn("h-8 w-8 rounded-lg transition-all", chatInput.trim() && !isGenerating ? "bg-accent hover:bg-accent/90 text-accent-foreground" : "bg-muted text-muted-foreground")}>
                          <Send className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 px-1">
                      <span className="text-xs text-muted-foreground">
                        {enabledDocs.length} source{enabledDocs.length !== 1 ? 's' : ''} enabled
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {isGenerating ? 'AI is generating…' : <><kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to send</>}
                      </span>
                    </div>
                  </form>
                </div>
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
              <Button size="sm" className="h-7 gap-1 text-xs bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleAddNote} disabled={createNote.isPending}>
                <Plus className="h-3 w-3" /> Add note
              </Button>
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
                      onClick={() => handleStartEdit(note)}
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
            <DialogTitle>Edit Note</DialogTitle>
            <DialogDescription className="sr-only">Edit your notebook note</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Note title"
              className="text-base font-medium"
              autoFocus
            />
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Write your note…"
              className="min-h-[200px] resize-none text-sm leading-relaxed"
            />
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex items-center gap-2 mr-auto">
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
              {editingNote && (
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
                Cancel
              </Button>
              <Button size="sm" className="gap-1 bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleSaveNote} disabled={updateNote.isPending}>
                {updateNote.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </Button>
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
function NotebookChatMessage({ message, onSaveToNote, onCopy }: {
  message: { id: string; role: string; content: string; sources?: any[] | null; created_at: string; model_id?: string | null };
  onSaveToNote: (content: string) => void;
  onCopy: (content: string) => void;
}) {
  const isUser = message.role === 'user';
  const modelName = message.model_id ? modelOptions.find(m => m.id === message.model_id)?.name ?? message.model_id.split('/').pop() : null;

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

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <div className="space-y-1 px-1">
            <p className="text-xs font-medium text-muted-foreground">Sources</p>
            <div className="flex flex-wrap gap-1">
              {message.sources.map((s: any, i: number) => (
                <Badge key={i} variant="secondary" className="gap-1 py-0.5 px-2 text-xs font-normal">
                  <FileText className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{s.title}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Meta + actions */}
        <div className={cn("flex items-center gap-2 px-1 flex-wrap", isUser ? "flex-row-reverse" : "flex-row")}>
          <p className="text-[10px] text-muted-foreground">
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          {!isUser && (
            <>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
                <Bot className="h-2.5 w-2.5" /> AI{modelName ? ` · ${modelName}` : ''}
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground" onClick={() => onSaveToNote(message.content)}>
                <BookmarkPlus className="h-3 w-3" /> Save to note
              </Button>
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
