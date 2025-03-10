"use client";

import { useState, useRef, useEffect } from "react";
import { ChatInterfaceProps, Message } from "../types";
import ReactMarkdown from "react-markdown";
import { ReactNode } from "react";

// Custom rendering components for markdown to ensure proper styling
// No longer using the AnimatedText component as it was causing duplicate animations

const MarkdownComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: ({ children, ...props }: any) => <p className="my-1" {...props}>{children}</p>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pre: ({ ...props }: any) => <pre className="my-2" {...props} />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: ({ inline, ...props }: { inline?: boolean; [key: string]: any }) =>
    inline ? <code {...props} /> : <code className="block p-2" {...props} />,
  // Add support for headers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h1: ({ children, ...props }: any) => <h1 className="text-2xl font-bold mt-4 mb-2" {...props}>{children}</h1>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2: ({ children, ...props }: any) => <h2 className="text-xl font-bold mt-3 mb-2" {...props}>{children}</h2>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h3: ({ children, ...props }: any) => <h3 className="text-lg font-bold mt-2 mb-1" {...props}>{children}</h3>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ul: ({ children, ...props }: any) => <ul className="list-disc pl-5 my-2" {...props}>{children}</ul>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ol: ({ children, ...props }: any) => <ol className="list-decimal pl-5 my-2" {...props}>{children}</ol>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  li: ({ children, ...props }: any) => <li className="my-1" {...props}>{children}</li>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blockquote: ({ children, ...props }: any) => <blockquote className="border-l-4 border-accent-300 pl-4 my-2 italic" {...props}>{children}</blockquote>,
};

