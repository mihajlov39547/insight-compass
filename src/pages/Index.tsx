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
import { useApp } from '@/contexts/AppContext';

function AppContent() {
  const { 
    showNewProject, 
    setShowNewProject, 
    addProject,
    showPricing,
    setShowPricing,
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
      {/* Sidebar - simplified in onboarding mode */}
      {!showOnboarding && <AppSidebar />}
      {showOnboarding && sidebarCollapsed === false && (
        <div className="w-16 border-r border-border bg-sidebar flex flex-col items-center py-4">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-primary font-bold text-sm">IN</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Main Header */}
        <MainHeader minimal={showOnboarding} />

        {showOnboarding ? (
          <OnboardingScreen 
            onStartFree={handleStartFree}
            onViewPricing={handleViewPricing}
          />
        ) : (
          <>
            {/* Contextual Header */}
            <ContextualHeader />

            {/* Chat Workspace */}
            <ChatWorkspace />
          </>
        )}
      </div>

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
