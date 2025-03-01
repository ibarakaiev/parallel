export interface Message {
  role: 'user' | 'assistant';
  content: string;
  chat_id?: number;  // Added for multi-chat support
}

export interface ChatInterfaceProps {
  messages: Message[];
  loading: boolean;
  streamingMessages: Record<number, string>;  // Changed to support multiple streams
  numParallelChats: number;
  onSendMessage: (message: string, n: number) => void;  // Added n parameter 
}

export interface WebSocketMessage {
  type: 'stream_start' | 'chunk' | 'stream_end' | 'error' | 'all_complete' | 'batch_start';
  chat_id?: number;  // Added for multi-chat support
  content?: string;
  error?: string;
  total?: number;  // For all_complete message
  count?: number;  // For batch_start message
}