import React from 'react';
import { useMessages } from '@/hooks/useMessages';
import { ChatExportDialog } from './ChatExportDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextType: 'project' | 'notebook';
  contextId: string;
  contextName: string;
  chatId: string;
  chatTitle?: string;
  exportedByLabel?: string;
}

/**
 * Loads chat messages on demand and renders the existing ChatExportDialog.
 * Used by chat-list three-dot menus where messages aren't already in scope.
 */
export function ChatExportByIdDialog(props: Props) {
  const { open, chatId } = props;
  const { data: messages = [] } = useMessages(open ? chatId : undefined);

  return (
    <ChatExportDialog
      open={open}
      onOpenChange={props.onOpenChange}
      contextType={props.contextType}
      contextId={props.contextId}
      contextName={props.contextName}
      chatId={chatId}
      chatTitle={props.chatTitle}
      exportedByLabel={props.exportedByLabel}
      messages={messages}
    />
  );
}
