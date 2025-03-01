'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatInterfaceProps, Message } from '../types';

export default function ChatInterface({ 
  messages, 
  loading, 
  streamingMessages, 
  numParallelChats, 
  onSendMessage 
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-scroll to bottom when messages change or streaming messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessages]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !loading) {
      onSendMessage(input, numParallelChats);
      setInput('');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  // Group messages by chat_id
  const getMessagesByChat = () => {
    const userMessages = messages.filter(msg => msg.role === 'user');
    const assistantMessages = messages.filter(msg => msg.role === 'assistant');
    
    // Get the last user message
    const lastUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
    
    // Get all assistant messages that match the appropriate chat_id
    // For backward compatibility, include messages without chat_id
    const relevantAssistantMessages = assistantMessages.filter(msg => 
      // Include the messages that:
      // 1. Have no chat_id (old format)
      // 2. Have a chat_id less than numParallelChats (for current batch)
      msg.chat_id === undefined || (msg.chat_id >= 0 && msg.chat_id < numParallelChats)
    );
    
    // Combine messages for display
    return lastUserMessage ? [...relevantAssistantMessages.filter(m => !m.chat_id), lastUserMessage, ...relevantAssistantMessages.filter(m => m.chat_id !== undefined)] : relevantAssistantMessages;
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Messages container */}
      <div className="flex-1 overflow-y-auto py-6 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* User message */}
          <div className="space-y-4">
            {messages.filter(m => m.role === 'user').slice(-1).map((message, index) => (
              <MessageComponent key={`user-${index}`} message={message} />
            ))}
          </div>
          
          {/* Parallel streaming messages in a grid */}
          {numParallelChats > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({length: numParallelChats}).map((_, idx) => {
                const content = streamingMessages[idx] || null;
                // Check if there's a completed message for this chat_id
                const completedMessage = messages.find(m => m.role === 'assistant' && m.chat_id === idx && 
                  // Only consider recent messages (those after the last user message)
                  messages.findIndex(m => m === messages.filter(m => m.role === 'user').slice(-1)[0]) < 
                  messages.findIndex(m => m.role === 'assistant' && m.chat_id === idx)
                );
                
                // If there's a completed message and no streaming content, show the completed message
                if (completedMessage && content === null) {
                  return (
                    <div key={`completed-${idx}`} className="flex flex-col">
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-semibold mb-1">
                        Chat {idx + 1}
                      </div>
                      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm flex-1 border border-gray-200 dark:border-gray-700">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{completedMessage.content}</p>
                      </div>
                    </div>
                  );
                }
                
                // Otherwise show the streaming content or loading
                return (
                  <div key={`stream-container-${idx}`} className="flex flex-col">
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-semibold mb-1">
                      Chat {idx + 1}
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm flex-1 border border-gray-200 dark:border-gray-700">
                      {content !== null ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {content}
                          <span className="inline-block w-1 h-4 ml-1 bg-accent-500 animate-pulse"></span>
                        </p>
                      ) : (
                        <div className="flex items-center justify-center h-full min-h-[100px]">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"></div>
                            <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                            <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Single streaming message (for backward compatibility) */}
          {numParallelChats === 1 && Object.keys(streamingMessages).length > 0 && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm max-w-[85%] border border-gray-200 dark:border-gray-700">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {streamingMessages[0] || ""}
                  <span className="inline-block w-1 h-4 ml-1 bg-accent-500 animate-pulse"></span>
                </p>
              </div>
            </div>
          )}
          
          {/* Show original single-chat interface for backward compatibility */}
          {numParallelChats === 1 && messages.filter(m => m.role === 'assistant' && m.chat_id === undefined).map((message, index) => (
            <MessageComponent key={`legacy-${index}`} message={message} />
          ))}
          
          {/* Loading indicator (only shown when not streaming) */}
          {loading && Object.keys(streamingMessages).length === 0 && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm max-w-[85%] border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"></div>
                  <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>
      
      {/* Input container */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="relative rounded-md border border-gray-300 dark:border-gray-600 focus-within:border-accent-500 dark:focus-within:border-accent-500 focus-within:ring-1 focus-within:ring-accent-500 dark:focus-within:ring-accent-500 bg-white dark:bg-gray-800 shadow-sm transition-all duration-150">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Type a message... (Will generate ${numParallelChats} response${numParallelChats > 1 ? 's' : ''})`}
              className="w-full py-3 pl-4 pr-16 bg-transparent outline-none resize-none min-h-[44px] max-h-[200px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="absolute right-2 bottom-2 p-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150 text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 disabled:text-gray-400 dark:disabled:text-gray-600"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="transform rotate-90">
                <path d="M12 4L12 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M18 10L12 4L6 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-sans">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-sans">Shift+Enter</kbd> for new line
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageComponent({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`p-4 rounded-lg shadow-sm max-w-[85%] ${
          isUser 
            ? 'bg-accent-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
        }`}
      >
        {!isUser && message.chat_id !== undefined && (
          <div className="mb-1 text-xs text-gray-500 dark:text-gray-400 font-semibold">
            Chat {message.chat_id + 1}
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}