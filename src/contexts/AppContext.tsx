import React, { createContext, useContext, useState, ReactNode } from 'react';
import { 
  Project, 
  Chat, 
  currentUser, 
  mockProjects, 
  sharedProjects, 
  mockNotifications,
  Notification,
  User
} from '@/data/mockData';

interface AppContextType {
  // User
  user: User;
  
  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  
  // Projects
  projects: Project[];
  sharedWithMeProjects: Project[];
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  
  // Chats
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat | null) => void;
  
  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  
  // Model
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  
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
  showShare: boolean;
  setShowShare: (show: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(mockProjects[0]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(mockProjects[0].chats[0] || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState('default');
  const [language, setLanguage] = useState<'en' | 'sr-lat'>('en');
  const [showSettings, setShowSettings] = useState<'project' | 'chat' | 'prompt' | null>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const unreadCount = mockNotifications.filter(n => !n.read).length;

  return (
    <AppContext.Provider
      value={{
        user: currentUser,
        sidebarCollapsed,
        setSidebarCollapsed,
        projects: mockProjects,
        sharedWithMeProjects: sharedProjects,
        selectedProject,
        setSelectedProject,
        selectedChat,
        setSelectedChat,
        searchQuery,
        setSearchQuery,
        selectedModel,
        setSelectedModel,
        language,
        setLanguage,
        notifications: mockNotifications,
        unreadCount,
        showSettings,
        setShowSettings,
        showDocuments,
        setShowDocuments,
        showShare,
        setShowShare,
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
