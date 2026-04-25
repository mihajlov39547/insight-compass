export interface ChatDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any;
  timestamp: string;
  modelId?: string;
}
