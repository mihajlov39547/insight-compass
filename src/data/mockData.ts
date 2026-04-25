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
    id: 'notif-web-search',
    title: "What's new: Web Search",
    message:
      'Ground answers in fresh information from across the web. Toggle Web Search in the chat input to let the assistant fetch live results, cite sources inline, and blend them with your project documents for up-to-date, verifiable responses.',
    read: false,
    createdAt: '2024-01-20T09:00:00Z',
  },
  {
    id: 'notif-research',
    title: "What's new: Deep Research",
    message:
      'Tackle complex questions with the new Research mode. The assistant plans a multi-step investigation, runs parallel web searches, follows up on the strongest leads, and returns a structured synthesis with a transparent trace of every source consulted.',
    read: false,
    createdAt: '2024-01-18T09:00:00Z',
  },
  {
    id: 'notif-youtube-search',
    title: "What's new: YouTube Search",
    message:
      'Bring video knowledge into your chats. Search YouTube directly from the assistant, preview matching videos, and link them as sources — transcripts are fetched and indexed automatically so you can ask questions grounded in the spoken content.',
    read: false,
    createdAt: '2024-01-16T09:00:00Z',
  },
  {
    id: 'notif-notebooks-in-prompt',
    title: "What's new: Notebooks as Context",
    message:
      'Reference an entire notebook in any prompt. Pick a notebook from the chat input and the assistant will use its sources, notes, and extracted text as grounded context — perfect for reusing curated research across multiple conversations.',
    read: false,
    createdAt: '2024-01-14T09:00:00Z',
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

