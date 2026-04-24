import React, { useState, useMemo } from 'react';
import { MessageSquare, FileText, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/contexts/useApp';
import { DbChat, useDeleteChat, useUpdateChat } from '@/hooks/useChats';
import { useChatPreviews } from '@/hooks/useChatPreviews';
import { formatDistanceToNow } from 'date-fns';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChatActionsMenuContent } from '@/components/actions/EntityActionMenus';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { ItemPermissions } from '@/lib/permissions';
import { getDateLocale } from '@/lib/languages';
import { useTranslation } from 'react-i18next';

const BATCH_SIZE = 6;

function formatActivity(dateStr: string, locale: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return formatDistanceToNow(date, { addSuffix: true });
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface Props {
  chats: DbChat[];
  permissions?: ItemPermissions | null;
}

export function ProjectChatGrid({ chats, permissions }: Props) {
  const { i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.resolvedLanguage || i18n.language);
  const { selectedChatId, setSelectedProjectId, setSelectedChatId, setActiveView } = useApp();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [renameChatId, setRenameChatId] = useState<string | null>(null);
  const [renameChatValue, setRenameChatValue] = useState('');
  const [pendingDeleteChat, setPendingDeleteChat] = useState<DbChat | null>(null);

  const deleteChat = useDeleteChat();
  const updateChat = useUpdateChat();

  const chatIds = useMemo(() => chats.map(c => c.id), [chats]);
  const { data: previews = {} } = useChatPreviews(chatIds);

  const visibleChats = chats.slice(0, visibleCount);
  const hasMore = chats.length > visibleCount;
  const allShown = visibleCount >= chats.length;

  const canRename = permissions ? permissions.canRenameChats : true;
  const canDelete = permissions ? permissions.canDeleteChats : true;
  const showActions = canRename || canDelete || (permissions ? permissions.canViewDocuments : true);

  const handleManageChatDocs = (chat: DbChat) => {
    setSelectedProjectId(chat.project_id);
    setSelectedChatId(chat.id);
    setActiveView('chat-documents');
  };

  const handleDeleteChat = (chat: DbChat) => {
    setPendingDeleteChat(chat);
  };

  const confirmDeleteChat = () => {
    if (!pendingDeleteChat) return;
    deleteChat.mutate({ id: pendingDeleteChat.id, projectId: pendingDeleteChat.project_id }, {
      onSuccess: () => {
        if (selectedChatId === pendingDeleteChat.id) setSelectedChatId(null);
        toast.success('Chat and all its data deleted');
        setPendingDeleteChat(null);
      },
    });
  };

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">
          Chats ({chats.length})
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleChats.map((chat) => {
          const preview = previews[chat.id];
          const docCount = preview?.docCount || 0;
          const lastMessage = preview?.lastMessage;

          return (
            <div
              key={chat.id}
              role="button"
              tabIndex={0}
              className="group relative p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 text-left transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5 cursor-pointer active:scale-[0.99]"
              onClick={() => setSelectedChatId(chat.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedChatId(chat.id);
                }
              }}
            >
              {showActions && (
                <div className="absolute top-2 right-2 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <ChatActionsMenuContent
                      permissions={permissions}
                      onRenameChat={() => {
                        setRenameChatId(chat.id);
                        setRenameChatValue(chat.name);
                      }}
                      onManageDocuments={() => handleManageChatDocs(chat)}
                      onDeleteChat={() => handleDeleteChat(chat)}
                    />
                  </DropdownMenu>
                </div>
              )}

              <div className="flex items-center gap-2 mb-1.5 pr-8">
                <MessageSquare className="h-3.5 w-3.5 text-accent shrink-0" />
                <span className="font-medium text-sm text-foreground truncate">
                  {chat.name}
                </span>
              </div>

              <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem] mb-2.5">
                {lastMessage || 'No messages yet'}
              </p>

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  <span>{docCount} doc{docCount !== 1 ? 's' : ''}</span>
                </div>
                <span className="ml-auto">{formatActivity(chat.updated_at, dateLocale)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-accent hover:text-accent/80 gap-1"
          onClick={() => setVisibleCount(prev => prev + BATCH_SIZE)}
        >
          View all {chats.length} chats
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      )}
      {allShown && chats.length > BATCH_SIZE && (
        <p className="mt-3 text-xs text-muted-foreground text-center">All chats shown</p>
      )}

      <Dialog open={!!renameChatId} onOpenChange={(open) => !open && setRenameChatId(null)}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameChatValue}
            onChange={(e) => setRenameChatValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameChatId && renameChatValue.trim()) {
                updateChat.mutate({ id: renameChatId, name: renameChatValue.trim() }, {
                  onSuccess: () => {
                    toast.success('Chat renamed');
                    setRenameChatId(null);
                  },
                });
              }
            }}
            placeholder="Chat name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameChatId(null)}>Cancel</Button>
            <Button
              disabled={!renameChatValue.trim()}
              onClick={() => {
                if (!renameChatId || !renameChatValue.trim()) return;
                updateChat.mutate({ id: renameChatId, name: renameChatValue.trim() }, {
                  onSuccess: () => {
                    toast.success('Chat renamed');
                    setRenameChatId(null);
                  },
                });
              }}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDeleteChat} onOpenChange={(open) => !open && setPendingDeleteChat(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this chat and all of its data, including:
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>All messages and conversation history</li>
                <li>All uploaded documents and files</li>
                <li>All extracted text, summaries, and processed data</li>
              </ul>
              <span className="block mt-2 font-medium">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteChat}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
