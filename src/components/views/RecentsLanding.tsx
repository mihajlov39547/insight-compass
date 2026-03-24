import React from 'react';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useRecentChats } from '@/hooks/useRecentChats';
import { useApp } from '@/contexts/AppContext';
import { Clock, BookOpenCheck, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function RecentsLanding() {
  const { data: notebooks = [] } = useNotebooks();
  const { data: recentChats = [] } = useRecentChats(10);
  const { setSelectedProjectId, setSelectedChatId, setSelectedNotebookId, setActiveView } = useApp();

  const recentItems = [
    ...recentChats.map(c => ({ type: 'chat' as const, id: c.id, name: c.name, updatedAt: c.updated_at, projectId: c.project_id })),
    ...notebooks.map(n => ({ type: 'notebook' as const, id: n.id, name: n.name, updatedAt: n.updated_at, projectId: undefined as string | undefined })),
  ]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  const handleClick = (item: typeof recentItems[0]) => {
    if (item.type === 'chat') {
      setSelectedProjectId(item.projectId || null);
      setSelectedChatId(item.id);
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
              {item.type === 'chat' ? (
                <MessageSquare className="h-4 w-4 text-primary flex-shrink-0" />
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
