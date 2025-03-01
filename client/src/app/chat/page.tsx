"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ChatInterface from "./components/ChatInterface";
import { Message, WebSocketMessage } from "./types";

// Maximum number of concurrent chats
const MAX_CONCURRENT_CHATS = 4;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentReasoningMessages, setCurrentReasoningMessages] = useState<Message[]>([]);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [streamingMessages, setStreamingMessages] = useState<
    Record<number, string>
  >({});
  const [taskSubjects, setTaskSubjects] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [numParallelChats, setNumParallelChats] = useState(1);

  // Debug streaming message changes
  useEffect(() => {
    console.log("Streaming messages updated:", streamingMessages);
  }, [streamingMessages]);

  // Initialize connection status
  useEffect(() => {
    setConnected(false);
  }, []);

  const toggleReasoningExpanded = () => {
    setReasoningExpanded(!reasoningExpanded);
  };

  // Handle processing SSE events
  const processSSEEvent = useCallback((eventData: any) => {
    try {
      console.log("SSE data received:", eventData);
      
      switch (eventData.type) {
        case "thinking_start":
          console.log("Thinking started:", eventData.content);
          
          // Check if this is a main thinking step or a subtask
          const thinkingStep = eventData.metadata?.thinking_step || 1;
          const isSubtask = eventData.metadata?.subtask || false;
          const subject = eventData.metadata?.subject || "";
          
          if (thinkingStep === 1) {
            // This is the main decomposition step
            setDecomposing(true);
            
            // Add this as a reasoning message
            const reasoningMessage: Message = {
              role: "assistant",
              content: eventData.content || "Analyzing query...",
              is_reasoning: true,
              reasoning_step: thinkingStep,
              subject: "Query Analysis"
            };
            // Only add to current reasoning for this request
            setCurrentReasoningMessages(prev => [...prev, reasoningMessage]);
          } else if (isSubtask) {
            // This is a parallel subtask
            // If this is the first subtask, clear previous reasoning messages for this step
            const existingSubtasks = currentReasoningMessages.filter(
              msg => msg.reasoning_step === thinkingStep && msg.is_reasoning
            );
            
            if (existingSubtasks.length === 0) {
              // Add a header message for this reasoning step
              const reasoningHeaderMessage: Message = {
                role: "assistant",
                content: "Processing parallel subtasks...",
                is_reasoning: true,
                reasoning_step: thinkingStep,
                subject: "Parallel Processing"
              };
              // Only add to current reasoning for this request
              setCurrentReasoningMessages(prev => [...prev, reasoningHeaderMessage]);
            }
            
            // Initialize a streaming message for this subtask
            const taskIndex = eventData.metadata?.task_index;
            if (taskIndex !== undefined) {
              setStreamingMessages(prev => ({
                ...prev,
                [taskIndex]: ""
              }));
            }
          }
          break;
          
        case "thinking_end":
          console.log("Thinking ended with summary:", eventData.content);
          
          // Check which thinking step this is
          const endThinkingStep = eventData.metadata?.thinking_step || 1;
          const endIsSubtask = eventData.metadata?.subtask || false;
          
          if (endThinkingStep === 1) {
            // This is the end of the decomposition step
            // Set the number of parallel chats based on the metadata
            const taskCount = eventData.metadata?.task_count || 1;
            const subjects = eventData.metadata?.task_subjects || [];
            setNumParallelChats(taskCount);
            setTaskSubjects(subjects);
            
            // Update the reasoning message with the final content
            const updatedReasoningMessage: Message = {
              role: "assistant",
              content: eventData.content || "Query analyzed.",
              is_reasoning: true,
              reasoning_step: endThinkingStep,
              subject: "Query Analysis"
            };
            
            // Replace the thinking_start message with the complete content
            // Only update current reasoning messages for this request
            setCurrentReasoningMessages(prev => 
              prev.map(msg => 
                (msg.reasoning_step === endThinkingStep && !msg.chat_id) 
                  ? updatedReasoningMessage 
                  : msg
              )
            );
            
            // Initialize UI grid with empty slots for all chats
            const initialStreamingMessages: Record<number, string> = {};
            for (let i = 0; i < taskCount; i++) {
              initialStreamingMessages[i] = ""; // Initialize all slots with empty strings
            }
            setStreamingMessages(initialStreamingMessages);
            
            // End the decomposing state
            setDecomposing(false);

            // Clear any previous completed messages that should be replaced
            setMessages((prev) =>
              prev.filter(
                (msg) =>
                  msg.role !== "assistant" || 
                  (msg.is_final_response === true) // Keep final responses
              ),
            );
          } else if (endIsSubtask) {
            // This is the end of a parallel subtask thinking step
            const taskIndex = eventData.metadata?.task_index;
            const subject = eventData.metadata?.subject || `Task ${taskIndex !== undefined ? taskIndex + 1 : ''}`;
            
            if (eventData.content && taskIndex !== undefined) {
              // Create a reasoning message for this subtask result
              const subtaskReasoningMessage: Message = {
                role: "assistant",
                content: eventData.content,
                is_reasoning: true,
                reasoning_step: endThinkingStep,
                subject: subject,
                chat_id: taskIndex
              };
              
              // Add only to current reasoning messages
              setCurrentReasoningMessages(prev => [...prev, subtaskReasoningMessage]);
              
              // Clear streaming message for this task
              setStreamingMessages(prev => {
                const newState = { ...prev };
                delete newState[taskIndex];
                return newState;
              });
            }
          }
          break;

        case "content_chunk":
          // Handle content chunk for subtask reasoning
          const chatIndex = eventData.metadata?.task_index;
          const isReasoningChunk = eventData.metadata?.thinking_step !== undefined;
          
          if (eventData.content && chatIndex !== undefined) {
            console.log(
              `Chunk for ${isReasoningChunk ? 'reasoning' : 'response'} chat ${chatIndex} received:`,
              eventData.content.substring(0, 20) + "...",
            );
            
            // Append new content to streaming message for this chat
            setStreamingMessages((prev) => {
              const prevContent = prev[chatIndex] || "";
              return {
                ...prev,
                [chatIndex]: prevContent + eventData.content,
              };
            });
          }
          break;

        case "final_response":
          console.log("Final synthesized response received");
          
          // This is the final synthesized response from all parallel tasks
          if (eventData.content) {
            const finalResponseMessage: Message = {
              role: "assistant",
              content: eventData.content,
              is_final_response: true
            };
            
            // Add final response to messages
            setMessages(prev => {
              // Remove any previous final responses
              const filteredMessages = prev.filter(msg => !msg.is_final_response);
              return [...filteredMessages, finalResponseMessage];
            });
          }
          break;

        case "metadata":
          if (eventData.metadata?.status === "all_complete") {
            console.log(`All ${eventData.metadata.task_count} tasks completed`);
            setLoading(false);
            
            // Keep reasoning messages visible after completion
            // No need to clear currentReasoningMessages
          }
          break;

        case "error":
          console.error("Error from server:", eventData.content);
          // Show error message to the user
          const errorTaskIndex = eventData.metadata?.task_index;
          const errorMessage: Message = {
            role: "assistant",
            content: `Sorry, there was an error: ${eventData.content || "Unknown error"}`,
            chat_id: errorTaskIndex,
          };
          setMessages((prev) => [...prev, errorMessage]);

          // Clear streaming message if task_index is provided
          if (errorTaskIndex !== undefined) {
            setStreamingMessages((prev) => {
              const newState = { ...prev };
              delete newState[errorTaskIndex];
              return newState;
            });
          }

          // End the decomposing state if it was active
          setDecomposing(false);

          // If this was the last active chat or a general error, set loading to false
          if (
            Object.keys(streamingMessages).length === 0 ||
            errorTaskIndex === undefined
          ) {
            setLoading(false);
          }
          break;

        default:
          console.warn("Unknown event type:", eventData);
      }
    } catch (error) {
      console.error("Error processing SSE event:", error);
    }
  }, [streamingMessages, taskSubjects, currentReasoningMessages]);

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || loading) return;

    // Add user message to state
    const newUserMessage: Message = { role: "user", content: message };
    setMessages((prev) => [...prev, newUserMessage]);
    setLoading(true);

    // Clear any existing streaming messages for the new query
    setStreamingMessages({});
    
      // Don't persist reasoning messages between requests
    // Just clear current reasoning to prepare for the new query
    setCurrentReasoningMessages([]);
    
    // Auto-expand reasoning for the new query
    setReasoningExpanded(true);
    
    // Reset connection state
    setConnected(false);

    try {
      // Create the conversation history including the new message
      // First gather all past messages, filtering out reasoning and parallel task messages
      const conversationMessages = messages.filter(msg => 
        // Keep user messages
        msg.role === "user" ||
        // Keep assistant messages that are final responses or regular responses
        (msg.role === "assistant" && 
         (msg.is_final_response === true || 
          (!msg.is_reasoning && msg.chat_id === undefined)))
      );
      
      // Keep the full chronological order of messages
      const updatedMessages = [...conversationMessages, newUserMessage];
      console.log("Conversation history:", updatedMessages);
      
      // Use fetch to create a streaming response
      const apiUrl = "http://localhost:4000/v1/messages";
      
      // For API requests, we need to pass the full conversation history
      // Only filter out intermediate reasoning messages but keep the proper sequential order
      
      // Start with all messages (user + final assistant responses)
      const messageBody = updatedMessages
        .filter(msg => 
          // Include all user messages
          msg.role === "user" || 
          // Include only final assistant responses or regular assistant messages (no reasoning or parallel chat)
          (msg.role === "assistant" && 
           (msg.is_final_response === true || (!msg.is_reasoning && msg.chat_id === undefined)))
        )
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      
      // Log the full message body for debugging
      console.log("Final messageBody to send to API:", messageBody);
        
      // Log the full API request for debugging
      console.log("FULL API REQUEST:", {
        url: apiUrl,
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          messages: messageBody,
          stream: true
        }, null, 2)
      });
      
      // Make the POST request directly
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: messageBody,
          stream: true
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Get the response as a readable stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }
      
      // Process the stream
      const decoder = new TextDecoder();
      let buffer = "";
      
      // Set up a reading function that processes chunks as they arrive
      const readStream = async () => {
        try {
          while (true) {
            const {done, value} = await reader.read();
            
            if (done) {
              console.log("Stream complete");
              setLoading(false);
              break;
            }
            
            // Decode the chunk and add to buffer
            const chunk = decoder.decode(value, {stream: true});
            buffer += chunk;
            
            // Process complete SSE messages from the buffer
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || ""; // Keep the last incomplete chunk in the buffer
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  // Extract the JSON data from the SSE format
                  const jsonStr = line.substring(6); // Remove 'data: ' prefix
                  if (jsonStr === "[DONE]") {
                    console.log("Stream marked as done");
                    continue;
                  }
                  
                  const eventData = JSON.parse(jsonStr);
                  processSSEEvent(eventData);
                } catch (e) {
                  console.error("Error parsing SSE data:", e, line);
                }
              }
            }
          }
        } catch (error) {
          console.error("Error reading stream:", error);
          setLoading(false);
          
          // Show error message
          const errorMessage: Message = {
            role: "assistant",
            content: "Sorry, there was an error processing the stream."
          };
          setMessages(prev => [...prev, errorMessage]);
        }
      };
      
      // Start reading the stream
      readStream();
      
      // Indicate connection is active
      setConnected(true);
      
      // Stream reading is handled by the readStream function above
      
    } catch (error) {
      console.error("Error setting up SSE connection:", error);

      const newAssistantMessage: Message = {
        role: "assistant",
        content:
          "Sorry, I'm having trouble reaching the assistant service. Please try again later.",
      };

      setMessages((prev) => [...prev, newAssistantMessage]);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-accent-50 dark:bg-accent-50">
      {/* Sidebar */}
      <div className="w-64 border-r border-accent-200 dark:border-accent-300 bg-white dark:bg-background-secondary hidden sm:block">
        <div className="h-14 border-b border-accent-200 dark:border-accent-300 px-4 flex items-center">
          <h1 className="text-lg font-medium text-accent-900 dark:text-accent-900 font-serif">
            Parallel
          </h1>
        </div>
        <div className="p-3">
          <button className="flex items-center px-3 py-2 text-sm text-accent-900 dark:text-accent-900 rounded bg-accent-100 dark:bg-accent-100 w-full justify-between group font-serif">
            <div className="flex items-center gap-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-accent-700 dark:text-accent-700"
              >
                <path
                  d="M13.5 3H2.5C2.22386 3 2 3.22386 2 3.5V12.5C2 12.7761 2.22386 13 2.5 13H13.5C13.7761 13 14 12.7761 14 12.5V3.5C14 3.22386 13.7761 3 13.5 3Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 6H14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M5.5 9.5H10.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Chat</span>
            </div>
            <span className="text-xs py-0.5 px-2 rounded-full bg-accent-200 dark:bg-accent-200 text-accent-800 dark:text-accent-800">
              {numParallelChats}
            </span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b border-accent-200 dark:border-accent-300 bg-white dark:bg-background-secondary flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button className="sm:hidden p-1 rounded hover:bg-accent-100 dark:hover:bg-accent-200">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-accent-900 dark:text-accent-900"
              >
                <path
                  d="M3 6H21"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M3 12H21"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M3 18H21"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <h2 className="text-sm font-medium text-accent-900 dark:text-accent-900 font-serif">
              Chat Assistant
            </h2>

            {/* Connection status */}
            <div
              className={`px-2 py-0.5 text-xs rounded-full font-serif ${connected ? "bg-accent-100 text-accent-800 dark:bg-accent-200 dark:text-accent-800" : "bg-red-100 text-red-800 dark:bg-red-100 dark:text-red-800"}`}
            >
              {connected ? "API Connected" : "API Disconnected"}
            </div>
            
            {/* Auto-decomposition status badge */}
            {numParallelChats > 1 && (
              <div className="px-2 py-0.5 text-xs rounded-full font-serif bg-accent-100 text-accent-800 dark:bg-accent-200 dark:text-accent-800">
                {numParallelChats} parallel angles
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button className="p-1.5 rounded-full hover:bg-accent-100 dark:hover:bg-accent-200">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-accent-700 dark:text-accent-700"
              >
                <path
                  d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 8V16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M8 12H16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div className="h-6 w-6 rounded-full bg-accent-500 flex items-center justify-center text-white text-xs font-serif">
              U
            </div>
          </div>
        </header>

        <ChatInterface
          messages={messages}
          loading={loading}
          streamingMessages={streamingMessages}
          numParallelChats={numParallelChats}
          onSendMessage={handleSendMessage}
          decomposing={decomposing}
          taskSubjects={taskSubjects}
          reasoningMessages={currentReasoningMessages}
          reasoningExpanded={reasoningExpanded}
          toggleReasoningExpanded={toggleReasoningExpanded}
        />
      </div>
    </div>
  );
}
