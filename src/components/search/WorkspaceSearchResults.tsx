import React from 'react';
import { FolderOpen, MessageSquare, FileText, X, Loader2, AlertCircle, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useApp } from '@/contexts/AppContext';
import { useWorkspaceSearch } from '@/hooks/useWorkspaceSearch';
import { useProjects } from '@/hooks/useProjects';

interface WorkspaceSearchResultsProps {
  query: string;
  onClose: () => void;
}

function truncateDocName(name: string, maxChars = 35): string {
  if (name.length <= maxChars) return name;
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  const base = name.slice(0, name.length - ext.length);
  const visibleBase = maxChars - ext.length - 1;
  if (visibleBase < 8) return name.slice(0, maxChars - 1) + '…';
  return base.slice(0, visibleBase) + '…' + ext;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') {
    return <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-emerald-500/30 text-emerald-600">Searchable</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-destructive/30 text-destructive">Failed</Badge>;
  }
  return <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-yellow-500/30 text-yellow-600">Processing</Badge>;
}

export function WorkspaceSearchResults({ query, onClose }: WorkspaceSearchResultsProps) {
  const { setSelectedProjectId, setSelectedChatId, setDocumentScope } = useApp();
  const { data, isLoading, isError } = useWorkspaceSearch(query);
  const { data: allProjects = [] } = useProjects();

  const projectMap = React.useMemo(() => {
    const map = new Map<string, string>();
    allProjects.forEach(p => map.set(p.id, p.name));
    return map;
  }, [allProjects]);

  const totalResults = (data?.projects.length ?? 0) + (data?.chats.length ?? 0) + (data?.documents.length ?? 0);
  const tooShort = query.trim().length < 2;

  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-sidebar border border-sidebar-border rounded-lg shadow-lg overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
        <span className="text-xs font-medium text-sidebar-muted">
          {isLoading ? 'Searching…' : tooShort ? 'Type at least 2 characters' : `${totalResults} results`}
        </span>
        <Button variant="ghost" size="icon" className="h-5 w-5 text-sidebar-muted hover:text-sidebar-foreground" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <ScrollArea className="max-h-80">
        {isLoading && (
          <div className="px-3 py-6 flex items-center justify-center gap-2 text-sm text-sidebar-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching workspace…
          </div>
        )}

        {isError && (
          <div className="px-3 py-6 flex items-center justify-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Search failed. Please try again.
          </div>
        )}

        {!isLoading && !isError && !tooShort && totalResults === 0 && (
          <div className="px-3 py-6 text-center text-sm text-sidebar-muted">
            <Search className="h-5 w-5 mx-auto mb-2 opacity-40" />
            No results found for "{query}"
          </div>
        )}

        {!isLoading && !isError && data && totalResults > 0 && (
          <div className="p-1.5">
            {/* Projects */}
            {data.projects.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">Projects</div>
                {data.projects.map(p => (
                  <button
                    key={p.id}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition-colors text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={() => { setSelectedProjectId(p.id); setSelectedChatId(null); onClose(); }}
                  >
                    <FolderOpen className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-sidebar-primary" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{p.name}</span>
                      {p.description && <p className="text-[10px] text-sidebar-muted truncate mt-0.5">{p.description}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Chats */}
            {data.chats.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">Chats</div>
                {data.chats.map(c => (
                  <button
                    key={c.id}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition-colors text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={() => { setSelectedProjectId(c.project_id); setSelectedChatId(c.id); onClose(); }}
                  >
                    <MessageSquare className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-sidebar-primary" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{c.name}</span>
                      <p className="text-[10px] text-sidebar-muted truncate mt-0.5">
                        {projectMap.get(c.project_id) ?? 'Unknown project'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Documents */}
            {data.documents.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">Documents</div>
                {data.documents.map(doc => (
                  <button
                    key={doc.document_id}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition-colors text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={() => {
                      setSelectedProjectId(doc.project_id);
                      if (doc.chat_id) {
                        setSelectedChatId(doc.chat_id);
                        setDocumentScope('chat');
                      } else {
                        setSelectedChatId(null);
                        setDocumentScope('project');
                      }
                      onClose();
                    }}
                  >
                    <FileText className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-sidebar-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm truncate">{truncateDocName(doc.file_name)}</span>
                        <StatusBadge status={doc.processing_status} />
                      </div>
                      <p className="text-[10px] text-sidebar-muted truncate mt-0.5">
                        {doc.chat_id ? 'Chat document' : 'Project document'} · {projectMap.get(doc.project_id) ?? 'Unknown'}
                      </p>
                      {doc.snippet && (
                        <p className="text-[10px] text-sidebar-muted/70 line-clamp-2 mt-0.5 leading-relaxed">{doc.snippet}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
