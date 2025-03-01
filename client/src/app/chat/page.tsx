'use client';

import { useState, useEffect, useRef } from 'react';
import ChatInterface from './components/ChatInterface';
import { Message, WebSocketMessage } from './types';

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! How can I help you today?' }
  ]);
  const [loading, setLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  
  const socketRef = useRef<WebSocket | null>(null);
  
  // Debug streaming message changes
  useEffect(() => {
    console.log("Streaming message updated:", streamingMessage);
  }, [streamingMessage]);

  // Connect to WebSocket
  useEffect(() => {
    const connectWebSocket = () => {
      console.log('Connecting to WebSocket...');
      
      const socket = new WebSocket('ws://localhost:4000/ws/chat');
      
      socket.onopen = () => {
        console.log('WebSocket connected successfully');
        setConnected(true);
      };
      
      socket.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        setConnected(false);
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (socketRef.current?.readyState !== WebSocket.OPEN) {
            console.log('Attempting to reconnect...');
            connectWebSocket();
          }
        }, 3000);
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      socket.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          console.log('Parsed WebSocket message:', data);
          
          switch (data.type) {
            case 'stream_start':
              console.log('Stream started');
              // Streaming started, initialize streaming message
              setStreamingMessage('');
              break;
              
            case 'chunk':
              if (data.content) {
                console.log('Chunk received:', data.content.substring(0, 20) + '...');
                // Append new content to streaming message
                setStreamingMessage(prev => {
                  const newContent = prev !== null ? prev + data.content : data.content;
                  console.log('Updated streaming message:', newContent.length, 'chars');
                  return newContent;
                });
              }
              break;
              
            case 'stream_end':
              console.log('Stream ended');
              // Streaming ended, add the complete message
              if (data.content) {
                const newAssistantMessage: Message = {
                  role: 'assistant',
                  content: data.content
                };
                setMessages(prev => [...prev, newAssistantMessage]);
              } else if (streamingMessage && streamingMessage.length > 0) {
                // If no content is provided but we have a streaming message, use that
                const newAssistantMessage: Message = {
                  role: 'assistant',
                  content: streamingMessage
                };
                setMessages(prev => [...prev, newAssistantMessage]);
              }
              setStreamingMessage(null);
              setLoading(false);
              break;
              
            case 'error':
              console.error('Error from server:', data.error);
              // Show error message to the user
              const errorMessage: Message = {
                role: 'assistant',
                content: `Sorry, there was an error: ${data.error || 'Unknown error'}`
              };
              setMessages(prev => [...prev, errorMessage]);
              setStreamingMessage(null);
              setLoading(false);
              break;
              
            default:
              console.warn('Unknown message type:', data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
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

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || loading) return;

    // Add user message to state
    const newUserMessage: Message = { role: 'user', content: message };
    setMessages(prev => [...prev, newUserMessage]);
    setLoading(true);

    try {
      // Use WebSocket if connected, otherwise fall back to fetch API
      if (connected && socketRef.current?.readyState === WebSocket.OPEN) {
        // Send message through WebSocket
        const updatedMessages = [...messages, newUserMessage];
        socketRef.current.send(JSON.stringify({ messages: updatedMessages }));
      } else {
        // Fall back to traditional REST API
        const updatedMessages = [...messages, newUserMessage];
        
        const response = await fetch('http://localhost:4000/chat_completion', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            messages: updatedMessages
          }),
          mode: 'cors',
          credentials: 'omit',
        });

        if (response.ok) {
          const data = await response.json();
          
          const newAssistantMessage: Message = { 
            role: 'assistant', 
            content: data.response 
          };
          
          setMessages(prev => [...prev, newAssistantMessage]);
        } else {
          const newAssistantMessage: Message = { 
            role: 'assistant', 
            content: "Sorry, I'm having trouble connecting to the assistant service." 
          };
          
          setMessages(prev => [...prev, newAssistantMessage]);
          console.warn('API returned error status:', response.status);
        }
        setLoading(false);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      const newAssistantMessage: Message = { 
        role: 'assistant', 
        content: "Sorry, I'm having trouble reaching the assistant service. Please try again later." 
      };
      
      setMessages(prev => [...prev, newAssistantMessage]);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden sm:block">
        <div className="h-14 border-b border-gray-200 dark:border-gray-800 px-4 flex items-center">
          <h1 className="text-lg font-medium text-gray-900 dark:text-gray-100">Parallel</h1>
        </div>
        <div className="p-3">
          <button className="flex items-center px-3 py-2 text-sm text-gray-800 dark:text-gray-200 rounded bg-gray-100 dark:bg-gray-800 w-full justify-between group">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-800 dark:text-gray-200">
                <path d="M13.5 3H2.5C2.22386 3 2 3.22386 2 3.5V12.5C2 12.7761 2.22386 13 2.5 13H13.5C13.7761 13 14 12.7761 14 12.5V3.5C14 3.22386 13.7761 3 13.5 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M2 6H14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M5.5 9.5H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Chat</span>
            </div>
            <span className="text-xs py-0.5 px-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">1</span>
          </button>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button className="sm:hidden p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-800 dark:text-gray-200">
                <path d="M3 6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M3 12H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Chat Assistant</h2>
            
            {/* WebSocket connection status */}
            <div className={`px-2 py-0.5 text-xs rounded-full ${connected ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
              {connected ? 'WebSocket Connected' : 'WebSocket Disconnected'}
            </div>
            
            {/* Test button */}
            <button 
              onClick={() => {
                if (connected && socketRef.current?.readyState === WebSocket.OPEN) {
                  console.log("Sending test ping to WebSocket");
                  socketRef.current.send(JSON.stringify({
                    messages: [
                      { role: "user", content: "Just a test ping" }
                    ]
                  }));
                } else {
                  console.log("Cannot send test: WebSocket not connected");
                  alert("WebSocket not connected!");
                }
              }}
              className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded"
            >
              Test WS
            </button>
          </div>
          
          <div className="flex items-center gap-2">
            <button className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-700 dark:text-gray-300">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 8V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M8 12H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="h-6 w-6 rounded-full bg-accent-500 flex items-center justify-center text-white text-xs font-medium">
              U
            </div>
          </div>
        </header>
        
        <ChatInterface 
          messages={messages}
          loading={loading}
          streamingMessage={streamingMessage}
          onSendMessage={handleSendMessage}
        />
      </div>
    </div>
  );
}