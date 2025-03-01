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

  // Group and order messages for display
  const getMessagesByChat = () => {
    // Arrange messages in chronological order
    // Order: Initial greeting -> user message -> all assistant responses (parallel or single)
    
    // Find the initial greeting message
    const initialMessages = messages.filter((msg) => 
      msg.role === "assistant" && msg.chat_id === undefined && !messages.find((m) => m.role === "user")
    );
    
    // Get the last user message
    const userMessages = messages.filter((msg) => msg.role === "user");
    const lastUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
    
    // Get assistant responses to the last user message
    const assistantResponses = messages.filter((msg) => 
      msg.role === "assistant" && 
      (msg.chat_id !== undefined || // Parallel responses have chat_id
       (msg.chat_id === undefined && // Single response might not have chat_id
        userMessages.length > 0 && 
        messages.indexOf(msg) > messages.indexOf(userMessages[userMessages.length - 1])))
    );
    
    // Build the final array in the correct order
    const orderedMessages = [
      ...initialMessages, // Initial greeting
      lastUserMessage, // User question
      ...assistantResponses // All assistant responses
    ].filter(Boolean); // Remove null entries
    
    return orderedMessages;
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-accent-50 dark:bg-accent-50">
      {/* Messages container */}
      <div className="flex-1 overflow-y-auto py-6 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* All messages in sequence (greeting, user message, single-chat responses) */}
          <div className="space-y-4">
            {getMessagesByChat()
              .filter(m => {
                // Show all messages if we're in single chat mode
                if (numParallelChats === 1) return true;
                // Otherwise only show messages without chat_id
                return m.chat_id === undefined;
              })
              .map((message, index) => (
                <MessageComponent key={`message-${index}`} message={message} />
              ))}
          </div>

          {/* Parallel streaming messages in a grid */}
          {numParallelChats > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: numParallelChats }).map((_, idx) => {
                const content = streamingMessages[idx] || null;
                // Check if there's a completed message for this chat_id
                // Find the completed message for this chat_id
                const completedMessage = messages.find(
                  (m) =>
                    m.role === "assistant" &&
                    m.chat_id === idx
                );

                // If there's a completed message and no streaming content, show the completed message
                if (completedMessage && content === null) {
                  return (
                    <div key={`completed-${idx}`} className="flex flex-col">
                      <div className="text-sm text-gray-500 dark:text-gray-400 font-semibold mb-1">
                        {completedMessage.subject || `Chat ${idx + 1}`}
                      </div>
                      <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm flex-1 border border-accent-200 dark:border-accent-300">
                        <div className="text-base leading-relaxed font-serif markdown-content">
                          <ReactMarkdown components={MarkdownComponents}>{completedMessage.content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Otherwise show the streaming content or loading
                return (
                  <div
                    key={`stream-container-${idx}`}
                    className="flex flex-col"
                  >
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-semibold mb-1">
                      {/* Use taskSubjects if available, otherwise fall back to finding the subject in messages */}
                      {taskSubjects && idx < taskSubjects.length ? taskSubjects[idx] : 
                       messages.find(m => m.role === "assistant" && m.chat_id === idx)?.subject || `Chat ${idx + 1}`}
                    </div>
                    <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm flex-1 border border-accent-200 dark:border-accent-300">
                      {content !== null ? (
                        <div className="text-base leading-relaxed font-serif markdown-content">
                          <ReactMarkdown components={MarkdownComponents}>{content}</ReactMarkdown>
                          <span className="inline-block w-1 h-4 ml-1 bg-accent-500 animate-pulse"></span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full min-h-[100px]">
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
                      )}
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

