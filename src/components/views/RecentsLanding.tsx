import React from 'react';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useApp } from '@/contexts/AppContext';
import { Clock, FolderOpen, BookOpenCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function RecentsLanding() {
  const { data: projects = [] } = useProjects();
  const { data: notebooks = [] } = useNotebooks();
  const { setSelectedProjectId, setSelectedChatId, setSelectedNotebookId, setActiveView } = useApp();

  // Merge and sort by updated_at
  const recentItems = [
    ...projects.map(p => ({ type: 'project' as const, id: p.id, name: p.name, updatedAt: p.updated_at })),
    ...notebooks.map(n => ({ type: 'notebook' as const, id: n.id, name: n.name, updatedAt: n.updated_at })),
  ]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 20);

  const handleClick = (item: typeof recentItems[0]) => {
    if (item.type === 'project') {
      setSelectedProjectId(item.id);
      setSelectedChatId(null);
      setSelectedNotebookId(null);
      setActiveView('default');
    } else {
      setSelectedProjectId(null);
      setSelectedChatId(null);
      setSelectedNotebookId(item.id);
      setActiveView('notebook-workspace');
    }
  };

  return (
    <div className="flex-1 flex flex-col p-8 max-w-2xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Clock className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Recents</h1>
      </div>

      {recentItems.length === 0 ? (
        <p className="text-muted-foreground">No recent activity yet.</p>
      ) : (
        <div className="space-y-1">
          {recentItems.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => handleClick(item)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors text-left"
            >
              {item.type === 'project' ? (
                <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
              ) : (
                <BookOpenCheck className="h-4 w-4 text-primary flex-shrink-0" />
              )}
              <span className="flex-1 text-sm font-medium text-foreground truncate">{item.name}</span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
