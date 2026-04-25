import React from 'react';
import { 
  FolderOpen
} from 'lucide-react';
import { InlineRenameTitle } from '@/components/shared/InlineRenameTitle';
import { useApp } from '@/contexts/useApp';
import { useProjects, useUpdateProject } from '@/hooks/useProjects';
import { WorkspaceContextHeader } from '@/components/layout/WorkspaceContextHeader';
import { useItemRole } from '@/hooks/useItemRole';
import { getItemPermissions } from '@/lib/permissions';
import { toast } from 'sonner';

export function ContextualHeader() {
  const { selectedProjectId } = useApp();
  const { data: projects = [] } = useProjects();
  const updateProject = useUpdateProject();
  const { data: myRole } = useItemRole(selectedProjectId, 'project');
  const permissions = getItemPermissions(myRole);
  
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  if (!selectedProject) {
    return (
      <div className="h-12 bg-muted/30 border-b border-border flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Select a project to get started</p>
      </div>
    );
  }

  return (
    <WorkspaceContextHeader
      title={(
        <span className="inline-flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-accent" />
          {permissions.canRename ? (
            <InlineRenameTitle
              value={selectedProject.name}
              onSave={async (name) => {
                await updateProject.mutateAsync({ id: selectedProject.id, name });
                toast.success('Project renamed');
              }}
              className="text-lg font-semibold text-foreground"
            />
          ) : (
            <span className="text-lg font-semibold text-foreground">{selectedProject.name}</span>
          )}
        </span>
      )}
      subtitle={selectedProject.description}
      language={selectedProject.language}
      showShare={permissions.canManageSharing}
    />
  );
}
