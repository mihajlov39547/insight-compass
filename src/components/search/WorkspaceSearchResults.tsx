import React from 'react';
import { FolderOpen, MessageSquare, FileText, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useApp } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';

interface SearchResult {
  type: 'project' | 'chat' | 'document';
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
  const { 
    projects, 
    sharedWithMeProjects, 
    setSelectedProject, 
    setSelectedChat 
  } = useApp();

  const allProjects = [...projects, ...sharedWithMeProjects];

  // Search logic
  const searchResults: SearchResult[] = React.useMemo(() => {
    if (!query.trim()) return [];
    
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];

    allProjects.forEach(project => {
      // Search project names
      if (project.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'project',
          id: project.id,
          name: project.name,
          snippet: project.description,
        });
      }

      // Search chats
      project.chats.forEach(chat => {
        // Search chat names
        if (chat.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            type: 'chat',
            id: chat.id,
            name: chat.name,
            projectId: project.id,
            projectName: project.name,
          });
        }

        // Search message content (preview)
        chat.messages.forEach(msg => {
          if (msg.content.toLowerCase().includes(lowerQuery)) {
            // Avoid duplicates
            if (!results.find(r => r.type === 'chat' && r.id === chat.id)) {
              const matchIndex = msg.content.toLowerCase().indexOf(lowerQuery);
              const start = Math.max(0, matchIndex - 30);
              const end = Math.min(msg.content.length, matchIndex + query.length + 30);
              const snippet = (start > 0 ? '...' : '') + 
                msg.content.slice(start, end) + 
                (end < msg.content.length ? '...' : '');
              
              results.push({
                type: 'chat',
                id: chat.id,
                name: chat.name,
                projectId: project.id,
                projectName: project.name,
                snippet,
              });
            }
          }
        });
      });

      // Search documents
      project.documents.forEach(doc => {
        if (doc.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            type: 'document',
            id: doc.id,
            name: doc.name,
            projectId: project.id,
            projectName: project.name,
          });
        }
      });

      // Search chat-level documents
      project.chats.forEach(chat => {
        chat.documents.forEach(doc => {
          if (doc.name.toLowerCase().includes(lowerQuery)) {
            // Avoid duplicates
            if (!results.find(r => r.type === 'document' && r.id === doc.id)) {
              results.push({
                type: 'document',
                id: doc.id,
                name: doc.name,
                projectId: project.id,
                projectName: project.name,
              });
            }
          }
        });
      });
    });

    return results;
  }, [query, allProjects]);

  const handleResultClick = (result: SearchResult) => {
    if (result.type === 'project') {
      const project = allProjects.find(p => p.id === result.id);
      if (project) {
        setSelectedProject(project);
        setSelectedChat(null);
      }
    } else if (result.type === 'chat' && result.projectId) {
      const project = allProjects.find(p => p.id === result.projectId);
      if (project) {
        const chat = project.chats.find(c => c.id === result.id);
        if (chat) {
          setSelectedProject(project);
          setSelectedChat(chat);
        }
      }
    } else if (result.type === 'document' && result.projectId) {
      // Navigate to project and potentially show documents dialog
      const project = allProjects.find(p => p.id === result.projectId);
      if (project) {
        setSelectedProject(project);
        setSelectedChat(null);
      }
    }
    onClose();
  };

  // Group results by type
  const groupedResults = {
    projects: searchResults.filter(r => r.type === 'project'),
    chats: searchResults.filter(r => r.type === 'chat'),
    documents: searchResults.filter(r => r.type === 'document'),
  };

  const hasResults = searchResults.length > 0;

  const getIcon = (type: 'project' | 'chat' | 'document') => {
    switch (type) {
      case 'project': return FolderOpen;
      case 'chat': return MessageSquare;
      case 'document': return FileText;
    }
  };

  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-sidebar border border-sidebar-border rounded-lg shadow-lg overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
        <span className="text-xs font-medium text-sidebar-muted">
          {hasResults ? `${searchResults.length} results` : 'No results found'}
        </span>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-5 w-5 text-sidebar-muted hover:text-sidebar-foreground"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      
      <ScrollArea className="max-h-64">
        {!hasResults ? (
          <div className="px-3 py-6 text-center text-sm text-sidebar-muted">
            No results found for "{query}"
          </div>
        ) : (
          <div className="p-2 space-y-3">
            {Object.entries(groupedResults).map(([type, results]) => {
              if (results.length === 0) return null;
              const Icon = getIcon(type as 'project' | 'chat' | 'document');
              const label = type.charAt(0).toUpperCase() + type.slice(1);
              
              return (
                <div key={type}>
                  <p className="text-[10px] uppercase tracking-wider font-medium text-sidebar-muted px-2 mb-1">
                    {label}
                  </p>
                  <div className="space-y-0.5">
                    {results.map((result) => (
                      <button
                        key={`${result.type}-${result.id}`}
                        className={cn(
                          "w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition-colors",
                          "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}
                        onClick={() => handleResultClick(result)}
                      >
                        <Icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-sidebar-primary" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate block">{result.name}</span>
                          {result.projectName && result.type !== 'project' && (
                            <span className="text-[10px] text-sidebar-muted">
                              in {result.projectName}
                            </span>
                          )}
                          {result.snippet && (
                            <p className="text-[10px] text-sidebar-muted truncate mt-0.5">
                              {result.snippet}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
