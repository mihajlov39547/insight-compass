export type Plan = 'free' | 'basic' | 'premium' | 'enterprise';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  initials: string;
  plan: Plan;
}

export interface Document {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'txt' | 'xlsx';
  size: string;
  uploadedAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; snippet: string; relevance: number }[];
  timestamp: string;
}

export interface Chat {
  id: string;
  name: string;
  projectId: string;
  messages: Message[];
  documents: Document[];
  language: 'en' | 'sr-lat';
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  sharedWith: string[];
  chats: Chat[];
  documents: Document[];
  language: 'en' | 'sr-lat';
  isShared?: boolean;
  sharedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

// Mock current user
export const currentUser: User = {
  id: 'user-1',
  name: 'Alex Chen',
  email: 'alex.chen@company.com',
  initials: 'AC',
  plan: 'premium',
};

// Mock documents
export const mockDocuments: Document[] = [
  { id: 'doc-1', name: 'Research_Paper_2024.pdf', type: 'pdf', size: '2.4 MB', uploadedAt: '2024-01-15' },
  { id: 'doc-2', name: 'Technical_Specifications.docx', type: 'docx', size: '856 KB', uploadedAt: '2024-01-14' },
  { id: 'doc-3', name: 'Data_Analysis_Notes.txt', type: 'txt', size: '124 KB', uploadedAt: '2024-01-13' },
  { id: 'doc-4', name: 'Quarterly_Report.xlsx', type: 'xlsx', size: '1.2 MB', uploadedAt: '2024-01-12' },
  { id: 'doc-5', name: 'API_Documentation.pdf', type: 'pdf', size: '3.1 MB', uploadedAt: '2024-01-11' },
];

// Mock messages
const ragResponse1: Message = {
  id: 'msg-2',
  role: 'assistant',
  content: `Based on the documents in your knowledge base, I found several relevant insights about multimodal RAG systems:

**Key Findings:**

1. **Enhanced Semantic Search**: Multimodal RAG combines text, image, and structured data retrieval to provide more comprehensive answers. The framework achieves a 34% improvement in response accuracy compared to text-only approaches.

2. **Cross-Modal Attention**: The architecture uses cross-modal attention mechanisms to align information across different modalities, enabling more nuanced understanding of complex queries.

3. **Source Attribution**: Each response includes traceable source citations, improving transparency and allowing users to verify information against original documents.

The implementation details are described in Section 3.2 of your uploaded research paper.`,
  sources: [
    { title: 'Research_Paper_2024.pdf', snippet: 'Section 3.2: Multimodal Fusion Architecture...', relevance: 0.94 },
    { title: 'Technical_Specifications.docx', snippet: 'Cross-modal attention implementation...', relevance: 0.87 },
  ],
  timestamp: '2024-01-15T10:32:00Z',
};

const ragResponse2: Message = {
  id: 'msg-4',
  role: 'assistant',
  content: `I've analyzed your quarterly report and data analysis notes. Here's a summary of the key performance metrics:

**Performance Overview:**

| Metric | Q4 2023 | Q1 2024 | Change |
|--------|---------|---------|--------|
| Query Accuracy | 78.3% | 89.7% | +11.4% |
| Response Time | 2.3s | 1.1s | -52% |
| User Satisfaction | 4.2/5 | 4.7/5 | +12% |

**Notable Improvements:**
- The new retrieval pipeline reduced latency significantly
- Enhanced embedding models improved semantic matching
- Multi-hop reasoning capabilities were added in January

Would you like me to dive deeper into any specific metric?`,
  sources: [
    { title: 'Quarterly_Report.xlsx', snippet: 'Performance metrics dashboard...', relevance: 0.96 },
    { title: 'Data_Analysis_Notes.txt', snippet: 'January improvements summary...', relevance: 0.82 },
  ],
  timestamp: '2024-01-15T11:15:00Z',
};

// Mock chats
export const mockChats: Chat[] = [
  {
    id: 'chat-1',
    name: 'RAG Architecture Discussion',
    projectId: 'proj-1',
    messages: [
      { id: 'msg-1', role: 'user', content: 'Can you explain how multimodal RAG systems work based on our research documents?', timestamp: '2024-01-15T10:30:00Z' },
      ragResponse1,
    ],
    documents: [mockDocuments[0], mockDocuments[1]],
    language: 'en',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:32:00Z',
  },
  {
    id: 'chat-2',
    name: 'Performance Metrics Analysis',
    projectId: 'proj-1',
    messages: [
      { id: 'msg-3', role: 'user', content: 'What are the key performance improvements shown in our latest reports?', timestamp: '2024-01-15T11:00:00Z' },
      ragResponse2,
    ],
    documents: [mockDocuments[3], mockDocuments[2]],
    language: 'en',
    createdAt: '2024-01-15T11:00:00Z',
    updatedAt: '2024-01-15T11:15:00Z',
  },
  {
    id: 'chat-3',
    name: 'API Integration Planning',
    projectId: 'proj-1',
    messages: [
      { id: 'msg-5', role: 'user', content: 'How should we structure the API endpoints for the RAG service?', timestamp: '2024-01-14T09:00:00Z' },
      {
        id: 'msg-6',
        role: 'assistant',
        content: 'Based on the API documentation, I recommend a RESTful structure with the following endpoints:\n\n- `POST /api/v1/query` - Submit queries\n- `GET /api/v1/sources` - Retrieve source documents\n- `POST /api/v1/upload` - Upload new documents\n\nShall I elaborate on the request/response schemas?',
        sources: [{ title: 'API_Documentation.pdf', snippet: 'Endpoint specifications...', relevance: 0.91 }],
        timestamp: '2024-01-14T09:05:00Z',
      },
    ],
    documents: [mockDocuments[4]],
    language: 'en',
    createdAt: '2024-01-14T09:00:00Z',
    updatedAt: '2024-01-14T09:05:00Z',
  },
];

// Mock projects
export const mockProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'Multimodal RAG Research',
    description: 'Research and development of multimodal retrieval-augmented generation systems for enterprise knowledge management.',
    ownerId: 'user-1',
    sharedWith: ['user-2', 'user-3'],
    chats: mockChats.filter(c => c.projectId === 'proj-1'),
    documents: mockDocuments.slice(0, 3),
    language: 'en',
    createdAt: '2024-01-10T08:00:00Z',
    updatedAt: '2024-01-15T11:15:00Z',
  },
  {
    id: 'proj-2',
    name: 'Customer Support KB',
    description: 'Knowledge base for customer support automation using semantic search and intelligent routing.',
    ownerId: 'user-1',
    sharedWith: [],
    chats: [
      {
        id: 'chat-4',
        name: 'FAQ Optimization',
        projectId: 'proj-2',
        messages: [],
        documents: [],
        language: 'en',
        createdAt: '2024-01-12T14:00:00Z',
        updatedAt: '2024-01-12T14:00:00Z',
      },
    ],
    documents: mockDocuments.slice(3, 5),
    language: 'en',
    createdAt: '2024-01-08T10:00:00Z',
    updatedAt: '2024-01-12T14:00:00Z',
  },
  {
    id: 'proj-3',
    name: 'Legal Document Analysis',
    description: 'Automated analysis of legal contracts and compliance documents.',
    ownerId: 'user-1',
    sharedWith: ['user-4'],
    chats: [],
    documents: [],
    language: 'en',
    createdAt: '2024-01-05T09:00:00Z',
    updatedAt: '2024-01-05T09:00:00Z',
  },
];

