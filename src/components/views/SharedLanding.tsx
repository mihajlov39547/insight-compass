import React from 'react';
import { Users, FolderOpen, BookOpenCheck, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useSharedItems, SharedItem } from '@/hooks/useSharedItems';
import { useApp } from '@/contexts/useApp';
import { formatDistanceToNow } from 'date-fns';

function SharedItemCard({ item }: { item: SharedItem }) {
  const { setSelectedProjectId, setSelectedChatId, setSelectedNotebookId, setActiveView } = useApp();

  const handleClick = () => {
    if (item.item_type === 'project') {
      setSelectedProjectId(item.item_id);
      setSelectedChatId(null);
      setSelectedNotebookId(null);
      setActiveView('default');
    } else {
      setSelectedProjectId(null);
      setSelectedChatId(null);
      setSelectedNotebookId(item.item_id);
      setActiveView('notebook-workspace');
    }
  };

  const initials = item.shared_by_name
    ? item.shared_by_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const isProject = item.item_type === 'project';

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-all hover:border-primary/30 group"
      onClick={handleClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isProject ? 'bg-primary/10' : 'bg-accent/20'
          }`}>
            {isProject
              ? <FolderOpen className="h-5 w-5 text-primary" />
              : <BookOpenCheck className="h-5 w-5 text-accent" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                {item.item_name}
              </h3>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                {isProject ? 'Project' : 'Notebook'}
              </Badge>
            </div>
            {item.item_description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                {item.item_description}
              </p>
            )}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Avatar className="h-5 w-5">
                  {item.shared_by_avatar && <AvatarImage src={item.shared_by_avatar} />}
                  <AvatarFallback className="text-[8px] bg-muted">{initials}</AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground">
                  Shared by {item.shared_by_name}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(item.item_updated_at || item.created_at), { addSuffix: true })}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SharedLanding() {
  const { data: sharedItems = [], isLoading } = useSharedItems();

  const sharedProjects = sharedItems.filter(i => i.item_type === 'project');
  const sharedNotebooks = sharedItems.filter(i => i.item_type === 'notebook');
  const hasItems = sharedProjects.length > 0 || sharedNotebooks.length > 0;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!hasItems) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
          <Users className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Shared with me</h1>
        <p className="text-muted-foreground text-center max-w-md mb-2">
          Projects and notebooks shared with you will appear here.
        </p>
        <p className="text-sm text-muted-foreground/70 text-center max-w-sm">
          When collaborators share their projects or notebooks with you, you'll be able to access them from this dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Shared with me</h1>
        <p className="text-muted-foreground text-sm">
          Projects and notebooks shared by your collaborators
        </p>
      </div>

      {sharedProjects.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Shared Projects
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sharedProjects.map(item => (
              <SharedItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {sharedNotebooks.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <BookOpenCheck className="h-4 w-4" />
            Shared Notebooks
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sharedNotebooks.map(item => (
              <SharedItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
