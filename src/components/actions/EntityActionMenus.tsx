import React from 'react';
import { Settings, FileText, Share2, Archive, Trash2, Pencil, BookOpen } from 'lucide-react';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { ItemPermissions } from '@/lib/permissions';

interface ProjectActionsMenuContentProps {
  onManageProject: () => void;
  onManageDocuments: () => void;
  onShareProject?: () => void;
  onArchiveProject: () => void;
  onDeleteProject: () => void;
  permissions?: ItemPermissions | null;
  /** @deprecated Use permissions instead */
  shareDisabled?: boolean;
}

export function ProjectActionsMenuContent({
  onManageProject,
  onManageDocuments,
  onShareProject,
  onArchiveProject,
  onDeleteProject,
  permissions,
  shareDisabled,
}: ProjectActionsMenuContentProps) {
  const canManage = permissions ? permissions.canRename : true;
  const canShare = permissions ? permissions.canManageSharing : !shareDisabled;
  const canArchive = permissions ? permissions.canArchive : true;
  const canDelete = permissions ? permissions.canDelete : true;
  const canViewDocs = permissions ? permissions.canViewDocuments : true;

  return (
    <DropdownMenuContent
      align="end"
      className="w-48"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {canManage && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageProject(); }}>
          <Settings className="h-3.5 w-3.5 mr-2" /> Manage project
        </DropdownMenuItem>
      )}
      {canViewDocs && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
          <FileText className="h-3.5 w-3.5 mr-2" /> {permissions?.canUploadDocuments ? 'Manage documents' : 'View documents'}
        </DropdownMenuItem>
      )}
      {canShare && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onShareProject?.(); }}>
          <Share2 className="h-3.5 w-3.5 mr-2" /> Share project
        </DropdownMenuItem>
      )}
      {(canArchive || canDelete) && <DropdownMenuSeparator />}
      {canArchive && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchiveProject(); }}>
          <Archive className="h-3.5 w-3.5 mr-2" /> Archive project
        </DropdownMenuItem>
      )}
      {canDelete && (
        <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteProject(); }}>
          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete project
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}

interface ChatActionsMenuContentProps {
  onRenameChat: () => void;
  onManageDocuments: () => void;
  onDeleteChat: () => void;
  permissions?: ItemPermissions | null;
}

export function ChatActionsMenuContent({
  onRenameChat,
  onManageDocuments,
  onDeleteChat,
  permissions,
}: ChatActionsMenuContentProps) {
  const canRename = permissions ? permissions.canRenameChats : true;
  const canDelete = permissions ? permissions.canDeleteChats : true;
  const canViewDocs = permissions ? permissions.canViewDocuments : true;

  return (
    <DropdownMenuContent
      align="end"
      className="w-48"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {canRename && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRenameChat(); }}>
          <Pencil className="h-3.5 w-3.5 mr-2" /> Rename chat
        </DropdownMenuItem>
      )}
      {canViewDocs && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
          <FileText className="h-3.5 w-3.5 mr-2" /> {permissions?.canUploadDocuments ? 'Manage documents' : 'View documents'}
        </DropdownMenuItem>
      )}
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteChat(); }}>
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete chat
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}

interface NotebookActionsMenuContentProps {
  onManageNotebook: () => void;
  onManageDocuments: () => void;
  onShareNotebook?: () => void;
  onArchiveNotebook: () => void;
  onDeleteNotebook: () => void;
  permissions?: ItemPermissions | null;
  /** @deprecated Use permissions instead */
  shareDisabled?: boolean;
}

export function NotebookActionsMenuContent({
  onManageNotebook,
  onManageDocuments,
  onShareNotebook,
  onArchiveNotebook,
  onDeleteNotebook,
  permissions,
  shareDisabled,
}: NotebookActionsMenuContentProps) {
  const canManage = permissions ? permissions.canRename : true;
  const canShare = permissions ? permissions.canManageSharing : !shareDisabled;
  const canArchive = permissions ? permissions.canArchive : true;
  const canDelete = permissions ? permissions.canDelete : true;
  const canViewDocs = permissions ? permissions.canViewDocuments : true;

  return (
    <DropdownMenuContent
      align="end"
      className="w-48"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {canManage && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageNotebook(); }}>
          <Settings className="h-3.5 w-3.5 mr-2" /> Manage notebook
        </DropdownMenuItem>
      )}
      {canViewDocs && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
          <FileText className="h-3.5 w-3.5 mr-2" /> {permissions?.canUploadDocuments ? 'Manage documents' : 'View documents'}
        </DropdownMenuItem>
      )}
      {canShare && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onShareNotebook?.(); }}>
          <Share2 className="h-3.5 w-3.5 mr-2" /> Share notebook
        </DropdownMenuItem>
      )}
      {(canArchive || canDelete) && <DropdownMenuSeparator />}
      {canArchive && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchiveNotebook(); }}>
          <Archive className="h-3.5 w-3.5 mr-2" /> Archive notebook
        </DropdownMenuItem>
      )}
      {canDelete && (
        <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteNotebook(); }}>
          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete notebook
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}
