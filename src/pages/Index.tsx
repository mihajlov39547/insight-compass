import React from 'react';
import { AppProvider } from '@/contexts/AppContext';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { MainHeader } from '@/components/layout/MainHeader';
import { ContextualHeader } from '@/components/layout/ContextualHeader';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { SettingsDialog } from '@/components/dialogs/SettingsDialog';
import { DocumentsDialog } from '@/components/dialogs/DocumentsDialog';
import { ShareDialog } from '@/components/dialogs/ShareDialog';

const Index = () => {
  return (
    <AppProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {/* Sidebar */}
        <AppSidebar />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Main Header */}
          <MainHeader />

          {/* Contextual Header */}
          <ContextualHeader />

          {/* Chat Workspace */}
          <ChatWorkspace />
        </div>

        {/* Dialogs */}
        <SettingsDialog />
        <DocumentsDialog />
        <ShareDialog />
      </div>
    </AppProvider>
  );
};

export default Index;
