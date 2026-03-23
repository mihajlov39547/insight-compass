import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import {
  Plan,
  currentUser,
  mockNotifications,
  Notification,
  User,
  Document
} from '@/data/mockData';
import { DbProject } from '@/hooks/useProjects';
import { DbChat } from '@/hooks/useChats';

export type ActiveView = 'default' | 'project-documents' | 'chat-documents' | 'notebooks';

interface AppContextType {
  // User
  user: User;
  setUserPlan: (plan: Plan) => void;
  
  // Onboarding
  isFirstTimeUser: boolean;
  setIsFirstTimeUser: (value: boolean) => void;
  
  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  
  // Projects (now IDs for selection, data from hooks)
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  
  // Chats
  selectedChatId: string | null;
  setSelectedChatId: (id: string | null) => void;

  // Notebooks
  selectedNotebookId: string | null;
  setSelectedNotebookId: (id: string | null) => void;

  // Active view
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  
  // Language
  language: 'en' | 'sr-lat';
  setLanguage: (lang: 'en' | 'sr-lat') => void;
  
  // Notifications
  notifications: Notification[];
  unreadCount: number;
  
  // Dialogs
  showSettings: 'project' | 'chat' | 'prompt' | null;
  setShowSettings: (type: 'project' | 'chat' | 'prompt' | null) => void;
  showDocuments: boolean;
  setShowDocuments: (show: boolean) => void;
  documentScope: 'project' | 'chat';
  setDocumentScope: (scope: 'project' | 'chat') => void;
  showShare: boolean;
  setShowShare: (show: boolean) => void;
  showNewProject: boolean;
  setShowNewProject: (show: boolean) => void;
  showPricing: boolean;
  setShowPricing: (show: boolean) => void;
  showNotifications: boolean;
  setShowNotifications: (show: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(currentUser);
  const [isFirstTimeUser, setIsFirstTimeUser] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedProjectId, setSelectedProjectIdRaw] = useState<string | null>(null);
  const [selectedChatId, setSelectedChatIdRaw] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('default');
  const [searchQuery, setSearchQuery] = useState('');
  const [language, setLanguage] = useState<'en' | 'sr-lat'>('en');
  const [showSettings, setShowSettings] = useState<'project' | 'chat' | 'prompt' | null>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [documentScope, setDocumentScope] = useState<'project' | 'chat'>('project');
  const [showShare, setShowShare] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const unreadCount = mockNotifications.filter(n => !n.read).length;

  const setUserPlan = useCallback((plan: Plan) => {
    setUser(prev => ({ ...prev, plan }));
  }, []);

  // Reset activeView when changing project/chat selection (unless explicitly setting view)
  const setSelectedProjectId = useCallback((id: string | null) => {
    setSelectedProjectIdRaw(id);
    // Don't reset activeView here — let callers manage it explicitly
  }, []);

  const setSelectedChatId = useCallback((id: string | null) => {
    setSelectedChatIdRaw(id);
  }, []);

  const setSelectedNotebookId = useCallback((id: string | null) => {
    setSelectedNotebookIdRaw(id);
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        setUserPlan,
        isFirstTimeUser,
        setIsFirstTimeUser,
        sidebarCollapsed,
        setSidebarCollapsed,
        selectedProjectId,
        setSelectedProjectId,
        selectedChatId,
        setSelectedChatId,
        activeView,
        setActiveView,
        searchQuery,
        setSearchQuery,
        language,
        setLanguage,
        notifications: mockNotifications,
        unreadCount,
        showSettings,
        setShowSettings,
        showDocuments,
        setShowDocuments,
        documentScope,
        setDocumentScope,
        showShare,
        setShowShare,
        showNewProject,
        setShowNewProject,
        showPricing,
        setShowPricing,
        showNotifications,
        setShowNotifications,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
