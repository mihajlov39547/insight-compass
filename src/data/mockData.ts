export type Plan = 'free' | 'basic' | 'premium' | 'enterprise';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  initials: string;
  plan: Plan;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any;
  timestamp: string;
  modelId?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

// Default user (plan info only - real identity comes from auth)
export const currentUser: User = {
  id: 'user-1',
  name: '',
  email: '',
  initials: '',
  plan: 'free',
};

// Mock notifications
export const mockNotifications: Notification[] = [
  {
    id: 'notif-1',
    title: 'New Feature: Multi-language Support',
    message: 'You can now set language preferences at both project and chat levels.',
    read: false,
    createdAt: '2024-01-15T08:00:00Z',
  },
  {
    id: 'notif-2',
    title: 'Project Shared',
    message: 'Dr. Sarah Miller shared "Medical Research Synthesis" with you.',
    read: true,
    createdAt: '2024-01-11T10:00:00Z',
  },
  {
    id: 'notif-3',
    title: 'System Update',
    message: 'Response accuracy improved by 15% with the latest model update.',
    read: true,
    createdAt: '2024-01-10T12:00:00Z',
  },
];
