"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ChatInterface from "./components/ChatInterface";
import { Message, WebSocketMessage } from "./types";

// Maximum number of concurrent chats
const MAX_CONCURRENT_CHATS = 4;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [streamingMessages, setStreamingMessages] = useState<
    Record<number, string>
  >({});
  const [taskSubjects, setTaskSubjects] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [numParallelChats, setNumParallelChats] = useState(1);

  // This component now uses SSE instead of WebSockets

  // Debug streaming message changes
  useEffect(() => {
    console.log("Streaming messages updated:", streamingMessages);
  }, [streamingMessages]);

  // Initialize connection status
  useEffect(() => {
    setConnected(false);
  }, []);

  // Handle processing SSE events
  const processSSEEvent = useCallback((eventData: any) => {
    try {
      console.log("SSE data received:", eventData);
      
      switch (eventData.type) {
        case "thinking_start":
          console.log("Thinking started:", eventData.content);
          setDecomposing(true);
          break;
          
        case "thinking_end":
          console.log("Thinking ended with summary:", eventData.content);
          // Set the number of parallel chats based on the metadata
          const taskCount = eventData.metadata?.task_count || 1;
          const subjects = eventData.metadata?.task_subjects || [];
          setNumParallelChats(taskCount);
          setTaskSubjects(subjects);
          
          // Initialize UI grid with empty slots for all chats
          const initialStreamingMessages: Record<number, string> = {};
          for (let i = 0; i < taskCount; i++) {
            initialStreamingMessages[i] = ""; // Initialize all slots with empty strings
          }
          setStreamingMessages(initialStreamingMessages);
          
          // End the decomposing state
          setDecomposing(false);

          // Clear any previous completed messages with chat_id
          setMessages((prev) =>
            prev.filter(
              (msg) =>
                msg.role !== "assistant" || msg.chat_id === undefined,
            ),
          );
          break;

        case "stream_start":
          const taskIndex = eventData.metadata?.task_index;
          const subject = eventData.metadata?.subject;
          console.log(`Stream started for task ${taskIndex} with subject: ${subject || 'unknown'}`);
          
          // If we received a subject, add it to the taskSubjects array
          if (subject !== undefined && taskIndex !== undefined) {
            setTaskSubjects(prev => {
              const newSubjects = [...prev];
              newSubjects[taskIndex] = subject;
              return newSubjects;
            });
          }
          
          // Initialize streaming message for this chat
          if (taskIndex !== undefined) {
            setStreamingMessages((prev) => ({
              ...prev,
              [taskIndex]: "",
            }));
          }
          break;

        case "content_chunk":
          const chatIndex = eventData.metadata?.task_index;
          if (eventData.content && chatIndex !== undefined) {
            console.log(
              `Chunk for chat ${chatIndex} received:`,
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

        case "stream_end":
          const endTaskIndex = eventData.metadata?.task_index;
          const endSubject = eventData.metadata?.subject;
          console.log(`Stream ended for task ${endTaskIndex} with subject: ${endSubject || 'unknown'}`);
          
          // Streaming ended, add the complete message
          if (eventData.content && endTaskIndex !== undefined) {
            // Get subject from event metadata or from taskSubjects array if available
            let finalSubject = endSubject;
            if (!finalSubject && endTaskIndex < taskSubjects.length) {
              finalSubject = taskSubjects[endTaskIndex];
            }
            
            const newAssistantMessage: Message = {
              role: "assistant",
              content: eventData.content,
              chat_id: endTaskIndex,
              subject: finalSubject
            };
            setMessages((prev) => [...prev, newAssistantMessage]);

            // Clear streaming message for this chat
            setStreamingMessages((prev) => {
              const newState = { ...prev };
              delete newState[endTaskIndex];
              return newState;
            });
          }
          break;

        case "metadata":
          if (eventData.metadata?.status === "all_complete") {
            console.log(`All ${eventData.metadata.task_count} tasks completed`);
            setLoading(false);
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
  }, [streamingMessages, taskSubjects]);

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || loading) return;

    // Add user message to state
    const newUserMessage: Message = { role: "user", content: message };
    setMessages((prev) => [...prev, newUserMessage]);
    setLoading(true);

    // Clear any existing streaming messages
    setStreamingMessages({});
    
    // Reset connection state
    setConnected(false);

    try {
      // Create the conversation history including the new message
      const updatedMessages = [...messages, newUserMessage];
      
      // Use fetch to create a streaming response
      const apiUrl = "http://localhost:4000/v1/messages";
      
      // Create message body for API request
      const messageBody = updatedMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
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
        />
      </div>
    </div>
  );
}
