import React from 'react';
import { AppProvider } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
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
import { ProjectsLanding } from '@/components/projects/ProjectsLanding';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useApp } from '@/contexts/AppContext';
import { useCreateProject } from '@/hooks/useProjects';

function MainContent() {
  const { activeView } = useApp();

  if (activeView === 'projects') {
    return <ProjectsLanding />;
  }
  if (activeView === 'project-documents') {
    return <DocumentDashboard scope="project" />;
  }
  if (activeView === 'chat-documents') {
    return <DocumentDashboard scope="chat" />;
  }
  if (activeView === 'notebooks') {
    return <NotebooksLanding />;
  }
  if (activeView === 'notebook-documents') {
    return <NotebookDocumentDashboard />;
  }

  return (
    <>
      <ContextualHeader />
      <ChatWorkspace />
    </>
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
  const createProject = useCreateProject();
  const currentPlan = (profile?.plan || 'free') as import('@/data/mockData').Plan;

  const handleCreateProject = async (name: string, description: string, language: 'en' | 'sr-lat') => {
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
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <MainHeader />
            <MainContent />
          </div>
        </>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
            <AppSidebar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={80}>
            <div className="flex-1 flex flex-col min-w-0 h-full">
              <MainHeader />
              <MainContent />
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
