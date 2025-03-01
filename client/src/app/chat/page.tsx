"use client";

import { useState, useEffect, useRef } from "react";
import ChatInterface from "./components/ChatInterface";
import { Message, WebSocketMessage } from "./types";

// Maximum number of concurrent chats
const MAX_CONCURRENT_CHATS = 4;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! How can I help you today?" },
  ]);
  const [loading, setLoading] = useState(false);
  const [streamingMessages, setStreamingMessages] = useState<
    Record<number, string>
  >({});
  const [connected, setConnected] = useState(false);
  const [numParallelChats, setNumParallelChats] = useState(1);

  const socketRef = useRef<WebSocket | null>(null);

  // Debug streaming message changes
  useEffect(() => {
    console.log("Streaming messages updated:", streamingMessages);
  }, [streamingMessages]);

  // Connect to WebSocket
  useEffect(() => {
    const connectWebSocket = () => {
      console.log("Connecting to WebSocket...");

      const socket = new WebSocket("ws://localhost:4000/ws/chat");

      socket.onopen = () => {
        console.log("WebSocket connected successfully");
        setConnected(true);
      };

      socket.onclose = (event) => {
        console.log("WebSocket disconnected", event.code, event.reason);
        setConnected(false);

        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (socketRef.current?.readyState !== WebSocket.OPEN) {
            console.log("Attempting to reconnect...");
            connectWebSocket();
          }
        }, 3000);
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      socket.onmessage = (event) => {
        console.log("WebSocket message received:", event.data);
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          console.log("Parsed WebSocket message:", data);

          switch (data.type) {
            case "batch_start":
              console.log(`Starting batch of ${data.count} parallel chats`);
              // Initialize UI grid with empty slots for all chats
              const initialStreamingMessages: Record<number, string> = {};
              for (let i = 0; i < data.count!; i++) {
                initialStreamingMessages[i] = ""; // Initialize all slots with empty strings
              }
              setStreamingMessages(initialStreamingMessages);

              // Clear any previous completed messages with chat_id
              setMessages((prev) =>
                prev.filter(
                  (msg) =>
                    msg.role !== "assistant" || msg.chat_id === undefined,
                ),
              );
              break;

            case "stream_start":
              console.log(`Stream ${data.chat_id} started`);
              // Initialize streaming message for this chat
              if (data.chat_id !== undefined) {
                setStreamingMessages((prev) => ({
                  ...prev,
                  [data.chat_id]: "",
                }));
              }
              break;

            case "chunk":
              if (data.content && data.chat_id !== undefined) {
                console.log(
                  `Chunk for chat ${data.chat_id} received:`,
                  data.content.substring(0, 20) + "...",
                );
                // Append new content to streaming message for this chat
                setStreamingMessages((prev) => {
                  const prevContent = prev[data.chat_id!] || "";
                  return {
                    ...prev,
                    [data.chat_id!]: prevContent + data.content!,
                  };
                });
              }
              break;

            case "stream_end":
              console.log(`Stream ${data.chat_id} ended`);
              // Streaming ended, add the complete message
              if (data.content && data.chat_id !== undefined) {
                const newAssistantMessage: Message = {
                  role: "assistant",
                  content: data.content,
                  chat_id: data.chat_id,
                };
                setMessages((prev) => [...prev, newAssistantMessage]);

                // Clear streaming message for this chat
                setStreamingMessages((prev) => {
                  const newState = { ...prev };
                  delete newState[data.chat_id!];
                  return newState;
                });
              }
              break;

            case "all_complete":
              console.log(`All ${data.total} chats completed`);
              setLoading(false);
              break;

            case "error":
              console.error("Error from server:", data.error);
              // Show error message to the user
              const errorMessage: Message = {
                role: "assistant",
                content: `Sorry, there was an error: ${data.error || "Unknown error"}`,
                chat_id: data.chat_id,
              };
              setMessages((prev) => [...prev, errorMessage]);

              // Clear streaming message if chat_id is provided
              if (data.chat_id !== undefined) {
                setStreamingMessages((prev) => {
                  const newState = { ...prev };
                  delete newState[data.chat_id!];
                  return newState;
                });
              }

              // If this was the last active chat or a general error, set loading to false
              if (
                Object.keys(streamingMessages).length === 0 ||
                data.chat_id === undefined
              ) {
                setLoading(false);
              }
              break;

            default:
              console.warn("Unknown message type:", data);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      socketRef.current = socket;

      // Clean up function
      return () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      };
    };

    connectWebSocket();

    // Clean up on component unmount
    return () => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, []);

  const handleSendMessage = async (message: string, n: number = 1) => {
    if (!message.trim() || loading) return;

    // Ensure n is within allowed range
    n = Math.min(Math.max(1, n), MAX_CONCURRENT_CHATS);

    // Store n value for the UI
    setNumParallelChats(n);

    // Add user message to state
    const newUserMessage: Message = { role: "user", content: message };
    setMessages((prev) => [...prev, newUserMessage]);
    setLoading(true);

    // Clear any existing streaming messages
    setStreamingMessages({});

    try {
      // Use WebSocket if connected, otherwise fall back to fetch API
      if (connected && socketRef.current?.readyState === WebSocket.OPEN) {
        // Send message through WebSocket with n parameter
        const updatedMessages = [...messages, newUserMessage];
        socketRef.current.send(
          JSON.stringify({
            messages: updatedMessages,
            n: n,
          }),
        );
      } else {
        // Fall back to traditional REST API
        const updatedMessages = [...messages, newUserMessage];

        const response = await fetch("http://localhost:4000/chat_completion", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: updatedMessages,
            n: n,
          }),
          mode: "cors",
          credentials: "omit",
        });

        if (response.ok) {
          const data = await response.json();

          const newAssistantMessage: Message = {
            role: "assistant",
            content: data.response,
            chat_id: 0,
          };

          setMessages((prev) => [...prev, newAssistantMessage]);
        } else {
          const newAssistantMessage: Message = {
            role: "assistant",
            content:
              "Sorry, I'm having trouble connecting to the assistant service.",
          };

          setMessages((prev) => [...prev, newAssistantMessage]);
          console.warn("API returned error status:", response.status);
        }
        setLoading(false);
      }
    } catch (error) {
      console.error("Error sending message:", error);

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

            {/* WebSocket connection status */}
            <div
              className={`px-2 py-0.5 text-xs rounded-full font-serif ${connected ? "bg-accent-100 text-accent-800 dark:bg-accent-200 dark:text-accent-800" : "bg-red-100 text-red-800 dark:bg-red-100 dark:text-red-800"}`}
            >
              {connected ? "WebSocket Connected" : "WebSocket Disconnected"}
            </div>

            {/* Parallel chats selector */}
            <div className="ml-2 flex items-center space-x-2">
              <label
                htmlFor="parallelChats"
                className="text-xs text-accent-900 dark:text-accent-900 font-serif"
              >
                Parallel:
              </label>
              <select
                id="parallelChats"
                value={numParallelChats}
                onChange={(e) => setNumParallelChats(Number(e.target.value))}
                className="text-xs font-serif bg-white dark:bg-background-secondary border border-accent-300 dark:border-accent-300 rounded px-2 py-1 text-accent-900 dark:text-accent-900"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
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
          onSendMessage={(msg) => handleSendMessage(msg, numParallelChats)}
        />
      </div>
    </div>
  );
}
