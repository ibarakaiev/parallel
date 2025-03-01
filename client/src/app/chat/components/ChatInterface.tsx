"use client";

import { useState, useRef, useEffect } from "react";
import { ChatInterfaceProps, Message } from "../types";
import ReactMarkdown from "react-markdown";

// Custom rendering components for markdown to ensure proper styling
const MarkdownComponents = {
  p: ({node, ...props}) => <p className="my-1" {...props} />,
  pre: ({node, ...props}) => <pre className="my-2" {...props} />,
  code: ({node, inline, ...props}) => 
    inline ? <code {...props} /> : <code className="block p-2" {...props} />
};

export default function ChatInterface({
  messages,
  loading,
  streamingMessages,
  numParallelChats,
  onSendMessage,
  decomposing = false,
  taskSubjects = [],
  reasoningMessages = [],
  reasoningExpanded = false,
  toggleReasoningExpanded = () => {},
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change or streaming messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessages]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !loading) {
      onSendMessage(input);
      setInput("");
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  // Group and order messages for display as conversation pairs
  const getMessagesByChat = () => {
    // Find the initial greeting message (shown at the beginning)
    const initialMessages = messages.filter((msg) => 
      msg.role === "assistant" && msg.chat_id === undefined && !messages.find((m) => m.role === "user")
    );
    
    // Get all user messages
    const userMessages = messages.filter((msg) => msg.role === "user");
    
    // Create message pairs (user question + assistant answer)
    const messagePairs: Message[] = [];
    
    // Start with any initial greeting
    if (initialMessages.length > 0) {
      messagePairs.push(...initialMessages);
    }
    
    // For each user message, find its corresponding assistant response
    userMessages.forEach((userMsg, index) => {
      // Add the user message
      messagePairs.push(userMsg);
      
      // Find all final responses after this user message and before the next user message
      const assistantResponses = messages.filter((msg) => 
        msg.role === "assistant" &&
        (msg.is_final_response === true || (!msg.is_reasoning && msg.chat_id === undefined)) &&
        messages.indexOf(msg) > messages.indexOf(userMsg) &&
        (index === userMessages.length - 1 || 
         messages.indexOf(msg) < messages.indexOf(userMessages[index + 1]))
      );
      
      // Add the last assistant response for this user message (if any)
      if (assistantResponses.length > 0) {
        messagePairs.push(assistantResponses[assistantResponses.length - 1]);
      }
    });
    
    return messagePairs;
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-accent-50 dark:bg-accent-50">
      {/* Messages container */}
      <div className="flex-1 overflow-y-auto py-6 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* All conversation messages in sequence - one pair at a time */}
          <div className="space-y-4">
            {getMessagesByChat().map((message, index) => {
              const isUserMessage = message.role === "user";
              // Show reasoning before the assistant response but after the user message 
              // AND only for the most recent user message (last user message in the conversation)
              const isLastUserMessage = isUserMessage && 
                                      getMessagesByChat().filter(m => m.role === "user").pop() === message;
              const showReasoning = isLastUserMessage && 
                                  reasoningMessages.length > 0 && 
                                  index < getMessagesByChat().length - 1;
                
              return (
                <div key={`message-group-${index}`}>
                  {/* The message itself */}
                  <MessageComponent key={`message-${index}`} message={message} />
                  
                  {/* Show reasoning steps after user message but before assistant's response */}
                  {showReasoning && (
                    <div className="mt-4 mb-4 border border-accent-200 dark:border-accent-300 rounded-lg overflow-hidden bg-white dark:bg-background-secondary">
                      {/* Reasoning header - clickable to expand/collapse */}
                      <div 
                        className="flex items-center justify-between p-3 border-b border-accent-200 dark:border-accent-300 cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-800/10"
                        onClick={toggleReasoningExpanded}
                      >
                        <div className="flex items-center gap-2 text-accent-700 dark:text-accent-700">
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <path
                              d="M12 16V12"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                            <path
                              d="M12 8H12.01"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="font-medium text-sm">Reasoning steps ({reasoningMessages.length})</span>
                        </div>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className={`text-accent-500 transition-transform duration-200 ${reasoningExpanded ? 'rotate-180' : ''}`}
                        >
                          <path
                            d="M6 9L12 15L18 9"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      
                      {/* Reasoning content - collapsible */}
                      {reasoningExpanded && (
                        <div className="p-4">
                          <div className="space-y-4">
                            {reasoningMessages.map((message, idx) => (
                              <div key={`reasoning-${idx}`} className="border-b border-accent-100 dark:border-accent-800 pb-4 last:border-b-0 last:pb-0">
                                <div className="text-sm text-accent-700 dark:text-accent-700 font-semibold mb-1 flex items-center gap-2">
                                  <span className="px-2 py-0.5 bg-accent-100 dark:bg-accent-800/30 rounded-full text-xs">
                                    {message.reasoning_step === 1 ? 'Decomposition' : message.subject || `Task ${message.chat_id !== undefined ? message.chat_id + 1 : ''}`}
                                  </span>
                                </div>
                                <div className="text-sm leading-relaxed font-serif markdown-content">
                                  <ReactMarkdown components={MarkdownComponents}>{message.content}</ReactMarkdown>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Parallel streaming messages in a grid */}
          {numParallelChats > 1 && Object.keys(streamingMessages).length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.keys(streamingMessages).map((idx) => {
                const taskIndex = parseInt(idx);
                const content = streamingMessages[taskIndex] || "";
                
                return (
                  <div
                    key={`stream-container-${taskIndex}`}
                    className="flex flex-col"
                  >
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-semibold mb-1">
                      {/* Use taskSubjects if available, otherwise fall back to finding the subject in messages */}
                      {taskSubjects && taskIndex < taskSubjects.length ? taskSubjects[taskIndex] : 
                       reasoningMessages.find(m => m.chat_id === taskIndex)?.subject || `Task ${taskIndex + 1}`}
                    </div>
                    <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm flex-1 border border-accent-200 dark:border-accent-300">
                      <div className="text-base leading-relaxed font-serif markdown-content">
                        <ReactMarkdown components={MarkdownComponents}>{content}</ReactMarkdown>
                        <span className="inline-block w-1 h-4 ml-1 bg-accent-500 animate-pulse"></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Single streaming message */}
          {numParallelChats === 1 &&
            Object.keys(streamingMessages).length > 0 && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm max-w-[85%] border border-accent-200 dark:border-accent-300">
                  {taskSubjects && taskSubjects[0] && (
                    <div className="mb-1 text-sm text-accent-700 dark:text-accent-700 font-semibold">
                      {taskSubjects[0]}
                    </div>
                  )}
                  <div className="text-base leading-relaxed font-serif markdown-content">
                    <ReactMarkdown components={MarkdownComponents}>{streamingMessages[0] || ""}</ReactMarkdown>
                    <span className="inline-block w-1 h-4 ml-1 bg-accent-500 animate-pulse"></span>
                  </div>
                </div>
              </div>
            )}

          {/* Decomposition indicator */}
          {decomposing && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm max-w-[85%] border border-accent-200 dark:border-accent-300">
                <div className="flex flex-col gap-2">
                  <div className="text-base text-accent-700 dark:text-accent-700 mb-1 font-serif">
                    Analyzing and decomposing your query...
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"></div>
                    <div
                      className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                    <div
                      className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"
                      style={{ animationDelay: "0.4s" }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Loading indicator (only shown when not streaming and not decomposing) */}
          {loading && !decomposing && Object.keys(streamingMessages).length === 0 && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm max-w-[85%] border border-accent-200 dark:border-accent-300">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"></div>
                  <div
                    className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"
                    style={{ animationDelay: "0.2s" }}
                  ></div>
                  <div
                    className="h-2 w-2 rounded-full bg-accent-500 animate-pulse"
                    style={{ animationDelay: "0.4s" }}
                  ></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input container */}
      <div className="border-t border-accent-200 dark:border-accent-300 bg-white dark:bg-background-secondary p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="relative rounded-md border border-accent-300 dark:border-accent-300 focus-within:border-accent-500 dark:focus-within:border-accent-500 focus-within:ring-1 focus-within:ring-accent-500 dark:focus-within:ring-accent-500 bg-white dark:bg-background-secondary shadow-sm transition-all duration-150">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message... (Your query will be auto-analyzed and decomposed)"
              className="w-full py-3 pl-4 pr-16 bg-transparent outline-none resize-none min-h-[44px] max-h-[200px] text-accent-900 dark:text-accent-900 placeholder:text-accent-400 dark:placeholder:text-accent-500 text-base font-serif"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
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
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="transform rotate-90"
              >
                <path
                  d="M12 4L12 20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M18 10L12 4L6 10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="mt-2 text-sm text-accent-700 dark:text-accent-700 text-center">
            Press{" "}
            <kbd className="px-1.5 py-0.5 bg-accent-50 dark:bg-accent-100 rounded border border-accent-200 dark:border-accent-300 text-accent-800 dark:text-accent-800 font-serif">
              Enter
            </kbd>{" "}
            to send,{" "}
            <kbd className="px-1.5 py-0.5 bg-accent-50 dark:bg-accent-100 rounded border border-accent-200 dark:border-accent-300 text-accent-800 dark:text-accent-800 font-serif">
              Shift+Enter
            </kbd>{" "}
            for new line
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageComponent({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`p-4 rounded-lg shadow-sm max-w-[85%] ${
          isUser
            ? "bg-accent-600 text-white"
            : "bg-white dark:bg-background-secondary text-accent-900 dark:text-accent-900 border border-accent-200 dark:border-accent-300"
        }`}
      >
        {!isUser && message.chat_id !== undefined && (
          <div className="mb-1 text-sm text-accent-700 dark:text-accent-700 font-semibold">
            {message.subject ? message.subject : `Chat ${message.chat_id + 1}`}
          </div>
        )}
        <div className="text-base leading-relaxed font-serif markdown-content">
          <ReactMarkdown components={MarkdownComponents}>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

