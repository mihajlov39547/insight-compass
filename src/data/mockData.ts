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

// Available AI model options reported by Lovable
export const modelOptions = [
  { id: 'google/gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite', description: '846 calls' },
  { id: 'google/gemini-3-flash-preview', name: 'gemini-3-flash-preview', description: '22 calls' },
  { id: 'openai/gpt-5-nano', name: 'gpt-5-nano', description: '7 calls' },
  { id: 'google/gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview', description: '2 calls' },
  { id: 'google/gemini-2.5-pro', name: 'gemini-2.5-pro', description: '2 calls' },
  { id: 'openai/gpt-5-mini', name: 'gpt-5-mini', description: '1 call' },
  { id: 'google/gemini-2.5-flash', name: 'gemini-2.5-flash', description: '1 call' },
];

export const DEFAULT_MODEL_ID = 'google/gemini-3-flash-preview';
