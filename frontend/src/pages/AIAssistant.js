import React, { useState, useEffect } from 'react';
import { Send, FileText, Bot, AlertCircle, Sparkles, CheckCircle } from 'lucide-react';
import './AIAssistant.css';

function AIAssistant() {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchDocuments(activeWorkspaceId);
    fetchConversations(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const fetchWorkspaces = async () => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to load workspaces');
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setWorkspaces(items);

      if (items.length > 0) {
        setActiveWorkspaceId(items[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load workspaces');
    }
  };

  const fetchDocuments = async (workspaceId) => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/documents`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to load documents');
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.documents) ? data.documents : [];
      setDocuments(items);
      setSelectedDocuments([]);
    } catch (err) {
      setError(err.message || 'Failed to load documents');
    }
  };

  const fetchConversations = async (workspaceId) => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}/api/v1/conversations/${workspaceId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to load conversations');
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setConversations(items);

      if (items.length > 0) {
        setActiveConversation(items[0]);
        fetchConversationMessages(workspaceId, items[0].id);
      } else {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load conversations');
    }
  };

  const fetchConversationMessages = async (workspaceId, conversationId) => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}/api/v1/conversations/${workspaceId}/${conversationId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to load messages');
      }

      const data = await response.json();
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (err) {
      setError(err.message || 'Failed to load messages');
    }
  };

  const createConversation = async (workspaceId) => {
    const response = await fetch(`${API_URL}/api/v1/conversations/${workspaceId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Chat' }),
    });

    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }

    const conversation = await response.json();
    setConversations((prev) => [conversation, ...prev]);
    setActiveConversation(conversation);
    return conversation;
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !activeWorkspaceId) return;

    setLoading(true);
    setError(null);

    try {
      let conversation = activeConversation;
      if (!conversation) {
        conversation = await createConversation(activeWorkspaceId);
      }

      const response = await fetch(
        `${API_URL}/api/v1/conversations/${activeWorkspaceId}/${conversation.id}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: input.trim() }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const newMessage = await response.json();
      setMessages((prev) => [...prev, newMessage]);
      setInput('');

      setTimeout(() => {
        const aiMessage = {
          id: `local-${Date.now()}`,
          role: 'assistant',
          content: `[AI Service Placeholder]\n\nAI responses are not yet integrated. Ask for a summary by saying: "Summarize the selected documents."\n\nSelected context: ${selectedDocuments.length} documents`,
          sources: selectedDocuments
            .map((id) => documents.find((doc) => doc.id === id)?.filename)
            .filter(Boolean),
          created_at: new Date().toISOString(),
          client_only: true,
        };
        setMessages((prev) => [...prev, aiMessage]);
        setLoading(false);
      }, 900);
    } catch (err) {
      setError(err.message || 'Failed to send message');
      setLoading(false);
    }
  };

  const toggleDocumentSelection = (docId) => {
    setSelectedDocuments((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  return (
    <div className="ai-assistant-container">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-left">
          <Bot size={28} className="ai-icon" />
          <h1>AI Assistant</h1>
        </div>
      </div>

      <div className="ai-content">
        {/* Sidebar: Document Selection */}
        <div className="ai-sidebar">
          {error && <div className="error-message">{error}</div>}
          {!activeWorkspaceId && (
            <div className="empty-state">
              <AlertCircle size={24} />
              <p>No workspace available yet.</p>
            </div>
          )}
          {activeWorkspaceId && workspaces.length > 0 && (
            <div className="selection-summary">
              <CheckCircle size={16} />
              Workspace: {workspaces.find((ws) => ws.id === activeWorkspaceId)?.name || 'Selected'}
            </div>
          )}
          <h3>Select Documents</h3>
          <p className="sidebar-description">Choose documents for context</p>
          <div className="document-list">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`document-item ${selectedDocuments.includes(doc.id) ? 'selected' : ''}`}
                onClick={() => toggleDocumentSelection(doc.id)}
              >
                <input
                  type="checkbox"
                  checked={selectedDocuments.includes(doc.id)}
                  onChange={() => {}}
                  className="doc-checkbox"
                />
                <FileText size={16} />
                <span className="doc-name">{doc.filename || doc.name}</span>
              </div>
            ))}
          </div>

          {selectedDocuments.length > 0 && (
            <div className="selection-summary">
              <CheckCircle size={16} />
              {selectedDocuments.length} document{selectedDocuments.length !== 1 ? 's' : ''} selected
            </div>
          )}

          {/* AI Status */}
          <div className="ai-status">
            <AlertCircle size={16} />
            <div className="status-text">
              <strong>AI Service:</strong> Mock Mode
              <p className="status-note">
                Actual AI integration (GPT-4/Claude) will be implemented in later milestone
              </p>
            </div>
          </div>
        </div>

        {/* Main Area */}
        <div className="ai-main">
          {/* Chat Messages */}
          <div className="chat-area">
            {messages.length === 0 ? (
              <div className="empty-chat">
                <Sparkles size={48} />
                <h2>Ask me anything about your documents</h2>
                <p>I can help you find information, summarize content, and answer questions based on your uploaded documents.</p>
                <div className="suggestions">
                  <button onClick={() => setInput('Summarize the selected documents')}>
                    Summarize the selected documents
                  </button>
                  <button onClick={() => setInput('What are the main requirements?')}>
                    What are the main requirements?
                  </button>
                  <button onClick={() => setInput('What deadlines are mentioned?')}>
                    What deadlines are mentioned?
                  </button>
                </div>
              </div>
            ) : (
              <div className="messages-container">
                {messages.map((msg) => (
                  <div key={msg.id} className={`message ${msg.role}`}>
                    <div className="message-icon">
                      {msg.role === 'user' ? '👤' : <Bot size={20} />}
                    </div>
                    <div className="message-content">
                      <div className="message-text">{msg.content}</div>
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="message-sources">
                          <strong>Sources:</strong>
                          {msg.sources.map((source, idx) => (
                            <span key={idx} className="source-badge">
                              {source}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="message-time">{msg.created_at}</div>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="message assistant">
                    <div className="message-icon">
                      <Bot size={20} />
                    </div>
                    <div className="message-content">
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="chat-input-area">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask a question about your documents..."
              className="chat-input"
              disabled={loading}
            />
            <button
              onClick={handleSendMessage}
              className="btn-send"
              disabled={loading || !input.trim()}
              title="Send message"
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AIAssistant;
