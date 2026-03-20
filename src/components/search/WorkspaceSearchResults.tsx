import React from 'react';
import { FolderOpen, MessageSquare, FileText, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useApp } from '@/contexts/AppContext';
import { useProjects } from '@/hooks/useProjects';
import { useChats } from '@/hooks/useChats';
import { cn } from '@/lib/utils';

interface SearchResult {
  type: 'project' | 'chat';
  id: string;
  name: string;
  projectId?: string;
  projectName?: string;
  snippet?: string;
}

interface WorkspaceSearchResultsProps {
  query: string;
  onClose: () => void;
}

export function WorkspaceSearchResults({ query, onClose }: WorkspaceSearchResultsProps) {
  const { setSelectedProjectId, setSelectedChatId } = useApp();
  const { data: projects = [] } = useProjects();

  // Simple search across project names. Chat search would require loading all chats which is expensive.
  // For now, search projects only.
  const searchResults: SearchResult[] = React.useMemo(() => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];

    projects.forEach(project => {
      if (project.name.toLowerCase().includes(lowerQuery) || project.description.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'project',
          id: project.id,
          name: project.name,
          snippet: project.description,
        });
      }
    });

    return results;
  }, [query, projects]);

  const handleResultClick = (result: SearchResult) => {
    if (result.type === 'project') {
      setSelectedProjectId(result.id);
      setSelectedChatId(null);
    } else if (result.type === 'chat' && result.projectId) {
      setSelectedProjectId(result.projectId);
      setSelectedChatId(result.id);
    }
    onClose();
  };

  const hasResults = searchResults.length > 0;

  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-sidebar border border-sidebar-border rounded-lg shadow-lg overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
        <span className="text-xs font-medium text-sidebar-muted">
          {hasResults ? `${searchResults.length} results` : 'No results found'}
        </span>
        <Button variant="ghost" size="icon" className="h-5 w-5 text-sidebar-muted hover:text-sidebar-foreground" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <ScrollArea className="max-h-64">
        {!hasResults ? (
          <div className="px-3 py-6 text-center text-sm text-sidebar-muted">No results found for "{query}"</div>
        ) : (
          <div className="p-2 space-y-0.5">
            {searchResults.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition-colors text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => handleResultClick(result)}
              >
                <FolderOpen className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-sidebar-primary" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block">{result.name}</span>
                  {result.snippet && <p className="text-[10px] text-sidebar-muted truncate mt-0.5">{result.snippet}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
