import React from 'react';
import { Settings, FileText, Share2, Archive, Trash2, Pencil, BookOpen } from 'lucide-react';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

interface ProjectActionsMenuContentProps {
  onManageProject: () => void;
  onManageDocuments: () => void;
  onShareProject?: () => void;
  onArchiveProject: () => void;
  onDeleteProject: () => void;
  shareDisabled?: boolean;
}

export function ProjectActionsMenuContent({
  onManageProject,
  onManageDocuments,
  onShareProject,
  onArchiveProject,
  onDeleteProject,
  shareDisabled = true,
}: ProjectActionsMenuContentProps) {
  return (
    <DropdownMenuContent
      align="end"
      className="w-48"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageProject(); }}>
        <Settings className="h-3.5 w-3.5 mr-2" /> Manage project
      </DropdownMenuItem>
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
        <FileText className="h-3.5 w-3.5 mr-2" /> Manage documents
      </DropdownMenuItem>
      <DropdownMenuItem disabled={shareDisabled} onClick={(e) => { e.stopPropagation(); onShareProject?.(); }}>
        <Share2 className="h-3.5 w-3.5 mr-2" /> Share project
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchiveProject(); }}>
        <Archive className="h-3.5 w-3.5 mr-2" /> Archive project
      </DropdownMenuItem>
      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteProject(); }}>
        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete project
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

interface ChatActionsMenuContentProps {
  onRenameChat: () => void;
  onManageDocuments: () => void;
  onDeleteChat: () => void;
}

export function ChatActionsMenuContent({
  onRenameChat,
  onManageDocuments,
  onDeleteChat,
}: ChatActionsMenuContentProps) {
  return (
    <DropdownMenuContent
      align="end"
      className="w-48"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRenameChat(); }}>
        <Pencil className="h-3.5 w-3.5 mr-2" /> Rename chat
      </DropdownMenuItem>
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
        <FileText className="h-3.5 w-3.5 mr-2" /> Manage documents
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteChat(); }}>
        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete chat
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

interface NotebookActionsMenuContentProps {
  onManageNotebook: () => void;
  onManageDocuments: () => void;
  onShareNotebook?: () => void;
  onArchiveNotebook: () => void;
  onDeleteNotebook: () => void;
  shareDisabled?: boolean;
}

export function NotebookActionsMenuContent({
  onManageNotebook,
  onManageDocuments,
  onShareNotebook,
  onArchiveNotebook,
  onDeleteNotebook,
  shareDisabled = true,
}: NotebookActionsMenuContentProps) {
  return (
    <DropdownMenuContent
      align="end"
      className="w-48"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageNotebook(); }}>
        <Settings className="h-3.5 w-3.5 mr-2" /> Manage notebook
      </DropdownMenuItem>
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
        <FileText className="h-3.5 w-3.5 mr-2" /> Manage documents
      </DropdownMenuItem>
      <DropdownMenuItem disabled={shareDisabled} onClick={(e) => { e.stopPropagation(); onShareNotebook?.(); }}>
        <Share2 className="h-3.5 w-3.5 mr-2" /> Share notebook
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchiveNotebook(); }}>
        <Archive className="h-3.5 w-3.5 mr-2" /> Archive notebook
      </DropdownMenuItem>
      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteNotebook(); }}>
        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete notebook
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
