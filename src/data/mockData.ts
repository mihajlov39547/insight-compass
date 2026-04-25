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

// Default user (plan info only - real identity comes from auth)
export const currentUser: User = {
  id: 'user-1',
  name: '',
  email: '',
  initials: '',
  plan: 'free',
};
