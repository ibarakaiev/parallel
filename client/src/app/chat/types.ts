export interface Message {
  role: 'user' | 'assistant';
  content: string;
  chat_id?: number;  // Added for multi-chat support
  subject?: string;  // Added for task subject display
  is_reasoning?: boolean; // Whether this message is part of the reasoning steps
  reasoning_step?: number; // Which reasoning step this message belongs to
  is_final_response?: boolean; // Whether this is the final synthesized response
  metadata?: {
    rebranch_iteration?: number; // Which rebranching iteration this message belongs to
    task_index?: number; // Index of the task within its iteration
    [key: string]: any; // Allow for additional metadata fields
  };
}

export interface ChatInterfaceProps {
  messages: Message[];
  loading: boolean;
  streamingMessages: Record<number, string>;  // Changed to support multiple streams
  numParallelChats: number;
  onSendMessage: (message: string) => void;  // Removed n parameter as it's now determined by backend
  decomposing?: boolean; // New flag to show when query is being decomposed
  taskSubjects?: string[]; // Array of task subjects for display
  taskOutputs?: Record<number, string>; // Outputs from each task
  reasoningMessages?: Message[]; // Messages from the reasoning steps
  reasoningExpanded?: boolean; // Whether reasoning section is expanded
  toggleReasoningExpanded?: () => void; // Toggle reasoning expansion
}

export interface WebSocketMessage {
  type: 'thinking_start' | 'thinking_update' | 'thinking_end' | 
         'rebranch_start' | 'rebranch_end' |  
         'stream_start' | 'content_chunk' | 
         'stream_end' | 'error' | 'metadata' | 'final_response';
  chat_id?: number;  // Added for multi-chat support
  content?: string;
  error?: string;
  total?: number;  // For all_complete message
  count?: number;  // For batch_start message
  message?: string; // For decomposition_start message
  subjects?: string[]; // Array of task subjects for batch_start
  subject?: string;  // Subject for a specific chat_id (stream_start, stream_end)
  metadata?: {
    task_count?: number;
    task_subjects?: string[];
    task_index?: number;
    thinking_step?: number; // Which thinking step this belongs to
    subtask?: boolean; // Whether this is a subtask of a larger thinking process
    subject?: string; // Subject for a specific task
    stage?: string; // Stage of thinking (e.g., "decomposition")
    status?: string; // Status message (e.g., "all_complete")
    rebranch_iteration?: number; // Which rebranching iteration this is
    promising_paths?: string[]; // Promising paths for exploring in rebranching
    new_tasks?: string[]; // New tasks created in rebranching
    ready_for_synthesis?: boolean; // Whether the current results are ready for synthesis
  };
}