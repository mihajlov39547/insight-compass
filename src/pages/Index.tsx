import React from 'react';
import { useTranslation } from 'react-i18next';
import { AppProvider } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/useAuth';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { MainHeader } from '@/components/layout/MainHeader';
import { ContextualHeader } from '@/components/layout/ContextualHeader';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { SettingsDialog } from '@/components/dialogs/SettingsDialog';
import { DocumentsDialog } from '@/components/dialogs/DocumentsDialog';
import { ShareDialog } from '@/components/dialogs/ShareDialog';
import { NewProjectDialog } from '@/components/dialogs/NewProjectDialog';
import { PricingDialog } from '@/components/dialogs/PricingDialog';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { NotificationPanel } from '@/components/notifications/NotificationPanel';
import { DocumentDashboard } from '@/components/documents/DocumentDashboard';
import { NotebookDocumentDashboard } from '@/components/documents/NotebookDocumentDashboard';
import { NotebooksLanding } from '@/components/notebooks/NotebooksLanding';
import { NotebookWorkspace } from '@/components/notebooks/NotebookWorkspace';
import { ProjectsLanding } from '@/components/projects/ProjectsLanding';
import { HomeLanding } from '@/components/views/HomeLanding';
import { ResourcesLanding } from '@/components/views/ResourcesLanding';
import { StarredLanding } from '@/components/views/StarredLanding';
import { RecentsLanding } from '@/components/views/RecentsLanding';
import { SharedLanding } from '@/components/views/SharedLanding';
import { SearchDashboard } from '@/components/views/SearchDashboard';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useApp } from '@/contexts/useApp';
import { useCreateProject } from '@/hooks/useProjects';
import { DEFAULT_LANGUAGE, type AvailableLanguageCode } from '@/lib/languages';
import { normalizePlan } from '@/types/app';

function MainContent() {
  const { activeView } = useApp();

  if (activeView === 'home') return <HomeLanding />;
  if (activeView === 'projects') return <ProjectsLanding />;
  if (activeView === 'project-documents') return <DocumentDashboard scope="project" />;
  if (activeView === 'chat-documents') return <DocumentDashboard scope="chat" />;
  if (activeView === 'notebooks') return <NotebooksLanding />;
  if (activeView === 'notebook-documents') return <NotebookDocumentDashboard />;
  if (activeView === 'notebook-workspace') return <NotebookWorkspace />;
  if (activeView === 'resources') return <ResourcesLanding />;
  if (activeView === 'starred') return <StarredLanding />;
  if (activeView === 'recents') return <RecentsLanding />;
  if (activeView === 'shared') return <SharedLanding />;
  if (activeView === 'search') return <SearchDashboard />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ContextualHeader />
      <ChatWorkspace />
    </div>
  );
}

function AppContent() {
  const { 
    showNewProject, 
    setShowNewProject, 
    showPricing,
    setShowPricing,
    showNotifications,
    setShowNotifications,
    setUserPlan,
    sidebarCollapsed
  } = useApp();

  const { user: authUser, profile, loading } = useAuth();
  const { i18n } = useTranslation();
  const createProject = useCreateProject();
  const currentPlan = normalizePlan(profile?.plan);
  const sidebarLanguageKey = i18n.resolvedLanguage || i18n.language || DEFAULT_LANGUAGE;

  const handleCreateProject = async (name: string, description: string, language: AvailableLanguageCode) => {
    createProject.mutate({ name, description, language });
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <div className="flex-1 flex flex-col min-w-0">
          <MainHeader minimal />
          <OnboardingScreen 
            onStartFree={() => {}} 
            onViewPricing={() => setShowPricing(true)}
          />
        </div>
        <PricingDialog
          open={showPricing}
          onOpenChange={setShowPricing}
          currentPlan={currentPlan}
          onSelectPlan={setUserPlan}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {sidebarCollapsed ? (
        <>
          <AppSidebar key={`sidebar-${sidebarLanguageKey}`} />
          <div className="flex-1 flex flex-col min-w-0">
            <MainHeader />
            <div className="flex-1 min-h-0 h-full flex flex-col">
              <MainContent />
            </div>
          </div>
        </>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
            <AppSidebar key={`sidebar-${sidebarLanguageKey}`} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={80}>
            <div className="flex-1 flex flex-col min-w-0 h-full">
              <MainHeader />
              <div className="flex-1 min-h-0 h-full flex flex-col">
                <MainContent />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <SettingsDialog />
      <DocumentsDialog />
      <ShareDialog />
      <NewProjectDialog 
        open={showNewProject} 
        onOpenChange={setShowNewProject}
        onCreateProject={handleCreateProject}
      />
      <PricingDialog
        open={showPricing}
        onOpenChange={setShowPricing}
        currentPlan={currentPlan}
        onSelectPlan={setUserPlan}
      />
      <NotificationPanel
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
      />
    </div>
  );
}

const Index = () => {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default Index;
