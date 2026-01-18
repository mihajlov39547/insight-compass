import React, { createContext, useContext, useState, ReactNode } from 'react';
import {
  Project,
  Chat,
  currentUser,
  mockProjects,
  sharedProjects,
  mockNotifications,
  Notification,
  User,
  Plan,
  Document
} from '@/data/mockData';

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
  
  // Projects
  projects: Project[];
  sharedWithMeProjects: Project[];
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  addProject: (name: string, description: string, language: 'en' | 'sr-lat') => void;
  
  // Chats
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat | null) => void;
  addChat: (projectId: string) => void;

  // Documents
  addDocuments: (documents: Document[], context: 'project' | 'chat' | 'all') => void;

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
  showNewProject: boolean;
  setShowNewProject: (show: boolean) => void;
  showPricing: boolean;
  setShowPricing: (show: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(currentUser);
  const [isFirstTimeUser, setIsFirstTimeUser] = useState(false); // Set to true to demo onboarding
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projects, setProjects] = useState<Project[]>(mockProjects);
  const [selectedProject, setSelectedProject] = useState<Project | null>(mockProjects[0]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(mockProjects[0].chats[0] || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState('default');
  const [language, setLanguage] = useState<'en' | 'sr-lat'>('en');
  const [showSettings, setShowSettings] = useState<'project' | 'chat' | 'prompt' | null>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  const unreadCount = mockNotifications.filter(n => !n.read).length;

  const setUserPlan = (plan: Plan) => {
    setUser(prev => ({ ...prev, plan }));
  };

  const addProject = (name: string, description: string, projectLanguage: 'en' | 'sr-lat') => {
    const now = new Date().toISOString();
    const newProject: Project = {
      id: `proj-${Date.now()}`,
      name,
      description: description || 'No description provided.',
      ownerId: currentUser.id,
      sharedWith: [],
      chats: [],
      documents: [],
      language: projectLanguage,
      createdAt: now,
      updatedAt: now,
    };
    
    setProjects(prev => [newProject, ...prev]);
    setSelectedProject(newProject);
    setSelectedChat(null);
  };

  const addChat = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const now = new Date().toISOString();
    const chatNumber = project.chats.length + 1;

    const newChat: Chat = {
      id: `chat-${Date.now()}`,
      name: `New Chat ${chatNumber}`,
      projectId,
      messages: [
        {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: 'Welcome! You can start asking questions about your documents. Upload files to enhance the knowledge base for this chat.',
          timestamp: now,
        }
      ],
      documents: [],
      language: project.language,
      createdAt: now,
      updatedAt: now,
    };

    const updatedProjects = projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          chats: [...p.chats, newChat],
          updatedAt: now,
        };
      }
      return p;
    });

    setProjects(updatedProjects);

    const updatedProject = updatedProjects.find(p => p.id === projectId);
    if (updatedProject) {
      setSelectedProject(updatedProject);
      setSelectedChat(newChat);
    }
  };

  const addDocuments = (documents: Document[], context: 'project' | 'chat' | 'all') => {
    const now = new Date().toISOString();

    if (context === 'chat' && selectedChat && selectedProject) {
      const updatedProjects = projects.map(p => {
        if (p.id === selectedProject.id) {
          return {
            ...p,
            chats: p.chats.map(c => {
              if (c.id === selectedChat.id) {
                return {
                  ...c,
                  documents: [...c.documents, ...documents],
                  updatedAt: now,
                };
              }
              return c;
            }),
            updatedAt: now,
          };
        }
        return p;
      });

      setProjects(updatedProjects);

      const updatedProject = updatedProjects.find(p => p.id === selectedProject.id);
      if (updatedProject) {
        setSelectedProject(updatedProject);
        const updatedChat = updatedProject.chats.find(c => c.id === selectedChat.id);
        if (updatedChat) {
          setSelectedChat(updatedChat);
        }
      }
    } else if (context === 'project' && selectedProject) {
      const updatedProjects = projects.map(p => {
        if (p.id === selectedProject.id) {
          return {
            ...p,
            documents: [...p.documents, ...documents],
            updatedAt: now,
          };
        }
        return p;
      });

      setProjects(updatedProjects);

      const updatedProject = updatedProjects.find(p => p.id === selectedProject.id);
      if (updatedProject) {
        setSelectedProject(updatedProject);
      }
    }
  };

  return (
    <AppContext.Provider
      value={{
        user,
        setUserPlan,
        isFirstTimeUser,
        setIsFirstTimeUser,
        sidebarCollapsed,
        setSidebarCollapsed,
        projects,
        sharedWithMeProjects: sharedProjects,
        selectedProject,
        setSelectedProject,
        addProject,
        selectedChat,
        setSelectedChat,
        addChat,
        addDocuments,
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
        showNewProject,
        setShowNewProject,
        showPricing,
        setShowPricing,
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
