import React, { useState, useEffect, useRef } from 'react';
import { Send, FileText, Bot, AlertCircle, Sparkles, CheckCircle, User } from 'lucide-react';
import './AIAssistant.css';

function AIAssistant() {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [containers, setContainers] = useState([]);
  const [activeContainerId, setActiveContainerId] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chatAreaRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);

  const API_URL = (process.env.REACT_APP_API_URL || localStorage.getItem('api_url') || 'http://localhost:8000').replace(/\/+$/, '');
  const token = localStorage.getItem('token');

  const getFriendlyErrorMessage = (error, fallbackMessage) => {
    const raw = String(error?.message || '').toLowerCase();
    if (raw.includes('failed to fetch') || raw.includes('networkerror')) {
      return `Cannot reach API at ${API_URL}. Check backend/CORS configuration and REACT_APP_API_URL.`;
    }
    return error?.message || fallbackMessage;
  };

  const formatMessageTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((startOfToday - startOfMessageDay) / (1000 * 60 * 60 * 24));

    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 0) return `Today, ${time}`;
    if (diffDays === 1) return `Yesterday, ${time}`;

    const datePart = date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
    return `${datePart}, ${time}`;
  };

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchWorkspaceContainers(activeWorkspaceId);
    fetchConversations(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchDocuments(activeWorkspaceId, activeContainerId || null);
  }, [activeWorkspaceId, activeContainerId]);

  useEffect(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    if (shouldAutoScrollRef.current) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  }, [messages, loading]);

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
      setError(getFriendlyErrorMessage(err, 'Failed to load workspaces'));
    }
  };

  const fetchWorkspaceContainers = async (workspaceId) => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/containers`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to load containers');
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setContainers(items);
      setActiveContainerId('');
    } catch (err) {
      setContainers([]);
      setError(getFriendlyErrorMessage(err, 'Failed to load containers'));
    }
  };

  const fetchDocuments = async (workspaceId, containerId = null) => {
    try {
      setError(null);
      const endpoint = containerId
        ? `${API_URL}/api/v1/containers/${containerId}/documents`
        : `${API_URL}/api/v1/workspaces/${workspaceId}/documents`;
      const response = await fetch(endpoint, {
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
      setError(getFriendlyErrorMessage(err, 'Failed to load documents'));
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
      setError(getFriendlyErrorMessage(err, 'Failed to load conversations'));
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
      setError(getFriendlyErrorMessage(err, 'Failed to load messages'));
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
          body: JSON.stringify({
            content: input.trim(),
            document_ids: selectedDocuments,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      await response.json();
      await fetchConversationMessages(activeWorkspaceId, conversation.id);
      setInput('');
      setLoading(false);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Failed to send message'));
      setLoading(false);
    }
  };

  const handleWorkspaceChange = (event) => {
    const nextWorkspaceId = event.target.value ? Number(event.target.value) : null;
    setActiveWorkspaceId(nextWorkspaceId);
    setActiveConversation(null);
    setMessages([]);
    setSelectedDocuments([]);
  };

  const handleContainerChange = (event) => {
    setActiveContainerId(event.target.value);
    setSelectedDocuments([]);
  };

  const toggleDocumentSelection = (docId) => {
    setSelectedDocuments((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const selectedDocumentRecords = documents.filter((doc) => selectedDocuments.includes(doc.id));
  const pendingSelectedDocuments = selectedDocumentRecords.filter(
    (doc) => String(doc.status || '').toLowerCase() !== 'ready'
  );

  const handleChatScroll = () => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;
    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  };

  return (
    <div className="ai-assistant-container">
      <div className="ai-shell">
        {/* Header */}
        <div className="ai-header">
          <div className="ai-header-left">
            <Bot size={24} className="ai-icon" />
            <h1>Chat with Ada</h1>
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
            {workspaces.length > 0 && (
              <div className="field-group">
                <label htmlFor="ai-workspace-select" className="field-label">Workspace</label>
                <select
                  id="ai-workspace-select"
                  className="field-select"
                  value={activeWorkspaceId ?? ''}
                  onChange={handleWorkspaceChange}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field-group">
              <label htmlFor="ai-container-select" className="field-label">Container</label>
              <select
                id="ai-container-select"
                className="field-select"
                value={activeContainerId}
                onChange={handleContainerChange}
                disabled={!activeWorkspaceId}
              >
                <option value="">All workspace documents</option>
                {containers.map((container) => (
                  <option key={container.id} value={container.id}>
                    {container.name}
                  </option>
                ))}
              </select>
            </div>
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
                  <span className={`doc-status ${String(doc.status || '').toLowerCase() === 'ready' ? 'ready' : 'pending'}`}>
                    {String(doc.status || 'uploaded').toLowerCase()}
                  </span>
                </div>
              ))}
            </div>

            {selectedDocuments.length > 0 && (
              <div className="selection-summary">
                <CheckCircle size={16} />
                {selectedDocuments.length} document{selectedDocuments.length !== 1 ? 's' : ''} selected
              </div>
            )}

            {pendingSelectedDocuments.length > 0 && (
              <div className="selection-warning">
                <AlertCircle size={16} />
                {pendingSelectedDocuments.length} selected document{pendingSelectedDocuments.length !== 1 ? 's are' : ' is'} still processing. Chat answers may be limited until status is ready.
              </div>
            )}

            {/* AI Status */}
            <div className="ai-status">
              <AlertCircle size={16} />
              <div className="status-text">
                <strong>AI Service:</strong> Retrieval Mode
                <p className="status-note">
                  Responses are generated from semantically retrieved workspace documents
                </p>
              </div>
            </div>
          </div>

          {/* Main Area */}
          <div className="ai-main">
            {/* Chat Messages */}
            <div className="chat-area" ref={chatAreaRef} onScroll={handleChatScroll}>
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
                        {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
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
                        {msg.role === 'assistant' && (
                          <div className="message-meta-source">
                            Source: {msg.model_used || 'retrieval'}
                          </div>
                        )}
                        <div className="message-time">{formatMessageTime(msg.created_at)}</div>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="message assistant">
                      <div className="message-icon">
                        <Bot size={18} />
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
    </div>
  );
}

export default AIAssistant;
