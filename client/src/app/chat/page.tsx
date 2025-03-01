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
  const [taskOutputs, setTaskOutputs] = useState<Record<number, string>>({});
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

              // Add task subjects to both taskSubjects (for backward compatibility)
              // and also to reasoningMessages for iteration tracking
              if (taskSubjects.length === 0) {
                setTaskSubjects(subjects);
                
                // Also add task placeholders to reasoningMessages for improved tracking
                const taskPlaceholders = subjects.map((subject, idx) => ({
                  role: "assistant" as const,
                  content: "",  // Empty content, we don't need to show this
                  is_reasoning: true,
                  chat_id: idx,  // Use the index as chat_id
                  subject: subject,
                  metadata: {
                    rebranch_iteration: 0,  // Initial tasks are iteration 0
                    is_task: true  // Flag to indicate this is a task placeholder
                  }
                }));
                
                // Add these placeholders to current reasoning messages
                setCurrentReasoningMessages(prev => [...prev, ...taskPlaceholders]);
              }

              // Update the reasoning message with the final content
              const updatedReasoningMessage: Message = {
                role: "assistant",
                content: eventData.content || "Query analyzed.",
                is_reasoning: true,
                reasoning_step: endThinkingStep,
                subject: "Query Analysis",
              };
              
              // Also add a subtasks header for the initial set of tasks
              const initialSubtasksHeader: Message = {
                role: "assistant",
                content: "Breaking down the query into initial subtasks for parallel processing.",
                is_reasoning: true,
                reasoning_step: endThinkingStep,
                subject: "Initial Subtasks",
                metadata: {
                  rebranch_iteration: 0,
                  is_subtasks_header: true
                }
              };

              // Replace the thinking_start message with the complete content and add the subtasks header
              // Only update current reasoning messages for this request
              setCurrentReasoningMessages((prev) => {
                // First map to replace the analysis message
                const updatedMessages = prev.map((msg) =>
                  msg.reasoning_step === endThinkingStep && !msg.chat_id
                    ? updatedReasoningMessage
                    : msg
                );
                
                // Then add the subtasks header message
                return [...updatedMessages, initialSubtasksHeader];
              });

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
              // Get the iteration for this subtask
              const subtaskIteration = eventData.metadata?.rebranch_iteration || 0;

              if (eventData.content && taskIndex !== undefined) {
                // First check if we already have a task placeholder for this task
                const existingPlaceholder = currentReasoningMessages.find(msg => 
                  msg.metadata?.is_task === true && 
                  msg.metadata.rebranch_iteration === subtaskIteration && 
                  msg.chat_id === taskIndex
                );
                
                // If no placeholder exists, create one to ensure proper task tracking
                if (!existingPlaceholder) {
                  // Create a task placeholder first
                  const taskPlaceholder: Message = {
                    role: "assistant",
                    content: "",  // Empty content, just for tracking
                    is_reasoning: true,
                    chat_id: taskIndex,
                    subject,
                    metadata: {
                      rebranch_iteration: subtaskIteration,
                      is_task: true  // Flag to indicate this is a task placeholder
                    }
                  };
                  
                  // Add the placeholder to reasoning messages
                  setCurrentReasoningMessages(prev => [...prev, taskPlaceholder]);
                }
                
                // Create a reasoning message for this subtask result
                // Include iteration number in the subject for clarity
                const iterationText = subtaskIteration > 0 ? ` (Round ${subtaskIteration + 1})` : "";
                const subtaskReasoningMessage: Message = {
                  role: "assistant",
                  content: eventData.content,
                  is_reasoning: true,
                  reasoning_step: endThinkingStep,
                  subject: `${subject}${iterationText}`,
                  chat_id: taskIndex,
                  // Store the iteration information
                  metadata: {
                    rebranch_iteration: subtaskIteration
                  }
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
                const subtaskIteration = eventData.metadata?.rebranch_iteration || 0;
                
                // Create a unique identifier for this task based on both index and iteration
                // This ensures we don't mix tasks from different iterations
                const taskKey = `${subtaskIteration}-${chatIndex}`;
                
                console.log(
                  `Content for subtask ${chatIndex} (iteration ${subtaskIteration}) received - storing as ${taskKey}`,
                  eventData.content.substring(0, 20) + "...",
                );

                // Store or append to task output
                setTaskOutputs(prev => {
                  const currentOutput = prev[taskKey] || "";
                  return {
                    ...prev,
                    [taskKey]: currentOutput + eventData.content
                  };
                });
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

          case "rebranch_start":
            console.log("Rebranching started:", eventData);
            
            // Get the iteration and promising paths
            const rebranch_iteration = eventData.metadata?.rebranch_iteration || 0;
            const promising_paths = eventData.metadata?.promising_paths || [];
            
            // Create a message for rebranching with a special flag marking this as a section header
            const rebranch_message: Message = {
              role: "assistant",
              content: eventData.content || "Exploring promising paths further...",
              is_reasoning: true,
              reasoning_step: 3 + rebranch_iteration,
              subject: `Round ${rebranch_iteration + 1} Analysis`,
              metadata: {
                rebranch_iteration: rebranch_iteration,
                is_section_header: true  // Special flag to indicate this is a section header
              }
            };
            
            // Add the rebranch message to reasoning messages
            setCurrentReasoningMessages(prev => [...prev, rebranch_message]);
            
            // If there are promising paths, display them
            if (promising_paths.length > 0) {
              const paths_list = promising_paths.map((path, idx) => `${idx + 1}. ${path}`).join("\n");
              const paths_message: Message = {
                role: "assistant",
                content: `Promising paths to explore:\n${paths_list}`,
                is_reasoning: true,
                reasoning_step: 3 + rebranch_iteration,
                subject: "Promising Paths"
              };
              
              // Add the paths message to reasoning messages
              setCurrentReasoningMessages(prev => [...prev, paths_message]);
            }
            break;
            
          case "rebranch_end":
            console.log("Rebranching completed:", eventData);
            
            // Get the iteration and new tasks
            const rebranch_end_iteration = eventData.metadata?.rebranch_iteration || 0;
            const new_tasks = eventData.metadata?.new_tasks || [];
            
            // Create a message showing the new direction with a special flag marking this as a subtasks header
            const rebranch_end_message: Message = {
              role: "assistant",
              content: eventData.content || "Continuing with new exploration paths...",
              is_reasoning: true,
              reasoning_step: 3 + rebranch_end_iteration,
              subject: `Round ${rebranch_end_iteration + 1} Subtasks`,
              metadata: {
                rebranch_iteration: rebranch_end_iteration,
                is_subtasks_header: true  // Special flag to indicate this is a new subtasks header
              }
            };
            
            // Add the rebranch end message to reasoning messages
            setCurrentReasoningMessages(prev => [...prev, rebranch_end_message]);
            
            // If there are new tasks, store them with their iteration info in the reasoningMessages
            // but DON'T update taskSubjects (we'll derive tasks from reasoningMessages)
            if (new_tasks.length > 0) {
              // For each new task, create a placeholder message that will help us track it
              const newTaskMessages = new_tasks.map((subject, idx) => ({
                role: "assistant" as const,
                content: "",  // Empty content, we don't need to show this
                is_reasoning: true,
                chat_id: idx,  // Use the index as chat_id
                subject: subject,
                metadata: {
                  rebranch_iteration: rebranch_end_iteration,
                  is_task: true  // Flag to indicate this is a task placeholder
                }
              }));
              
              // Add these task placeholders to the reasoning messages
              setCurrentReasoningMessages(prev => [...prev, ...newTaskMessages]);
              
              // Log for debugging
              console.log(`Added ${newTaskMessages.length} new task placeholders for iteration ${rebranch_end_iteration}`);
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
            stream: false,
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
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // For non-streaming response, parse the JSON directly
      const responseData = await response.json();
      console.log("Non-streaming response FULL:", JSON.stringify(responseData, null, 2));
      
      // Extra debug for the raw response shape
      console.log("Response structure:", {
        type: responseData.type,
        role: responseData.role,
        content: Array.isArray(responseData.content) ? 
          `Array with ${responseData.content.length} items` : 
          typeof responseData.content
      });
      
      // Log specific parts of the response for easier debugging
      if (responseData.content) {
        // Ensure content is an array
        const contentArray = Array.isArray(responseData.content) ? 
          responseData.content : 
          [{ type: "text", text: typeof responseData.content === 'string' ? responseData.content : JSON.stringify(responseData.content) }];
        
        console.log("Response content types:", contentArray.map(item => item?.type));
        
        // Replace responseData.content with the array if needed
        if (!Array.isArray(responseData.content)) {
          console.warn("Converting non-array content to array format");
          responseData.content = contentArray;
        }
        
        // Log thinking and branches sections if they exist
        const thinkingItem = responseData.content.find(item => item?.type === "thinking");
        if (thinkingItem) {
          console.log("Thinking item:", thinkingItem);
        }
        
        const branchesItem = responseData.content.find(item => item?.type === "branches");
        if (branchesItem) {
          console.log("Branches count:", branchesItem.branches?.length || 0);
        }
      }
      
      try {
        // Extract all thinking and branches items from the content array
        const thinkingItems = responseData.content.filter(item => item?.type === "thinking");
        const branchesItems = responseData.content.filter(item => item?.type === "branches");
        
        // IMPORTANT: Create an initial thinking message if we don't have any to ensure the dropdown appears
        if (thinkingItems.length === 0) {
          console.log("No thinking items found in response - creating a default one");
          const defaultThinking = {
            type: "thinking",
            thinking: "Analysis complete.",
            signature: "default"
          };
          thinkingItems.push(defaultThinking);
        }
        
        // Find the text content (final response)
        const textContent = responseData.content.find(item => item?.type === "text");
        const finalResponseContent = textContent?.text || "No response text found";
        
        // Log if we couldn't find the text content
        if (!textContent) {
          console.warn("No 'text' type item found in content array. Raw content:", responseData.content);
        }
        
        console.log("Processing response with:", {
          thinkingItems: thinkingItems.length + " items",
          branchesItems: branchesItems.length + " items",
          finalText: finalResponseContent.substring(0, 50) + "..."
        });
        
        // Get the initial thinking content (first thinking item)
        const initialThinking = thinkingItems.length > 0 ? thinkingItems[0].thinking : "";
        
        // Collect all branches across all branch items
        const allBranches = [];
        branchesItems.forEach(branchItem => {
          if (branchItem.branches && Array.isArray(branchItem.branches)) {
            allBranches.push(...branchItem.branches);
          }
        });
        
        console.log(`Found ${allBranches.length} total branches across ${branchesItems.length} branch items`);
        
        // Create a new assistant message with the final response
        const finalResponseMessage: Message = {
          role: "assistant",
          content: finalResponseContent,
          is_final_response: true,
        };
        
        // Create reasoning messages from all thinking items
        if (thinkingItems.length > 0 || branchesItems.length > 0) {
          // Check if we already have an initial reasoning message
          const existingReasoningMessages = [...currentReasoningMessages];
          console.log("Existing reasoning messages:", existingReasoningMessages);
          
          const reasoningMessages: Message[] = [];
          
          // Ensure we have at least one thinking message
          if (thinkingItems.length > 0) {
            // Create a reasoning message for each thinking item
            thinkingItems.forEach((thinkingItem, index) => {
              const reasoningMessage: Message = {
                role: "assistant",
                content: thinkingItem.thinking,
                is_reasoning: true,
                reasoning_step: index + 1,
                subject: index === 0 ? "Query Analysis" : `Evaluation (Step ${index + 1})`,
                metadata: {
                  rebranch_iteration: index
                }
              };
              
              reasoningMessages.push(reasoningMessage);
            });
          } else {
            // If no thinking items but we have branches, add a default thinking message
            const defaultThinking: Message = {
              role: "assistant",
              content: "Analyzing your query with multiple approaches...",
              is_reasoning: true,
              reasoning_step: 1,
              subject: "Query Analysis",
              metadata: {
                rebranch_iteration: 0
              }
            };
            reasoningMessages.push(defaultThinking);
          }
          
          // Create section header messages for each branch set
          branchesItems.forEach((branchItem, index) => {
            const headerMessage: Message = {
              role: "assistant",
              content: `Analyzing with parallel subtasks (Iteration ${index + 1})`,
              is_reasoning: true,
              reasoning_step: index + 1,
              subject: `Iteration ${index + 1} Subtasks`,
              metadata: {
                rebranch_iteration: index,
                is_subtasks_header: true
              }
            };
            
            // Insert header message at appropriate position
            reasoningMessages.push(headerMessage);
            
            // Add specific task section headers
            const branches = branchItem.branches || [];
            if (branches.length > 0) {
              console.log(`Adding section header for ${branches.length} branches in iteration ${index}`);
            }
          });
          
          // We'll populate this array as we go through each branch set
          const allTaskPlaceholders: Message[] = [];
          const allOutputs: Record<string, string> = {};
          
          // Process each branch item separately, preserving iteration information
          branchesItems.forEach((branchItem, iterationIndex) => {
            const branches = branchItem.branches || [];
            if (branches.length === 0) return;
            
            console.log(`Processing ${branches.length} branches for iteration ${iterationIndex}`);
            
            // Process branches from this iteration
            branches.forEach((branch, idx) => {
              // Use the branch index if provided, otherwise use array index
              const taskIndex = branch.index !== undefined ? branch.index : idx;
              
              // Create a unique key for this task output that includes the iteration
              const taskKey = `${iterationIndex}-${taskIndex}`;
              
              // Store the task content
              allOutputs[taskKey] = branch.content || `Task ${taskIndex + 1} content`;
              
              // Create a task placeholder message for improved tracking
              const placeholder: Message = {
                role: "assistant",
                content: "",
                is_reasoning: true,
                chat_id: taskIndex,
                subject: branch.subject || `Task ${taskIndex + 1}`,
                metadata: {
                  rebranch_iteration: iterationIndex,
                  is_task: true
                }
              };
              
              allTaskPlaceholders.push(placeholder);
            });
          });
          
          // Log the task placeholders we've created
          console.log(`Created ${allTaskPlaceholders.length} task placeholders across all iterations`);
          
          // Add all task placeholders to reasoning messages
          const finalReasoningMessages = [...reasoningMessages, ...allTaskPlaceholders];
          
          // IMPORTANT: Don't completely replace reasoning messages - keep at least one for the dropdown
          // If there are no messages, make sure we have at least one
          if (finalReasoningMessages.length === 0) {
            // Add a default thinking message if we don't have any
            const defaultThinking: Message = {
              role: "assistant",
              content: "Analysis complete.",
              is_reasoning: true,
              reasoning_step: 1,
              subject: "Query Analysis"
            };
            
            finalReasoningMessages.push(defaultThinking);
          }
          
          console.log(`Setting ${finalReasoningMessages.length} reasoning messages`);
          
          // Update the current reasoning messages - don't completely replace since we need the dropdown
          setCurrentReasoningMessages(prevMessages => {
            // If we have no previous messages, use our new ones
            if (!prevMessages || prevMessages.length === 0) {
              return finalReasoningMessages;
            }
            
            // If we have final messages, completely replace
            if (finalReasoningMessages.length > 0) {
              return finalReasoningMessages;
            }
            
            // Otherwise keep the previous messages to preserve the dropdown
            return prevMessages;
          });
          
          // Extract task subjects for display
          const allSubjects = allTaskPlaceholders.map(placeholder => placeholder.subject || "");
          
          if (allSubjects.length > 0) {
            console.log("Setting task subjects:", allSubjects);
            setTaskSubjects(allSubjects);
          }
          
          // Set task outputs for all branches
          if (Object.keys(allOutputs).length > 0) {
            console.log("Setting task outputs with keys:", Object.keys(allOutputs));
            setTaskOutputs(allOutputs);
          }
        }
        
        // Add the final response message to the messages state
        setMessages((prev) => {
          // Remove any previous final responses
          const filteredMessages = prev.filter(
            (msg) => !msg.is_final_response,
          );
          return [...filteredMessages, finalResponseMessage];
        });
        
        // Make sure we always have a thinking message to show the dropdown
        const displayThinking = initialThinking || "Analysis complete.";
        
        // Set streaming messages to include the final response and the first thinking item
        // This will make it show up in the UI
        setStreamingMessages({
          thinking: displayThinking,
          final_response: finalResponseContent
        });
        
        // Debug reasoning messages
        console.log("Current reasoning messages:", currentReasoningMessages);
        
        // CRITICAL: Make sure we always have at least one reasoning message to ensure the dropdown appears
        if (currentReasoningMessages.length === 0) {
          const defaultReasoningMessage: Message = {
            role: "assistant",
            content: "Analysis complete.",
            is_reasoning: true,
            reasoning_step: 1,
            subject: "Query Analysis"
          };
          setCurrentReasoningMessages([defaultReasoningMessage]);
          console.log("Added default reasoning message because the array was empty");
        }
        
        // Auto expand reasoning to show the thinking and tasks
        setReasoningExpanded(true);
        
        // No need for additional debug info here as we have comprehensive logging above
        
        // Wait a moment to ensure the UI shows the response properly
        setTimeout(() => {
          // Keep loading false but preserve the thinking message
          setLoading(false);
          
          // Very important: Keep a minimal streaming state to ensure the dropdown remains visible
          const prevStreaming = { ...streamingMessages };
          if (!prevStreaming.thinking) {
            prevStreaming.thinking = "Analysis complete.";
          }
          
          // Keep essential parts of the streaming message
          setStreamingMessages({
            thinking: prevStreaming.thinking,
            final_response: finalResponseContent
          });
          
          console.log("Timeout complete, preserved streaming messages for dropdown visibility");
        }, 500);
      } catch (error) {
        console.error("Error processing non-streaming response:", error);
        setLoading(false);
        
        // Show error message
        const errorMessage: Message = {
          role: "assistant",
          content: "Sorry, there was an error processing the response.",
        };
        setMessages((prev) => [...prev, errorMessage]);
      }

      // Indicate connection is active
      setConnected(true);

      // Response processing is complete for non-streaming mode
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
          taskOutputs={taskOutputs}
          reasoningMessages={currentReasoningMessages}
          reasoningExpanded={reasoningExpanded}
          toggleReasoningExpanded={toggleReasoningExpanded}
        />
      </div>
    </div>
  );
}
