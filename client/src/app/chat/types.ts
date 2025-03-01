export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInterfaceProps {
  messages: Message[];
  loading: boolean;
  onSendMessage: (message: string) => void;
}