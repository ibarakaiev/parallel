export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInterfaceProps {
  messages: Message[];
  loading: boolean;
  streamingMessage: string | null;
  onSendMessage: (message: string) => void;
}

export interface WebSocketMessage {
  type: 'stream_start' | 'chunk' | 'stream_end' | 'error';
  content?: string;
  error?: string;
}