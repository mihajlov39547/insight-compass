import React from 'react';
import { Settings, FileText, Share2, Archive, Trash2, Pencil, BookOpen } from 'lucide-react';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const canManage = permissions ? permissions.canRename : false;
  const canShare = !!onShareProject && (permissions ? permissions.canManageSharing : !shareDisabled);
  const canArchive = permissions ? permissions.canArchive : false;
  const canDelete = permissions ? permissions.canDelete : false;
  const canViewDocs = permissions ? permissions.canViewDocuments : false;

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
          <Settings className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.manageProject')}
        </DropdownMenuItem>
      )}
      {canViewDocs && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
          <FileText className="h-3.5 w-3.5 mr-2" /> {permissions?.canUploadDocuments ? t('actionsMenu.manageDocuments') : t('actionsMenu.viewDocuments')}
        </DropdownMenuItem>
      )}
      {canShare && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onShareProject?.(); }}>
          <Share2 className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.shareProject')}
        </DropdownMenuItem>
      )}
      {(canArchive || canDelete) && <DropdownMenuSeparator />}
      {canArchive && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchiveProject(); }}>
          <Archive className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.archiveProject')}
        </DropdownMenuItem>
      )}
      {canDelete && (
        <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteProject(); }}>
          <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.deleteProject')}
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
  const { t } = useTranslation();
  const canRename = permissions ? permissions.canRenameChats : false;
  const canDelete = permissions ? permissions.canDeleteChats : false;
  const canViewDocs = permissions ? permissions.canViewDocuments : false;

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
          <Pencil className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.renameChat')}
        </DropdownMenuItem>
      )}
      {canViewDocs && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
          <FileText className="h-3.5 w-3.5 mr-2" /> {permissions?.canUploadDocuments ? t('actionsMenu.manageDocuments') : t('actionsMenu.viewDocuments')}
        </DropdownMenuItem>
      )}
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteChat(); }}>
            <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.deleteChat')}
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
  const { t } = useTranslation();
  const canManage = permissions ? permissions.canRename : false;
  const canShare = !!onShareNotebook && (permissions ? permissions.canManageSharing : !shareDisabled);
  const canArchive = permissions ? permissions.canArchive : false;
  const canDelete = permissions ? permissions.canDelete : false;
  const canViewDocs = permissions ? permissions.canViewDocuments : false;

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
          <Settings className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.manageNotebook')}
        </DropdownMenuItem>
      )}
      {canViewDocs && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageDocuments(); }}>
          <FileText className="h-3.5 w-3.5 mr-2" /> {permissions?.canUploadDocuments ? t('actionsMenu.manageDocuments') : t('actionsMenu.viewDocuments')}
        </DropdownMenuItem>
      )}
      {canShare && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onShareNotebook?.(); }}>
          <Share2 className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.shareNotebook')}
        </DropdownMenuItem>
      )}
      {(canArchive || canDelete) && <DropdownMenuSeparator />}
      {canArchive && (
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchiveNotebook(); }}>
          <Archive className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.archiveNotebook')}
        </DropdownMenuItem>
      )}
      {canDelete && (
        <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteNotebook(); }}>
          <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('actionsMenu.deleteNotebook')}
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}
