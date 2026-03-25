import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, FolderOpen, MessageSquare, BookOpenCheck, StickyNote, FileText, Filter, X, Sparkles, Type } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { hybridRetrieve, type HybridResult } from '@/hooks/useHybridRetrieval';

type SearchFilter = 'all' | 'projects' | 'notebooks' | 'documents';

interface ProjectResult {
  type: 'project';
  id: string;
  name: string;
  description: string;
}

interface ChatResult {
  type: 'chat';
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  matchSource: 'name' | 'message';
  snippet?: string;
}

interface NotebookResult {
  type: 'notebook';
  id: string;
  name: string;
  description: string;
  matchSource: 'name' | 'message' | 'note';
  snippet?: string;
}

interface DocumentResult {
  type: 'document';
  documentId: string;
  fileName: string;
  chunkText: string;
  matchType: 'semantic' | 'keyword' | 'hybrid';
  combinedScore: number;
  summary: string | null;
  projectId: string | null;
}

type SearchResult = ProjectResult | ChatResult | NotebookResult | DocumentResult;

function useSearchDashboard(query: string, filter: SearchFilter) {
  const { user } = useAuth();
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['search-dashboard', trimmed, filter],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!trimmed || trimmed.length < 2) return [];
      const pattern = `%${trimmed}%`;
      const results: SearchResult[] = [];

      // Projects & Chats
      if (filter === 'all' || filter === 'projects') {
        const [projectsRes, chatsRes, messagesRes] = await Promise.all([
          supabase.from('projects').select('id, name, description').eq('is_archived', false).or(`name.ilike.${pattern},description.ilike.${pattern}`).limit(10),
          supabase.from('chats').select('id, name, project_id').eq('is_archived', false).ilike('name', pattern).limit(10),
          supabase.from('messages').select('id, chat_id, content, role').ilike('content', pattern).limit(20),
        ]);

        const chatProjectIds = new Set<string>();
        (chatsRes.data ?? []).forEach(c => chatProjectIds.add(c.project_id));
        
        const messageChatIds = new Set<string>();
        (messagesRes.data ?? []).forEach(m => messageChatIds.add(m.chat_id));
        
        let chatInfoMap = new Map<string, { name: string; project_id: string }>();
        if (messageChatIds.size > 0) {
          const { data: chatInfos } = await supabase.from('chats').select('id, name, project_id').in('id', [...messageChatIds]);
          (chatInfos ?? []).forEach(c => { chatInfoMap.set(c.id, { name: c.name, project_id: c.project_id }); chatProjectIds.add(c.project_id); });
        }

        let projectNameMap = new Map<string, string>();
        if (chatProjectIds.size > 0) {
          const { data: pNames } = await supabase.from('projects').select('id, name').in('id', [...chatProjectIds]);
          (pNames ?? []).forEach(p => projectNameMap.set(p.id, p.name));
        }

        (projectsRes.data ?? []).forEach(p => results.push({ type: 'project', id: p.id, name: p.name, description: p.description }));
        
        const addedChatIds = new Set<string>();
        (chatsRes.data ?? []).forEach(c => {
          addedChatIds.add(c.id);
          results.push({ type: 'chat', id: c.id, name: c.name, projectId: c.project_id, projectName: projectNameMap.get(c.project_id) ?? 'Unknown', matchSource: 'name' });
        });

        (messagesRes.data ?? []).forEach(m => {
          if (addedChatIds.has(m.chat_id)) return;
          addedChatIds.add(m.chat_id);
          const info = chatInfoMap.get(m.chat_id);
          if (!info) return;
          results.push({
            type: 'chat', id: m.chat_id, name: info.name, projectId: info.project_id,
            projectName: projectNameMap.get(info.project_id) ?? 'Unknown', matchSource: 'message',
            snippet: m.content.length > 120 ? m.content.slice(0, 120) + '…' : m.content,
          });
        });
      }

      // Notebooks
      if (filter === 'all' || filter === 'notebooks') {
        const [nbRes, nbMsgRes, nbNotesRes] = await Promise.all([
          supabase.from('notebooks').select('id, name, description').eq('is_archived', false).or(`name.ilike.${pattern},description.ilike.${pattern}`).limit(10),
          supabase.from('notebook_messages').select('id, notebook_id, content').ilike('content', pattern).limit(20),
          supabase.from('notebook_notes').select('id, notebook_id, title, content').or(`title.ilike.${pattern},content.ilike.${pattern}`).limit(20),
        ]);

        const addedNbIds = new Set<string>();
        
        const nbIdsFromMsgs = new Set<string>();
        (nbMsgRes.data ?? []).forEach(m => nbIdsFromMsgs.add(m.notebook_id));
        (nbNotesRes.data ?? []).forEach(n => nbIdsFromMsgs.add(n.notebook_id));
        
        let nbNameMap = new Map<string, { name: string; description: string }>();
        if (nbIdsFromMsgs.size > 0) {
          const { data: nbInfos } = await supabase.from('notebooks').select('id, name, description').in('id', [...nbIdsFromMsgs]);
          (nbInfos ?? []).forEach(n => nbNameMap.set(n.id, { name: n.name, description: n.description }));
        }

        (nbRes.data ?? []).forEach(n => { addedNbIds.add(n.id); results.push({ type: 'notebook', id: n.id, name: n.name, description: n.description, matchSource: 'name' }); });

        (nbMsgRes.data ?? []).forEach(m => {
          if (addedNbIds.has(m.notebook_id)) return;
          addedNbIds.add(m.notebook_id);
          const info = nbNameMap.get(m.notebook_id);
          results.push({
            type: 'notebook', id: m.notebook_id, name: info?.name ?? 'Notebook', description: info?.description ?? '',
            matchSource: 'message', snippet: m.content.length > 120 ? m.content.slice(0, 120) + '…' : m.content,
          });
        });

        (nbNotesRes.data ?? []).forEach(n => {
          if (addedNbIds.has(n.notebook_id)) return;
          addedNbIds.add(n.notebook_id);
          const info = nbNameMap.get(n.notebook_id);
          results.push({
            type: 'notebook', id: n.notebook_id, name: info?.name ?? 'Notebook', description: info?.description ?? '',
            matchSource: 'note', snippet: n.title || (n.content.length > 120 ? n.content.slice(0, 120) + '…' : n.content),
          });
        });
      }

      // Documents — hybrid retrieval
      if (filter === 'all' || filter === 'documents') {
        try {
          const docResults = await hybridRetrieve({
            query: trimmed,
            scope: 'global',
            maxResults: 10,
          });

          // Deduplicate by documentId for display
          const seenDocs = new Set<string>();
          for (const r of docResults) {
            if (seenDocs.has(r.documentId)) continue;
            seenDocs.add(r.documentId);
            results.push({
              type: 'document',
              documentId: r.documentId,
              fileName: r.fileName,
              chunkText: r.chunkText.slice(0, 200),
              matchType: r.matchType,
              combinedScore: r.combinedScore,
              summary: r.summary,
              projectId: r.projectId,
            });
          }
        } catch (e) {
          console.warn('Document hybrid search failed:', e);
        }
      }

      return results;
    },
    enabled: !!user && trimmed.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function SearchDashboard() {
  const { searchQuery, setSearchQuery, setSelectedProjectId, setSelectedChatId, setSelectedNotebookId, setActiveView } = useApp();
  const [filter, setFilter] = useState<SearchFilter>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: results = [], isLoading } = useSearchDashboard(searchQuery, filter);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const grouped = useMemo(() => {
    const projects = results.filter((r): r is ProjectResult => r.type === 'project');
    const chats = results.filter((r): r is ChatResult => r.type === 'chat');
    const notebooks = results.filter((r): r is NotebookResult => r.type === 'notebook');
    const documents = results.filter((r): r is DocumentResult => r.type === 'document');
    return { projects, chats, notebooks, documents };
  }, [results]);

  const filters: { key: SearchFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'projects', label: 'Projects' },
    { key: 'notebooks', label: 'Notebooks' },
    { key: 'documents', label: 'Documents' },
  ];

  const handleProjectClick = (id: string) => {
    setSelectedProjectId(id); setSelectedChatId(null); setSelectedNotebookId(null); setActiveView('default');
  };

  const handleChatClick = (chatId: string, projectId: string) => {
    setSelectedProjectId(projectId); setSelectedChatId(chatId); setSelectedNotebookId(null); setActiveView('default');
  };

  const handleNotebookClick = (id: string) => {
    setSelectedProjectId(null); setSelectedChatId(null); setSelectedNotebookId(id); setActiveView('notebook-workspace');
  };

  const hasQuery = searchQuery.trim().length >= 2;
  const totalResults = results.length;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <h1 className="text-2xl font-bold text-foreground mb-4">Search</h1>
        <div className="relative max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects, notebooks…"
            className="pl-10 pr-9 h-11 text-base"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          {filters.map(f => (
            <button
              key={f.key}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 max-w-3xl">
          {/* Empty state - no query */}
          {!hasQuery && (
            <div className="text-center py-16">
              <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-sm">Search across your projects, chats, notebooks, and notes</p>
              <p className="text-muted-foreground/60 text-xs mt-1">Type at least 2 characters to start</p>
            </div>
          )}

          {/* Loading */}
          {hasQuery && isLoading && (
            <div className="text-center py-12 text-muted-foreground text-sm">Searching…</div>
          )}

          {/* No results */}
          {hasQuery && !isLoading && totalResults === 0 && (
            <div className="text-center py-16">
              <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No results found for "{searchQuery}"</p>
              <p className="text-muted-foreground/60 text-xs mt-1">Try a different search term or filter</p>
            </div>
          )}

          {/* Results */}
          {hasQuery && !isLoading && totalResults > 0 && (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">{totalResults} result{totalResults !== 1 ? 's' : ''}</p>

              {/* Projects */}
              {grouped.projects.length > 0 && (filter === 'all' || filter === 'projects') && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Projects</h3>
                  <div className="space-y-1">
                    {grouped.projects.map(p => (
                      <button key={p.id} className="w-full flex items-start gap-3 p-3 rounded-lg text-left hover:bg-muted/50 transition-colors" onClick={() => handleProjectClick(p.id)}>
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <FolderOpen className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                          {p.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Project Chats */}
              {grouped.chats.length > 0 && (filter === 'all' || filter === 'projects') && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Project Chats</h3>
                  <div className="space-y-1">
                    {grouped.chats.map(c => (
                      <button key={c.id} className="w-full flex items-start gap-3 p-3 rounded-lg text-left hover:bg-muted/50 transition-colors" onClick={() => handleChatClick(c.id, c.projectId)}>
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <MessageSquare className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{c.projectName}</p>
                          {c.snippet && <p className="text-xs text-muted-foreground/70 line-clamp-2 mt-1">{c.snippet}</p>}
                        </div>
                        {c.matchSource === 'message' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">message match</Badge>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Notebooks */}
              {grouped.notebooks.length > 0 && (filter === 'all' || filter === 'notebooks') && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Notebooks</h3>
                  <div className="space-y-1">
                    {grouped.notebooks.map(n => (
                      <button key={n.id} className="w-full flex items-start gap-3 p-3 rounded-lg text-left hover:bg-muted/50 transition-colors" onClick={() => handleNotebookClick(n.id)}>
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          {n.matchSource === 'note' ? <StickyNote className="h-4 w-4 text-primary" /> : <BookOpenCheck className="h-4 w-4 text-primary" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{n.name}</p>
                          {n.description && n.matchSource === 'name' && <p className="text-xs text-muted-foreground truncate mt-0.5">{n.description}</p>}
                          {n.snippet && <p className="text-xs text-muted-foreground/70 line-clamp-2 mt-1">{n.snippet}</p>}
                        </div>
                        {n.matchSource !== 'name' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                            {n.matchSource === 'message' ? 'chat match' : 'note match'}
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Documents */}
              {grouped.documents.length > 0 && (filter === 'all' || filter === 'documents') && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Documents</h3>
                  <div className="space-y-1">
                    {grouped.documents.map(d => (
                      <button
                        key={d.documentId}
                        className="w-full flex items-start gap-3 p-3 rounded-lg text-left hover:bg-muted/50 transition-colors"
                        onClick={() => {
                          if (d.projectId) {
                            setSelectedProjectId(d.projectId);
                            setSelectedChatId(null);
                            setSelectedNotebookId(null);
                            setActiveView('default');
                          }
                        }}
                      >
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{d.fileName}</p>
                          {d.summary && <p className="text-xs text-muted-foreground truncate mt-0.5">{d.summary}</p>}
                          {d.chunkText && <p className="text-xs text-muted-foreground/70 line-clamp-2 mt-1">{d.chunkText}</p>}
                        </div>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
                          {d.matchType === 'hybrid' ? (
                            <span className="flex items-center gap-0.5"><Sparkles className="h-2.5 w-2.5" />hybrid</span>
                          ) : d.matchType === 'semantic' ? (
                            <span className="flex items-center gap-0.5"><Sparkles className="h-2.5 w-2.5" />semantic</span>
                          ) : (
                            <span className="flex items-center gap-0.5"><Type className="h-2.5 w-2.5" />keyword</span>
                          )}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
