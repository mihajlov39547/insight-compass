/**
 * RBAC Permission System for Projects and Notebooks
 * 
 * Role hierarchy: owner (4) > admin (3) > editor (2) > viewer (1)
 */

export type ItemRole = 'owner' | 'admin' | 'editor' | 'viewer';

const ROLE_LEVEL: Record<string, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

export function hasMinRole(userRole: ItemRole | null | undefined, minRole: ItemRole): boolean {
  if (!userRole) return false;
  return (ROLE_LEVEL[userRole] ?? 0) >= (ROLE_LEVEL[minRole] ?? 0);
}

export interface ItemPermissions {
  canView: boolean;
  canRename: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canManageSharing: boolean;
  canCreateChats: boolean;
  canRenameChats: boolean;
  canDeleteChats: boolean;
  canSendMessages: boolean;
  canUploadDocuments: boolean;
  canDeleteDocuments: boolean;
  canViewDocuments: boolean;
  canManageDocumentState: boolean;
  canCreateNotes: boolean;
  canEditNotes: boolean;
  canDeleteNotes: boolean;
  isOwner: boolean;
  role: ItemRole | null;
}

export function getItemPermissions(role: ItemRole | null | undefined): ItemPermissions {
  const r = role ?? null;
  return {
    canView: hasMinRole(r, 'viewer'),
    canRename: hasMinRole(r, 'admin'),
    canArchive: r === 'owner',
    canDelete: r === 'owner',
    canManageSharing: hasMinRole(r, 'admin'),
    canCreateChats: hasMinRole(r, 'editor'),
    canRenameChats: hasMinRole(r, 'admin'),
    canDeleteChats: hasMinRole(r, 'admin'),
    canSendMessages: hasMinRole(r, 'viewer'),
    canUploadDocuments: hasMinRole(r, 'editor'),
    canDeleteDocuments: hasMinRole(r, 'editor'),
    canViewDocuments: hasMinRole(r, 'viewer'),
    canManageDocumentState: hasMinRole(r, 'editor'),
    canCreateNotes: hasMinRole(r, 'editor'),
    canEditNotes: hasMinRole(r, 'editor'),
    canDeleteNotes: hasMinRole(r, 'editor'),
    isOwner: r === 'owner',
    role: r,
  };
}

export function getRoleLabel(role: ItemRole | null | undefined): string {
  switch (role) {
    case 'owner': return 'Owner';
    case 'admin': return 'Admin';
    case 'editor': return 'Editor';
    case 'viewer': return 'Viewer';
    default: return 'No access';
  }
}

export function getRoleBadgeVariant(role: ItemRole | null | undefined): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (role) {
    case 'owner': return 'default';
    case 'admin': return 'default';
    case 'editor': return 'secondary';
    case 'viewer': return 'outline';
    default: return 'outline';
  }
}
