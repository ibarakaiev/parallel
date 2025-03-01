'use client';

import { useState } from 'react';
import ChatInterface from './components/ChatInterface';
import { Message } from './types';

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! How can I help you today?' }
  ]);
  const [loading, setLoading] = useState(false);

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;

    // Add user message to state
    const newUserMessage: Message = { role: 'user', content: message };
    setMessages(prev => [...prev, newUserMessage]);
    setLoading(true);

    try {
      // Get the updated messages array that includes the new user message
      const updatedMessages = [...messages, newUserMessage];
      
      // Send the entire conversation history to the backend
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

      // If the response is ok, try to parse the JSON
      if (response.ok) {
        const data = await response.json();
        
        // Add assistant response to state
        const newAssistantMessage: Message = { 
          role: 'assistant', 
          content: data.response 
        };
        
        setMessages(prev => [...prev, newAssistantMessage]);
      } else {
        // If response is not ok, show an error message
        const newAssistantMessage: Message = { 
          role: 'assistant', 
          content: "Sorry, I'm having trouble connecting to the assistant service." 
        };
        
        setMessages(prev => [...prev, newAssistantMessage]);
        console.warn('API returned error status:', response.status);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Fallback to error response when API is unavailable
      const newAssistantMessage: Message = { 
        role: 'assistant', 
        content: "Sorry, I'm having trouble reaching the assistant service. Please try again later." 
      };
      
      setMessages(prev => [...prev, newAssistantMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-700 py-4 px-6">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white">Chat Assistant</h1>
      </header>
      
      <ChatInterface 
        messages={messages}
        loading={loading}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
}