export default function ChatInterface({
  messages,
  loading,
  streamingMessages,
  numParallelChats,
  onSendMessage,
  decomposing = false,
  taskSubjects = [],
  taskOutputs = {},
  reasoningMessages = [],
  reasoningExpanded = false,
  toggleReasoningExpanded = () => {},
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  const [localTaskOutputs, setLocalTaskOutputs] = useState<Record<number, string>>({});
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
  
  // Update localTaskOutputs when taskOutputs from props change
  useEffect(() => {
    if (Object.keys(taskOutputs).length > 0) {
      setLocalTaskOutputs(prev => ({
        ...prev,
        ...taskOutputs
      }));
    }
  }, [taskOutputs]);
  
  // Function to toggle expanded task
  const toggleExpandTask = (idx: number) => {
    setExpandedTask(expandedTask === idx ? null : idx);
    
    // If we don't have output for this task yet in our local state, check server output first
    if (!localTaskOutputs[idx]) {
      if (taskOutputs[idx]) {
        // Use real task output from the server if available
        setLocalTaskOutputs(prev => ({ ...prev, [idx]: taskOutputs[idx] }));
      } else {
        // Simulate streaming output for the task as a fallback
        const mockOutput = `Processing task: ${taskSubjects[idx]}\n\nAnalyzing data...\n`;
        setLocalTaskOutputs(prev => ({ ...prev, [idx]: mockOutput }));
        
        // Simulate streaming updates
        let counter = 0;
        const interval = setInterval(() => {
          counter++;
          setLocalTaskOutputs(prev => ({
            ...prev,
            [idx]: prev[idx] + `Step ${counter}: ${Math.random() > 0.5 ? 'Found relevant information.' : 'Analyzing sources.'}\n`
          }));
          
          // Stop after some iterations
          if (counter >= 5) {
            clearInterval(interval);
            setLocalTaskOutputs(prev => ({
              ...prev,
              [idx]: prev[idx] + `\nTask complete. Results integrated into final response.`
            }));
          }
        }, 1000);
      }
    }
  };

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
    const initialMessages = messages.filter(
      (msg) =>
        msg.role === "assistant" &&
        msg.chat_id === undefined &&
        !messages.find((m) => m.role === "user"),
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
      const assistantResponses = messages.filter(
        (msg) =>
          msg.role === "assistant" &&
          (msg.is_final_response === true ||
            (!msg.is_reasoning && msg.chat_id === undefined)) &&
          messages.indexOf(msg) > messages.indexOf(userMsg) &&
          (index === userMessages.length - 1 ||
            messages.indexOf(msg) < messages.indexOf(userMessages[index + 1])),
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
      {/* Task output panel */}
      {expandedTask !== null && taskSubjects[expandedTask] && (
        <TaskOutputPanel 
          subject={taskSubjects[expandedTask]} 
          output={localTaskOutputs[expandedTask] || taskOutputs[expandedTask] || "Loading..."} 
          onClose={() => setExpandedTask(null)} 
        />
      )}
      
      {/* Messages container */}
      <div className="flex-1 overflow-y-auto py-6 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Welcome message - only shown when no messages exist */}
          {getMessagesByChat().length === 0 && !loading && !decomposing && (
            <div className="flex flex-col items-center justify-center h-96 mt-16">
              <h1 className="text-3xl font-serif mb-2">
                Welcome to <em>Parallel</em>
              </h1>
              <p className="text-center text-accent-700 max-w-md font-sans">
                Speed up inference and improve accuracy when running prompts
                that require multiple perspectives
              </p>
            </div>
          )}

          {/* All conversation messages in sequence - one pair at a time */}
          <div className="space-y-4">
            {/* Show all messages directly */}
            {messages.map((message, index) => (
              <div key={`message-${index}`}>
                <MessageComponent
                  key={`message-component-${index}`}
                  message={message}
                  reasoningMessages={(message.role === "assistant") ? reasoningMessages : []}
                  reasoningExpanded={reasoningExpanded}
                  toggleReasoningExpanded={toggleReasoningExpanded}
                  taskSubjects={(message.role === "assistant") ? taskSubjects : []}
                />
              </div>
            ))}
          </div>

          {/* Single streaming message with thinking dropdown */}
          {(loading ||
            (streamingMessages && streamingMessages.thinking) ||
            (streamingMessages && streamingMessages.final_response)) && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm w-full border border-accent-200 dark:border-accent-300">
                {/* Thinking dropdown - always show */}
                  <div className="mb-3 border border-accent-200 dark:border-accent-300 rounded-lg overflow-hidden bg-accent-50 dark:bg-accent-800/10">
                    {/* Thinking header - clickable to expand/collapse */}
                    <div
                      className="flex items-center justify-between p-2 cursor-pointer hover:bg-accent-100 dark:hover:bg-accent-800/20"
                      onClick={toggleReasoningExpanded}
                    >
                      <div className="flex items-center gap-2 text-accent-700 dark:text-accent-700">
                        <span className="font-medium text-sm">Analysis</span>
                      </div>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className={`text-accent-500 transition-transform duration-200 ${reasoningExpanded ? "rotate-180" : ""}`}
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

                    {/* Thinking content - collapsible */}
                    {reasoningExpanded && (
                      <div className="p-3 border-t border-accent-200 dark:border-accent-300 animate-fadeIn">
                        {/* General reasoning plan - always show something */}
                        <div className="mb-3">
                          <div className="text-sm text-accent-800 dark:text-accent-700">
                            {reasoningMessages.length > 0 && reasoningMessages[0] ? (
                              <div>
                                {reasoningMessages[0].content}
                              </div>
                            ) : (streamingMessages && streamingMessages.thinking) ? (
                              <div>
                                {streamingMessages.thinking}
                                <div className="flex items-center gap-2 mt-2">
                                  <div className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse"></div>
                                  <div
                                    className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse"
                                    style={{ animationDelay: "0.2s" }}
                                  ></div>
                                  <div
                                    className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse"
                                    style={{ animationDelay: "0.4s" }}
                                  ></div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span>Decomposing query</span>
                                <div className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse"></div>
                                <div
                                  className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse"
                                  style={{ animationDelay: "0.2s" }}
                                ></div>
                                <div
                                  className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse"
                                  style={{ animationDelay: "0.4s" }}
                                ></div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Grid of subtasks - only show in thinking view */}
                        {taskSubjects && taskSubjects.length > 0 && (
                          <div>
                            <div className="text-sm font-medium mb-1">
                              Subtasks
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {taskSubjects.map((subject, idx) => (
                                <div
                                  key={`task-subject-${idx}`}
                                  className="bg-white dark:bg-background-secondary p-2 rounded border border-accent-200 dark:border-accent-300 text-xs animate-fadeIn flex items-center cursor-pointer hover:bg-accent-50 dark:hover:bg-background-primary"
                                  style={{ animationDelay: `${idx * 100}ms` }}
                                  onClick={() => toggleExpandTask(idx)}
                                >
                                  <div className="flex-1 mr-1 truncate">
                                    {subject}
                                    {/* Small dot to indicate running task - only show when loading */}
                                    {loading && <span className="inline-block w-1.5 h-1.5 ml-1 align-middle rounded-full bg-accent-500 animate-pulse"></span>}
                                  </div>
                                  {/* Expand icon */}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-accent-500">
                                    <path d="M15 3H21V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M9 21H3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M21 3L14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M3 21L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                {/* Show the final response streaming if available - this is the main content */}
                {streamingMessages && streamingMessages.final_response ? (
                  <div className="text-base leading-relaxed font-serif prose prose-headings:font-serif prose-headings:text-accent-900 prose-p:text-accent-900 prose-a:text-blue-600 prose-strong:text-accent-900 prose-ul:text-accent-900 prose-ol:text-accent-900 max-w-none">
                    {/* Use ReactMarkdown to properly render the markdown */}
                    <ReactMarkdown components={MarkdownComponents}>
                      {streamingMessages.final_response}
                    </ReactMarkdown>
                  </div>
                ) : (
                  /* Loading indicator - only show dots, no text */
                  loading && (
                    <div className="flex items-center gap-2 py-1">
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
                  )
                )}
              </div>
            </div>
          )}

          {/* Decomposition indicator with thinking dropdown */}
          {decomposing && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm w-full border border-accent-200 dark:border-accent-300">
                {/* Thinking dropdown */}
                {reasoningMessages.length > 0 && (
                  <div className="mb-3 border border-accent-200 dark:border-accent-300 rounded-lg overflow-hidden bg-accent-50 dark:bg-accent-800/10">
                    {/* Thinking header - clickable to expand/collapse */}
                    <div
                      className="flex items-center justify-between p-2 cursor-pointer hover:bg-accent-100 dark:hover:bg-accent-800/20"
                      onClick={toggleReasoningExpanded}
                    >
                      <div className="flex items-center gap-2 text-accent-700 dark:text-accent-700">
                        <span className="font-medium text-sm">Analysis</span>
                      </div>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className={`text-accent-500 transition-transform duration-200 ${reasoningExpanded ? "rotate-180" : ""}`}
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

                    {/* Thinking content - collapsible */}
                    {reasoningExpanded && (
                      <div className="p-3 border-t border-accent-200 dark:border-accent-300 animate-fadeIn">
                        {/* General reasoning plan */}
                        {reasoningMessages.length > 0 &&
                          reasoningMessages[0] && (
                            <div className="mb-3">
                              <div className="text-sm font-medium mb-1">
                                Analysis
                              </div>
                              <div className="text-sm text-accent-800 dark:text-accent-700">
                                <ReactMarkdown components={MarkdownComponents}>
                                  {reasoningMessages[0].content}
                                </ReactMarkdown>
                              </div>
                            </div>
                          )}

                        {/* Grid of subtasks */}
                        {taskSubjects && taskSubjects.length > 0 && (
                          <div>
                            <div className="text-sm font-medium mb-1">
                              Subtasks
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {taskSubjects.map((subject, idx) => (
                                <div
                                  key={`task-subject-${idx}`}
                                  className="bg-white dark:bg-background-secondary p-2 rounded border border-accent-200 dark:border-accent-300 text-xs animate-fadeIn flex items-center cursor-pointer hover:bg-accent-50 dark:hover:bg-background-primary"
                                  onClick={() => toggleExpandTask(idx)}
                                >
                                  <div className="flex-1 mr-1 truncate">
                                    {subject}
                                    {/* Small dot to indicate running task - only show when loading or decomposing */}
                                    {(loading || decomposing) && <span className="inline-block w-1.5 h-1.5 ml-1 align-middle rounded-full bg-accent-500 animate-pulse"></span>}
                                  </div>
                                  {/* Expand icon */}
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-accent-500">
                                    <path d="M15 3H21V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M9 21H3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M21 3L14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M3 21L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-2 animate-fadeIn">
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
          {loading &&
            !decomposing &&
            (!streamingMessages || Object.keys(streamingMessages).length === 0) && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-background-secondary p-4 rounded-lg shadow-sm w-full border border-accent-200 dark:border-accent-300">
                  {/* Thinking dropdown */}
                  {reasoningMessages.length > 0 && (
                    <div className="mb-3 border border-accent-200 dark:border-accent-300 rounded-lg overflow-hidden bg-accent-50 dark:bg-accent-800/10">
                      {/* Thinking header - clickable to expand/collapse */}
                      <div
                        className="flex items-center justify-between p-2 cursor-pointer hover:bg-accent-100 dark:hover:bg-accent-800/20"
                        onClick={toggleReasoningExpanded}
                      >
                        <div className="flex items-center gap-2 text-accent-700 dark:text-accent-700">
                          <span className="font-medium text-sm">Analysis</span>
                        </div>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className={`text-accent-500 transition-transform duration-200 ${reasoningExpanded ? "rotate-180" : ""}`}
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

                      {/* Thinking content - collapsible */}
                      {reasoningExpanded && (
                        <div className="p-3 border-t border-accent-200 dark:border-accent-300">
                          {/* General reasoning plan */}
                          {reasoningMessages.length > 0 &&
                            reasoningMessages[0] && (
                              <div className="mb-3 animate-fadeIn">
                                <div className="text-sm font-medium mb-1">
                                  Analysis
                                </div>
                                <div className="text-sm text-accent-800 dark:text-accent-700">
                                  <ReactMarkdown
                                    components={MarkdownComponents}
                                  >
                                    {reasoningMessages[0].content}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}

                          {/* Grid of subtasks */}
                          {taskSubjects && taskSubjects.length > 0 && (
                            <div>
                              <div className="text-sm font-medium mb-1">
                                Subtasks
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {taskSubjects.map((subject, idx) => (
                                  <div
                                    key={`task-subject-${idx}`}
                                    className="bg-white dark:bg-background-secondary p-2 rounded border border-accent-200 dark:border-accent-300 text-xs animate-fadeIn flex items-center cursor-pointer hover:bg-accent-50 dark:hover:bg-background-primary"
                                    onClick={() => toggleExpandTask(idx)}
                                  >
                                    <div className="flex-1 mr-1 truncate">
                                      {subject}
                                      {/* Small dot to indicate running task - only show when loading */}
                                      {loading && <span className="inline-block w-1.5 h-1.5 ml-1 align-middle rounded-full bg-accent-500 animate-pulse"></span>}
                                    </div>
                                    {/* Expand icon */}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-accent-500">
                                      <path d="M15 3H21V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M9 21H3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M21 3L14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M3 21L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

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
              className="w-full py-3 pl-4 pr-16 bg-transparent outline-none resize-none min-h-[44px] max-h-[200px] text-accent-900 dark:text-accent-900 placeholder:text-accent-400 dark:placeholder:text-accent-500 text-base font-sans"
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
            <kbd className="px-1.5 py-0.5 bg-accent-50 dark:bg-accent-100 rounded border border-accent-200 dark:border-accent-300 text-accent-800 dark:text-accent-800 font-sans">
              Enter
            </kbd>{" "}
            to send,{" "}
            <kbd className="px-1.5 py-0.5 bg-accent-50 dark:bg-accent-100 rounded border border-accent-200 dark:border-accent-300 text-accent-800 dark:text-accent-800 font-sans">
              Shift+Enter
            </kbd>{" "}
            for new line
          </div>
        </form>
      </div>
    </div>
  );
}

// TaskOutputPanel component
function TaskOutputPanel({ 
  subject, 
  output, 
  onClose 
}: { 
  subject: string; 
  output: string; 
  onClose: () => void;
}) {
  return (
    <div className="fixed right-0 top-0 bottom-0 w-1/3 bg-white dark:bg-background-secondary border-l border-accent-200 dark:border-accent-300 z-10 shadow-lg flex flex-col">
      <div className="p-4 border-b border-accent-200 dark:border-accent-300 flex justify-between items-center">
        <h3 className="font-medium text-accent-900">Task: {subject}</h3>
        <button 
          onClick={onClose}
          className="text-accent-500 hover:text-accent-700"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      <div className="p-4 overflow-auto flex-1 bg-accent-50 dark:bg-accent-800/10">
        <pre className="text-sm font-mono whitespace-pre-wrap break-words text-accent-800 dark:text-accent-700">
          {output}
        </pre>
      </div>
    </div>
  );
}

function MessageComponent({
  message,
  reasoningMessages = [],
  reasoningExpanded = false,
  toggleReasoningExpanded = () => {},
  taskSubjects = [],
}: {
  message: Message;
  reasoningMessages?: Message[];
  reasoningExpanded?: boolean;
  toggleReasoningExpanded?: () => void;
  taskSubjects?: string[];
}) {
  const isUser = message.role === "user";
  // Don't show reasoning dropdown in final response messages anymore
  // This prevents the duplicate dropdown issue

  // For debugging
  console.log("Rendering message:", isUser ? "USER" : "ASSISTANT", message);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`p-4 rounded-lg ${
          isUser
            ? "bg-gradient-to-b from-[#EFE9E5] to-accent-200 text-accent-900 font-sans text-sm font-medium md:w-11/12"
            : "bg-white dark:bg-background-secondary text-accent-900 dark:text-accent-900 border border-accent-200 dark:border-accent-300 w-full"
        }`}
      >
        {!isUser && message.chat_id !== undefined && (
          <div className="mb-1 text-sm text-accent-700 dark:text-accent-700 font-semibold">
            {message.subject ? message.subject : `Chat ${message.chat_id + 1}`}
          </div>
        )}
        {isUser ? (
          /* Render user messages directly as plain text */
          <div className="text-base leading-relaxed markdown-content">
            {message.content}
          </div>
        ) : (
          /* Render assistant messages with markdown */
          <div className="text-base leading-relaxed font-serif markdown-content">
            <ReactMarkdown components={MarkdownComponents}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
