import React from 'react';
import { AppProvider } from '@/contexts/AppContext';
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
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useApp } from '@/contexts/AppContext';

function AppContent() {
  const { 
    showNewProject, 
    setShowNewProject, 
    addProject,
    showPricing,
    setShowPricing,
    showNotifications,
    setShowNotifications,
    user,
    setUserPlan,
    isFirstTimeUser,
    setIsFirstTimeUser,
    projects,
    sidebarCollapsed
  } = useApp();

  const showOnboarding = isFirstTimeUser || projects.length === 0;

  const handleStartFree = () => {
    setIsFirstTimeUser(false);
    setShowNewProject(true);
  };

  const handleViewPricing = () => {
    setShowPricing(true);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {showOnboarding ? (
        <>
          {sidebarCollapsed === false && (
            <div className="w-16 border-r border-border bg-sidebar flex flex-col items-center py-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-bold text-sm">IN</span>
              </div>
            </div>
          )}
          <div className="flex-1 flex flex-col min-w-0">
            <MainHeader minimal />
            <OnboardingScreen 
              onStartFree={handleStartFree}
              onViewPricing={handleViewPricing}
            />
          </div>
        </>
      ) : sidebarCollapsed ? (
        <>
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <MainHeader />
            <ContextualHeader />
            <ChatWorkspace />
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
              <ContextualHeader />
              <ChatWorkspace />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Dialogs */}
      <SettingsDialog />
      <DocumentsDialog />
      <ShareDialog />
      <NewProjectDialog 
        open={showNewProject} 
        onOpenChange={setShowNewProject}
        onCreateProject={addProject}
      />
      <PricingDialog
        open={showPricing}
        onOpenChange={setShowPricing}
        currentPlan={user.plan}
        onSelectPlan={setUserPlan}
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