// Shared projects (from other users)
export const sharedProjects: Project[] = [
  {
    id: 'proj-shared-1',
    name: 'Medical Research Synthesis',
    description: 'Collaborative research synthesis for clinical trial documentation.',
    ownerId: 'user-5',
    sharedWith: ['user-1'],
    chats: [
      {
        id: 'chat-shared-1',
        name: 'Literature Review',
        projectId: 'proj-shared-1',
        messages: [],
        documents: [],
        language: 'en',
        createdAt: '2024-01-11T10:00:00Z',
        updatedAt: '2024-01-11T10:00:00Z',
      },
    ],
    documents: [],
    language: 'en',
    isShared: true,
    sharedBy: 'Dr. Sarah Miller',
    createdAt: '2024-01-11T10:00:00Z',
    updatedAt: '2024-01-11T10:00:00Z',
  },
  {
    id: 'proj-shared-2',
    name: 'Financial Analysis Hub',
    description: 'Market analysis and financial reporting knowledge base.',
    ownerId: 'user-6',
    sharedWith: ['user-1'],
    chats: [],
    documents: [],
    language: 'en',
    isShared: true,
    sharedBy: 'James Wilson',
    createdAt: '2024-01-09T08:00:00Z',
    updatedAt: '2024-01-09T08:00:00Z',
  },
];

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

// Model options
export const modelOptions = [
  { id: 'default', name: 'Default RAG Model', description: 'Balanced performance and accuracy' },
  { id: 'fast', name: 'Fast Model', description: 'Optimized for quick responses' },
  { id: 'advanced', name: 'Advanced Model', description: 'Maximum accuracy with detailed analysis' },
];

// Settings configurations
export const settingsConfig = {
  project: {
    responseLength: { label: 'Default Response Length', options: ['Concise', 'Standard', 'Detailed'] },
    retrievalDepth: { label: 'Retrieval Depth', options: ['Shallow', 'Medium', 'Deep'] },
    citeSources: { label: 'Cite Sources', type: 'toggle' },
    autoSummarize: { label: 'Auto-summarize Documents', type: 'toggle' },
  },
  chat: {
    temperature: { label: 'Response Creativity', options: ['Precise', 'Balanced', 'Creative'] },
    maxSources: { label: 'Max Sources per Response', options: ['3', '5', '10', 'Unlimited'] },
    streamResponse: { label: 'Stream Responses', type: 'toggle' },
  },
  prompt: {
    systemPrompt: { label: 'System Prompt', type: 'textarea' },
    outputFormat: { label: 'Output Format', options: ['Markdown', 'Plain Text', 'Structured JSON'] },
    includeMetadata: { label: 'Include Source Metadata', type: 'toggle' },
  },
};
