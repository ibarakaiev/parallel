"use client";

import { useState, useEffect, useCallback } from "react";
import ChatInterface from "./components/ChatInterface";
import { Message } from "./types";

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentReasoningMessages, setCurrentReasoningMessages] = useState<
    Message[]
  >([]);
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
    console.log(
      "Streaming messages updated:",
      Object.keys(streamingMessages).map((key) =>
        key === "final_response"
          ? `final_response: ${streamingMessages[key]?.substring(0, 30)}...`
          : `${key}: ${typeof streamingMessages[key] === "string" ? streamingMessages[key]?.substring(0, 30) : "[object]"}`,
      ),
    );

    if (streamingMessages.final_response) {
      console.log(
        "Final response length:",
        streamingMessages.final_response.length,
      );
    }
  }, [streamingMessages]);

  // Initialize connection status
  useEffect(() => {
    setConnected(false);
  }, []);

  const toggleReasoningExpanded = () => {
    setReasoningExpanded(!reasoningExpanded);
  };

  // Handle processing SSE events

  const processSSEEvent = useCallback(
    (eventData: any) => {
      try {
        console.log("SSE data received:", eventData);

        switch (eventData.type) {
          case "thinking_start":
            console.log("Thinking started:", eventData.content);

            // Check if this is a main thinking step or a subtask
            const thinkingStep = eventData.metadata?.thinking_step || 1;
            const isSubtask = eventData.metadata?.subtask || false;

            if (thinkingStep === 1) {
              // This is the main decomposition step
              setDecomposing(true);

              // Replace the initial reasoning message with the actual content
              // from the server, so it continues streaming from here
              const reasoningMessage: Message = {
                role: "assistant",
                content: eventData.content || "Analyzing query...",
                is_reasoning: true,
                reasoning_step: thinkingStep,
                subject: "Query Analysis",
              };

              // Replace the initial reasoning message
              setCurrentReasoningMessages([reasoningMessage]);

              // Update the streaming content with the new data
              setStreamingMessages((prev) => ({
                ...prev,
                thinking: eventData.content || "Analyzing query...",
              }));
            } else if (isSubtask) {
              // This is a parallel subtask
              // If this is the first subtask, clear previous reasoning messages for this step
              const existingSubtasks = currentReasoningMessages.filter(
                (msg) =>
                  msg.reasoning_step === thinkingStep && msg.is_reasoning,
              );

              if (existingSubtasks.length === 0) {
                // Add a header message for this reasoning step
                const reasoningHeaderMessage: Message = {
                  role: "assistant",
                  content: "Processing parallel subtasks...",
                  is_reasoning: true,
                  reasoning_step: thinkingStep,
                  subject: "Parallel Processing",
                };
                // Only add to current reasoning for this request
                setCurrentReasoningMessages((prev) => [
                  ...prev,
                  reasoningHeaderMessage,
                ]);
              }

              // Initialize a streaming message for this subtask
              // This will make it show up immediately
              const taskIndex = eventData.metadata?.task_index;
              const taskSubject =
                eventData.metadata?.subject ||
                `Task ${taskIndex !== undefined ? taskIndex + 1 : ""}`;

              if (taskIndex !== undefined) {
                // Add the subtask subject to the task subjects
                setTaskSubjects((prev) => {
                  const newSubjects = [...prev];
                  newSubjects[taskIndex] = taskSubject;
                  return newSubjects;
                });

                // Initialize the streaming message for this subtask
                setStreamingMessages((prev) => ({
                  ...prev,
                  [taskIndex]: "",
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

              // Only set task subjects if they haven't been set yet by individual
              // thinking_start events for each subtask
              if (taskSubjects.length === 0) {
                setTaskSubjects(subjects);
              }

              // Update the reasoning message with the final content
              const updatedReasoningMessage: Message = {
                role: "assistant",
                content: eventData.content || "Query analyzed.",
                is_reasoning: true,
                reasoning_step: endThinkingStep,
                subject: "Query Analysis",
              };

              // Replace the thinking_start message with the complete content
              // Only update current reasoning messages for this request
              setCurrentReasoningMessages((prev) =>
                prev.map((msg) =>
                  msg.reasoning_step === endThinkingStep && !msg.chat_id
                    ? updatedReasoningMessage
                    : msg,
                ),
              );

              // Only initialize chat slots that haven't already been created
              // by individual thinking_start events
              const existingKeys = Object.keys(streamingMessages)
                .filter((key) => key !== "thinking")
                .map((key) => parseInt(key));

              const initialStreamingMessages: Record<number, string> = {
                ...streamingMessages,
              };
              delete initialStreamingMessages.thinking; // Remove the thinking property

              // Create empty slots for missing tasks
              for (let i = 0; i < taskCount; i++) {
                if (!existingKeys.includes(i)) {
                  initialStreamingMessages[i] = ""; // Initialize slots that don't exist yet
                }
              }

              // Keep the thinking property
              initialStreamingMessages.thinking = streamingMessages.thinking;
              setStreamingMessages(initialStreamingMessages);

              // End the decomposing state
              setDecomposing(false);

              // Clear any previous completed messages that should be replaced
              setMessages((prev) =>
                prev.filter(
                  (msg) =>
                    msg.role !== "assistant" || msg.is_final_response === true, // Keep final responses
                ),
              );
            } else if (endIsSubtask) {
              // This is the end of a parallel subtask thinking step
              const taskIndex = eventData.metadata?.task_index;
              const subject =
                eventData.metadata?.subject ||
                `Task ${taskIndex !== undefined ? taskIndex + 1 : ""}`;

              if (eventData.content && taskIndex !== undefined) {
                // Create a reasoning message for this subtask result
                const subtaskReasoningMessage: Message = {
                  role: "assistant",
                  content: eventData.content,
                  is_reasoning: true,
                  reasoning_step: endThinkingStep,
                  subject: subject,
                  chat_id: taskIndex,
                };

                // Add only to current reasoning messages
                setCurrentReasoningMessages((prev) => [
                  ...prev,
                  subtaskReasoningMessage,
                ]);

                // Don't clear streaming message for this task yet
                // Keep it visible to preserve streaming appearance
                // The final response will clear all streaming messages
              }
            }
            break;

          case "content_chunk":
            // Handle content chunk for subtask reasoning
            const chatIndex = eventData.metadata?.task_index;
            const isReasoningChunk =
              eventData.metadata?.thinking_step !== undefined;
            const thinkingChunk = eventData.metadata?.is_thinking;

            // Check if this is a final response chunk (the backend will mark these with is_final_response)
            // This is VERY IMPORTANT for streaming the final synthesis!
            const isFinalResponseChunk =
              eventData.metadata?.is_final_response === true;

            if (eventData.content) {
              console.log(
                "Content chunk metadata:",
                eventData.metadata,
                "isFinalResponse:",
                isFinalResponseChunk,
              );

              if (thinkingChunk) {
                // This is a chunk for the thinking/reasoning step
                console.log(
                  "Thinking chunk received:",
                  eventData.content.substring(0, 20) + "...",
                );

                // Update the reasoning message content
                setCurrentReasoningMessages((prev) => {
                  // Find the first reasoning message and update it
                  if (prev.length > 0 && prev[0].is_reasoning) {
                    const updatedMessages = [...prev];
                    updatedMessages[0] = {
                      ...updatedMessages[0],
                      content: updatedMessages[0].content + eventData.content,
                    };
                    return updatedMessages;
                  }
                  return prev;
                });

                // Also update the streaming display for thinking
                setStreamingMessages((prev) => {
                  const prevThinking = prev.thinking || "";
                  return {
                    ...prev,
                    thinking: prevThinking + eventData.content,
                  };
                });
              } else if (isFinalResponseChunk) {
                // This is a chunk for the final response - stream it
                console.log(
                  "Final response chunk received:",
                  eventData.content.substring(0, 20) + "...",
                );

                // Create a streaming final response if it doesn't exist yet
                // Always put final response chunks into the streaming UI
                console.log(
                  "Final response chunk length:",
                  eventData.content.length,
                );

                // For debugging - show the first 50 chars
                console.log(
                  "Content sample:",
                  eventData.content.substring(0, 50),
                );

                // Add or append to the final response streaming content
                setStreamingMessages((prev) => {
                  const prevFinalResponse = prev.final_response || "";
                  // Important: Only keep thinking and final_response properties to ensure proper streaming
                  // This creates a new object with only these two properties
                  return {
                    thinking: prev.thinking,
                    final_response: prevFinalResponse + eventData.content,
                  };
                });
              } else if (chatIndex !== undefined) {
                // This is a content chunk for a specific subtask
                // We DON'T stream subtask content, just store the full response when complete
                console.log(
                  `Content for subtask ${chatIndex} received - not streaming`,
                  eventData.content.substring(0, 20) + "...",
                );

                // Store just the task subjects, but not the content
              }
            }
            break;

          case "final_response":
            console.log("Final synthesized response received");

            // Treat this exactly like a content chunk for the final response
            if (eventData.content) {
              // Stream this response chunk
              console.log(
                "Streaming final response:",
                eventData.content.substring(0, 20) + "...",
              );

              // Add as a streaming chunk, append to existing final_response if any
              setStreamingMessages((prev) => {
                const prevFinalResponse = prev.final_response || "";
                // Important: Only keep thinking and final_response properties to ensure clean streaming
                // This completely replaces the previous state with only these two properties
                return {
                  thinking: prev.thinking,
                  final_response: prevFinalResponse + eventData.content,
                };
              });
            }
            break;

          case "stream_start":
            // Handle stream start events
            console.log("Stream start event:", eventData);

            // If this is a final response stream, prepare the final_response property
            if (eventData.metadata?.is_final_response === true) {
              console.log("Starting to stream final response");

              // Initialize the streaming final response if it doesn't exist yet
              setStreamingMessages((prev) => ({
                ...prev,
                final_response: "", // Initialize with empty string so we can append to it
              }));
            }
            break;

          case "metadata":
            if (eventData.metadata?.status === "all_complete") {
              console.log(
                `All ${eventData.metadata.task_count} tasks completed`,
              );

              setTimeout(() => {
                // If we have a streaming final response, add it to messages and clear streaming
                if (streamingMessages.final_response) {
                  const finalResponseMessage: Message = {
                    role: "assistant",
                    content: streamingMessages.final_response,
                    is_final_response: true,
                  };

                  // Add streamed final response to messages
                  setMessages((prev) => {
                    // Remove any previous final responses
                    const filteredMessages = prev.filter(
                      (msg) => !msg.is_final_response,
                    );
                    return [...filteredMessages, finalResponseMessage];
                  });

                  // Create a copy of the reasoningMessages to preserve them
                  const reasoningCopy = [...currentReasoningMessages];

                  // First set loading to false to hide the cursor
                  setLoading(false);

                  // Then clear streaming messages to end the streaming state
                  // Use a small timeout to ensure the cursor disappears first
                  setTimeout(() => {
                    setStreamingMessages({});

                    // Keep the reasoning messages so they persist in the UI
                    setCurrentReasoningMessages(reasoningCopy);
                  }, 100);
                } else {
                  // Mark loading as complete
                  setLoading(false);
                }
              }, 500); // Small delay to ensure all final content is received

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
    },
    [streamingMessages, currentReasoningMessages],
  );

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || loading) return;

    // Add user message to state
    const newUserMessage: Message = { role: "user", content: message };
    setMessages((prev) => [...prev, newUserMessage]);
    setLoading(true);

    // Clear any existing streaming messages for the new query
    // But immediately create a new one with a thinking property to show the dropdown
    setStreamingMessages({ thinking: "Analyzing your query..." });

    // Initialize a reasoning message immediately to show thinking dropdown
    const initialReasoningMessage: Message = {
      role: "assistant",
      content: "Analyzing your query...",
      is_reasoning: true,
      reasoning_step: 1,
      subject: "Query Analysis",
    };
    setCurrentReasoningMessages([initialReasoningMessage]);

    // Auto-expand reasoning when starting a new query
    setReasoningExpanded(true);

    // Reset connection state
    setConnected(false);

    try {
      // Create the conversation history including the new message
      // First gather all past messages, filtering out reasoning and parallel task messages
      const conversationMessages = messages.filter(
        (msg) =>
          // Keep user messages
          msg.role === "user" ||
          // Keep assistant messages that are final responses or regular responses
          (msg.role === "assistant" &&
            (msg.is_final_response === true ||
              (!msg.is_reasoning && msg.chat_id === undefined))),
      );

      // Keep the full chronological order of messages
      const updatedMessages = [...conversationMessages, newUserMessage];
      console.log("Conversation history:", updatedMessages);

      // Use fetch to create a streaming response
      const apiUrl = "http://localhost:4000/v1/messages";
      // Use Haiku model
      const model = "anthropic.haiku-1-Claude-Haiku-20240307";

      // For API requests, we need to pass the full conversation history
      // Only filter out intermediate reasoning messages but keep the proper sequential order

      // Start with all messages (user + final assistant responses)
      const messageBody = updatedMessages
        .filter(
          (msg) =>
            // Include all user messages
            msg.role === "user" ||
            // Include only final assistant responses or regular assistant messages (no reasoning or parallel chat)
            (msg.role === "assistant" &&
              (msg.is_final_response === true ||
                (!msg.is_reasoning && msg.chat_id === undefined))),
        )
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Log the full message body for debugging
      console.log("Final messageBody to send to API:", messageBody);

      // Log the full API request for debugging
      console.log("FULL API REQUEST:", {
        url: apiUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            messages: messageBody,
            model: model,
            stream: true,
          },
          null,
          2,
        ),
      });

      // Make the POST request directly
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messageBody,
          model: model,
          stream: true,
        }),
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
            const { done, value } = await reader.read();

            if (done) {
              console.log("Stream complete");
              setLoading(false);
              break;
            }

            // Decode the chunk and add to buffer
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Process complete SSE messages from the buffer
            const lines = buffer.split("\n\n");
            buffer = lines.pop() || ""; // Keep the last incomplete chunk in the buffer

            for (const line of lines) {
              if (line.startsWith("data: ")) {
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
            content: "Sorry, there was an error processing the stream.",
          };
          setMessages((prev) => [...prev, errorMessage]);
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
          <h1 className="text-lg font-bold text-accent-900 dark:text-accent-900 font-serif">
            Parallel
          </h1>
        </div>
        <div className="p-3">
          <button className="flex items-center px-3 py-2 text-sm text-accent-900 dark:text-accent-900 rounded bg-accent-100 dark:bg-accent-100 w-full justify-between group font-sans">
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
          </div>

          <div className="flex items-center gap-2">
            {/* Empty div to maintain header layout */}
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
