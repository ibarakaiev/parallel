export interface Message {
  role: 'user' | 'assistant';
  content: string;
  chat_id?: number;  // Added for multi-chat support
  subject?: string;  // Added for task subject display
}

export interface ChatInterfaceProps {
  messages: Message[];
  loading: boolean;
  streamingMessages: Record<number, string>;  // Changed to support multiple streams
  numParallelChats: number;
  onSendMessage: (message: string) => void;  // Removed n parameter as it's now determined by backend
  decomposing?: boolean; // New flag to show when query is being decomposed
  taskSubjects?: string[]; // Array of task subjects for display
}

export interface WebSocketMessage {
  type: 'stream_start' | 'chunk' | 'stream_end' | 'error' | 'all_complete' | 'batch_start' | 'decomposition_start';
  chat_id?: number;  // Added for multi-chat support
  content?: string;
  error?: string;
  total?: number;  // For all_complete message
  count?: number;  // For batch_start message
  message?: string; // For decomposition_start message
  subjects?: string[]; // Array of task subjects for batch_start
  subject?: string;  // Subject for a specific chat_id (stream_start, stream_end)
}