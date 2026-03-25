import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  AlertCircle,
  User,
  Search,
  Plus,
  Loader2,
  Paperclip,
  Link2,
  ChevronRight,
  X,
  Upload,
  MessageCircle,
  Trash2,
  PanelLeftClose,
  PanelRightClose,
  PanelRight,
  PanelLeft,
} from 'lucide-react';
import './AIAssistant.css';

const HISTORY_SIDEBAR_KEY = 'ada:chat-history-collapsed';
const CONTEXT_SIDEBAR_KEY = 'ada:chat-context-collapsed';

function AIAssistant() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [containers, setContainers] = useState({ workspace: [], personal: [] });
  const [activeContainerId, setActiveContainerId] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState(null);
  const [contextSearch, setContextSearch] = useState('');
  const [error, setError] = useState(null);
  const [retryingDocId, setRetryingDocId] = useState(null);
  const [historySidebarCollapsed, setHistorySidebarCollapsed] = useState(
    () => localStorage.getItem(HISTORY_SIDEBAR_KEY) === '1'
  );
  const [contextSidebarCollapsed, setContextSidebarCollapsed] = useState(
    () => localStorage.getItem(CONTEXT_SIDEBAR_KEY) === '1'
  );
  const chatAreaRef = useRef(null);
  const inputRef = useRef(null);
  const contextSearchRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const isCreatingConversationRef = useRef(false);
  const lastConversationCreateAtRef = useRef(0);

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
    document.title = 'Chat with Ada · Ada';
    fetchWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_SIDEBAR_KEY, historySidebarCollapsed ? '1' : '0');
  }, [historySidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem(CONTEXT_SIDEBAR_KEY, contextSidebarCollapsed ? '1' : '0');
  }, [contextSidebarCollapsed]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchWorkspaceContainers(activeWorkspaceId);
    fetchConversations(activeWorkspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchDocuments(activeWorkspaceId, activeContainerId || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, activeContainerId]);

  useEffect(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    if (shouldAutoScrollRef.current) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  }, [messages, loading]);

  const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getDisplayName = () => {
    let persistedUser = null;

    try {
      const rawUser = localStorage.getItem('user');
      persistedUser = rawUser ? JSON.parse(rawUser) : null;
    } catch {
      persistedUser = null;
    }

    const primary = (
      persistedUser?.username
      || persistedUser?.name
      || localStorage.getItem('username')
      || localStorage.getItem('user_name')
      || persistedUser?.email
      || localStorage.getItem('email')
      || ''
    ).trim();

    if (!primary) return 'Ada User';

    const base = primary.includes('@') ? primary.split('@')[0] : primary;
    const firstToken = base.split(' ')[0]?.trim();
    if (!firstToken) return 'Ada User';

    return firstToken.charAt(0).toUpperCase() + firstToken.slice(1);
  };

  const formatFileSize = (bytesValue) => {
    const bytes = Number(bytesValue || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)}MB`;
  };

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
        setActiveWorkspaceId((prev) => {
          if (prev && items.some((workspace) => Number(workspace.id) === Number(prev))) {
            return prev;
          }
          return items[0].id;
        });
      } else {
        setActiveWorkspaceId(null);
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Failed to load workspaces'));
    }
  };

  useEffect(() => {
    const handleWorkspaceUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      if (Number.isFinite(changedWorkspaceId) && activeWorkspaceId && Number(changedWorkspaceId) !== Number(activeWorkspaceId)) {
        fetchWorkspaces();
        return;
      }

      fetchWorkspaces();
      if (activeWorkspaceId) {
        fetchWorkspaceContainers(activeWorkspaceId);
        fetchDocuments(activeWorkspaceId, activeContainerId || null);
      }
    };

    const handleContainerUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      if (Number.isFinite(changedWorkspaceId) && activeWorkspaceId && Number(changedWorkspaceId) !== Number(activeWorkspaceId)) {
        return;
      }

      if (activeWorkspaceId) {
        fetchWorkspaceContainers(activeWorkspaceId);
        fetchDocuments(activeWorkspaceId, activeContainerId || null);
      }
    };

    const handleDocumentsUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      if (Number.isFinite(changedWorkspaceId) && activeWorkspaceId && Number(changedWorkspaceId) !== Number(activeWorkspaceId)) {
        return;
      }

      if (activeWorkspaceId) {
        fetchDocuments(activeWorkspaceId, activeContainerId || null);
      }
    };

    window.addEventListener('workspaces-updated', handleWorkspaceUpdated);
    window.addEventListener('containers-updated', handleContainerUpdated);
    window.addEventListener('documents-updated', handleDocumentsUpdated);

    return () => {
      window.removeEventListener('workspaces-updated', handleWorkspaceUpdated);
      window.removeEventListener('containers-updated', handleContainerUpdated);
      window.removeEventListener('documents-updated', handleDocumentsUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, activeContainerId]);

  const fetchWorkspaceContainers = async (workspaceId) => {
    try {
      setError(null);
      const [wsResponse, allResponse] = await Promise.all([
        fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/containers`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/v1/containers`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
      ]);

      if (!wsResponse.ok) throw new Error('Failed to load workspace containers');
      const wsData = await wsResponse.json();
      const workspaceItems = Array.isArray(wsData?.items) ? wsData.items : Array.isArray(wsData) ? wsData : [];

      const personalItems = [];
      if (allResponse.ok) {
        const allData = await allResponse.json();
        const allItems = Array.isArray(allData?.items) ? allData.items : Array.isArray(allData) ? allData : [];
        personalItems.push(...allItems.filter((c) => c.workspace_id == null || c.workspace_id === undefined));
      }

      setContainers({ workspace: workspaceItems, personal: personalItems });
      setActiveContainerId('');
    } catch (err) {
      setContainers({ workspace: [], personal: [] });
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
      // Keep context when the list refreshes (indexing, uploads). Clearing here sent [] to the API,
      // which makes the backend search the entire workspace instead of the selected doc(s).
      setSelectedDocuments((prev) => {
        if (!prev.length) return prev;
        const validIds = new Set(items.map((d) => d.id));
        return prev.filter((id) => validIds.has(id));
      });
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Failed to load documents'));
    }
  };

  const handleRetryIndexing = async (docId, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!token || !docId) return;
    try {
      setRetryingDocId(docId);
      setError(null);
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}/retry-indexing`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to retry indexing');
      }
      await fetchDocuments(activeWorkspaceId, activeContainerId || null);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Could not retry indexing'));
    } finally {
      setRetryingDocId(null);
    }
  };

  const isDocumentFailed = (doc) =>
    String(doc.status || '').toLowerCase() === 'failed' ||
    (doc.status_label && doc.status_label.toLowerCase().includes("couldn't index"));

  const fetchConversations = async (workspaceId) => {
    try {
      setError(null);
      setLoadingThread(true);
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
        await fetchConversationMessages(workspaceId, items[0].id);
      } else {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Failed to load conversations'));
    } finally {
      setLoadingThread(false);
    }
  };

  const fetchConversationMessages = async (workspaceId, conversationId) => {
    try {
      setError(null);
      setLoadingThread(true);
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
    } finally {
      setLoadingThread(false);
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
    shouldAutoScrollRef.current = true;

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
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Failed to send message'));
    } finally {
      setLoading(false);
    }
  };

  const handleConversationSelect = async (conversation) => {
    if (!activeWorkspaceId) return;
    setActiveConversation(conversation);
    await fetchConversationMessages(activeWorkspaceId, conversation.id);
  };

  const handleCreateConversation = async () => {
    if (!activeWorkspaceId || isCreatingConversationRef.current) return;

    const now = Date.now();
    if (now - lastConversationCreateAtRef.current < 1000) {
      return;
    }

    isCreatingConversationRef.current = true;
    lastConversationCreateAtRef.current = now;

    setError(null);
    setCreatingConversation(true);
    try {
      setLoadingThread(true);
      const conversation = await createConversation(activeWorkspaceId);
      setMessages([]);
      setConversations((prev) => {
        const deduped = prev.filter((item) => item.id !== conversation.id);
        return [conversation, ...deduped];
      });
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Failed to create conversation'));
    } finally {
      setLoadingThread(false);
      setCreatingConversation(false);
      isCreatingConversationRef.current = false;
    }
  };

  const handleDeleteConversation = async (conversation) => {
    if (!activeWorkspaceId || !conversation?.id || deletingConversationId) return;

    const conversationLabel = conversation.title || 'this conversation';
    const confirmed = window.confirm(`Delete "${conversationLabel}"? This cannot be undone.`);
    if (!confirmed) return;

    setError(null);
    setDeletingConversationId(conversation.id);

    try {
      const response = await fetch(`${API_URL}/api/v1/conversations/${activeWorkspaceId}/${conversation.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }

      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);

      if (activeConversation?.id === conversation.id) {
        const nextConversation = remaining[0] || null;
        setActiveConversation(nextConversation);
        if (nextConversation) {
          await fetchConversationMessages(activeWorkspaceId, nextConversation.id);
        } else {
          setMessages([]);
        }
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err, 'Failed to delete conversation'));
    } finally {
      setDeletingConversationId(null);
    }
  };

  const handleQuickPrompt = (text) => {
    setInput(text);
    inputRef.current?.focus();
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
    const id = Number(docId);
    setSelectedDocuments((prev) => {
      const normalized = prev.map((x) => Number(x));
      return normalized.includes(id)
        ? normalized.filter((x) => x !== id)
        : [...normalized, id];
    });
  };

  const selectedIdSet = new Set(selectedDocuments.map((id) => Number(id)));
  const selectedDocumentRecords = documents.filter((doc) => selectedIdSet.has(Number(doc.id)));
  const pendingSelectedDocuments = selectedDocumentRecords.filter(
    (doc) => String(doc.status || '').toLowerCase() !== 'ready'
  );
  const selectedWorkspaceName = workspaces.find((ws) => ws.id === activeWorkspaceId)?.name || 'Workspace';
  const greeting = getTimeGreeting();
  const viewerName = getDisplayName();

  const filteredDocuments = documents.filter((document) => {
    const haystack = `${document.filename || document.name || ''} ${document.status || ''}`.toLowerCase();
    return haystack.includes(contextSearch.trim().toLowerCase());
  });

  const activeContextDocuments = filteredDocuments.filter((document) => selectedIdSet.has(Number(document.id)));
  const availableContextDocuments = filteredDocuments.filter((document) => !selectedIdSet.has(Number(document.id)));
  const allFilteredSelected =
    filteredDocuments.length > 0 && availableContextDocuments.length === 0;

  const handleSelectAllFilteredDocuments = () => {
    setSelectedDocuments(filteredDocuments.map((d) => Number(d.id)));
  };
  const readyDocumentCount = documents.filter((doc) => String(doc.status || '').toLowerCase() === 'ready').length;
  const hasSelectedContext = selectedDocumentRecords.length > 0;
  const selectedScopeLabel = hasSelectedContext
    ? `Responses are limited to ${selectedDocumentRecords.length} selected document${selectedDocumentRecords.length !== 1 ? 's' : ''}.`
    : 'Ask for summaries, comparisons, and answers here. Use Search when you need exact keyword matches first.';

  const quickPrompts = [
    'Summarize the Q3 goals',
    'Find risks in the current contract',
    'Draft an email to the team',
    'Create a key dates timeline',
  ];

  const getSourceLabel = (source) => {
    if (typeof source === 'string') return source;
    if (source && typeof source === 'object') {
      return source.filename || source.document_name || source.name || 'Source';
    }
    return 'Source';
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const handleChatScroll = () => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;
    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  };

  const shellClass =
    `ada-chat-shell${historySidebarCollapsed ? ' ada-chat-shell--collapse-left' : ''}${
      contextSidebarCollapsed ? ' ada-chat-shell--collapse-right' : ''
    }`;

  return (
    <div className="ada-chat-page">
      <div className={shellClass}>
        {!historySidebarCollapsed && (
          <aside className="ada-left-rail" aria-label="Conversation navigation">
            <div className="ada-new-chat-row">
              <button
                type="button"
                className="ada-new-chat-btn"
                onClick={handleCreateConversation}
                disabled={!activeWorkspaceId || loadingThread || creatingConversation}
              >
                <Plus size={16} />
                New Investigation
              </button>
              <button
                type="button"
                className="ada-rail-toggle"
                onClick={() => setHistorySidebarCollapsed(true)}
                aria-expanded
                aria-label="Hide conversation history sidebar"
                title="Hide history"
              >
                <PanelLeftClose size={18} aria-hidden />
              </button>
            </div>

            <div className="ada-left-section">
              <p className="ada-section-label">Knowledge Base</p>
              <button type="button" className="ada-nav-item active">
                <MessageCircle size={14} />
                <span>Current Chat</span>
              </button>
              <button type="button" className="ada-nav-item" onClick={() => navigate('/documents')}>
                <span>All Documents</span>
              </button>
              <button type="button" className="ada-nav-item" onClick={() => navigate('/search')}>
                <span>Search Knowledge</span>
              </button>
            </div>

            <div className="ada-left-section">
              <p className="ada-section-label">Recent History</p>
              <div className="ada-history-list">
                {conversations.length === 0 ? (
                  <p className="ada-muted-line">No previous investigations</p>
                ) : (
                  conversations.slice(0, 8).map((conversation) => (
                    <div
                      key={conversation.id}
                      className={`ada-history-item ${activeConversation?.id === conversation.id ? 'active' : ''}`}
                    >
                      <button
                        type="button"
                        className="ada-history-open-btn"
                        onClick={() => handleConversationSelect(conversation)}
                      >
                        {conversation.title || 'Untitled conversation'}
                      </button>
                      <button
                        type="button"
                        className="ada-history-delete-btn"
                        onClick={() => handleDeleteConversation(conversation)}
                        disabled={deletingConversationId === conversation.id}
                        aria-label={`Delete ${conversation.title || 'conversation'}`}
                      >
                        {deletingConversationId === conversation.id ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="ada-left-footer">
              <div className="ada-presence-row">
                <span className="ada-avatar-chip small">{viewerName.charAt(0).toUpperCase()}</span>
                <div>
                  <p className="ada-footer-name">{viewerName}</p>
                </div>
              </div>
            </div>
          </aside>
        )}

        <main className="ada-main-stage">
          <header className="ada-stage-topbar">
            <div className="ada-stage-topbar-inner">
              <div className="ada-breadcrumbs" aria-label="Current scope">
                <span>Work Brain</span>
                <ChevronRight size={12} />
                <strong>{selectedWorkspaceName}</strong>
              </div>
              <div className="ada-stage-rail-toggles" role="toolbar" aria-label="Sidebar visibility">
                {historySidebarCollapsed && (
                  <button
                    type="button"
                    className="ada-rail-toggle ada-rail-toggle--ghost"
                    onClick={() => setHistorySidebarCollapsed(false)}
                    aria-label="Show conversation history"
                    title="Show history"
                  >
                    <PanelRight size={16} aria-hidden />
                    <span>History</span>
                  </button>
                )}
                {contextSidebarCollapsed && (
                  <button
                    type="button"
                    className="ada-rail-toggle ada-rail-toggle--ghost"
                    onClick={() => setContextSidebarCollapsed(false)}
                    aria-label="Show context and documents"
                    title="Show context"
                  >
                    <PanelLeft size={16} aria-hidden />
                    <span>Context</span>
                  </button>
                )}
              </div>
            </div>
          </header>

          <div className="ada-guidance-strip" role="status">
            <p>
              <strong>Chat-first workflow.</strong> {selectedScopeLabel}
            </p>
            <button type="button" className="ada-guidance-link" onClick={() => navigate('/search')}>
              Open Search
            </button>
          </div>

          {error && (
            <div className="ada-error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <section className="ada-chat-scroll" ref={chatAreaRef} onScroll={handleChatScroll}>
            {loadingThread ? (
              <div className="ada-thread-skeleton" aria-live="polite" aria-busy="true">
                <div className="skeleton ada-skeleton-line" />
                <div className="skeleton ada-skeleton-line short" />
                <div className="skeleton ada-skeleton-line" />
              </div>
            ) : messages.length === 0 ? (
              <div className="ada-empty-stage">
                <h2>
                  {greeting}, <span className="ada-name-accent">{viewerName}</span>.
                </h2>
                <p>
                  I&apos;ve analyzed {readyDocumentCount} ready document{readyDocumentCount !== 1 ? 's' : ''} in {selectedWorkspaceName}. I&apos;m ready to synthesize insights.
                </p>
                {hasSelectedContext && (
                  <p className="ada-empty-scope-note">
                    I&apos;ll stay inside your selected document context for the next answer.
                  </p>
                )}

                <div className="ada-prompt-grid">
                  {quickPrompts.map((prompt, index) => {
                    const mappedDoc = documents[index];
                    return (
                      <button key={prompt} type="button" className="ada-prompt-card" onClick={() => handleQuickPrompt(prompt)}>
                        <span>{prompt}</span>
                        <small>
                          {mappedDoc
                            ? `From ${mappedDoc.filename || mappedDoc.name}`
                            : 'From selected context'}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="ada-thread-list">
                {messages.map((message) => (
                  <article key={message.id} className={`ada-message ${message.role}`}>
                    <div className="ada-message-avatar">{message.role === 'user' ? <User size={14} /> : 'A'}</div>
                    <div className="ada-message-body">
                      <p className="ada-message-text">{message.content}</p>
                      {message.sources && message.sources.length > 0 && (
                        <div className="ada-source-row">
                          {message.sources.map((source, index) => (
                            <span key={`${source}-${index}`} className="ada-source-chip">
                              {getSourceLabel(source)}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="ada-message-meta">{formatMessageTime(message.created_at)}</div>
                    </div>
                  </article>
                ))}

                {loading && (
                  <article className="ada-message assistant">
                    <div className="ada-message-avatar">A</div>
                    <div className="ada-message-body">
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </article>
                )}
              </div>
            )}
          </section>

          <footer className="ada-composer">
            <div className="ada-composer-context-row">
              {selectedDocumentRecords.slice(0, 2).map((document) => (
                <span key={document.id} className="ada-context-chip">
                  {document.filename || document.name}
                  <button type="button" onClick={() => toggleDocumentSelection(document.id)} aria-label={`Remove ${document.filename || document.name}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              {selectedDocumentRecords.length > 2 && (
                <span className="ada-context-chip muted">+{selectedDocumentRecords.length - 2} more</span>
              )}
              <button type="button" className="ada-add-context-btn" onClick={() => contextSearchRef.current?.focus()}>
                <Plus size={12} />
                Add Context
              </button>
            </div>

            <div className="ada-composer-input-row">
              <Paperclip size={16} className="ada-composer-icon" />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Ask Ada..."
                disabled={loading || !activeWorkspaceId}
              />
              <button
                type="button"
                className="ada-send-btn"
                onClick={handleSendMessage}
                disabled={loading || !input.trim() || !activeWorkspaceId}
                aria-label="Send message"
              >
                {loading ? <Loader2 size={18} className="spin" /> : <Send size={16} />}
              </button>
            </div>
          </footer>
        </main>

        {!contextSidebarCollapsed && (
          <aside className="ada-right-context" aria-label="Document context panel">
          <div className="ada-context-header-row">
            <h3>Context</h3>
          </div>

          <div className="ada-context-search-row">
            <Search size={14} aria-hidden />
            <input
              ref={contextSearchRef}
              type="text"
              value={contextSearch}
              onChange={(event) => setContextSearch(event.target.value)}
              placeholder="Search knowledge..."
              aria-label="Search knowledge"
            />
            <button
              type="button"
              className="ada-rail-toggle ada-rail-toggle--context-search"
              onClick={() => setContextSidebarCollapsed(true)}
              aria-expanded
              aria-label="Hide document context sidebar"
              title="Hide context"
            >
              <PanelRightClose size={18} aria-hidden />
            </button>
          </div>

          <div className="ada-context-middle">
            <div className="ada-right-section ada-context-active-section">
              <div className="ada-right-section-header">
                <p>Active in Chat ({activeContextDocuments.length})</p>
                <button type="button" onClick={() => setSelectedDocuments([])}>Clear</button>
              </div>

              <div className="ada-context-list ada-context-list--active">
                {activeContextDocuments.length === 0 ? (
                  <p className="ada-muted-line">No documents selected.</p>
                ) : (
                  activeContextDocuments.map((document) => (
                    <div key={document.id} className="ada-context-item-wrap active">
                      <button
                        type="button"
                        className="ada-context-item active"
                        onClick={() => toggleDocumentSelection(document.id)}
                      >
                        <div>
                          <strong>{document.filename || document.name}</strong>
                          <small title={document.status_detail || undefined}>
                            {document.status_label || String(document.status || 'uploaded').toLowerCase()} • {formatFileSize(document.file_size || document.size_bytes)}
                          </small>
                        </div>
                        <Link2 size={14} />
                      </button>
                      {isDocumentFailed(document) && (
                        <button
                          type="button"
                          className="ada-retry-index-btn"
                          onClick={(e) => { e.stopPropagation(); handleRetryIndexing(document.id, e); }}
                          disabled={retryingDocId === document.id}
                          title={document.status_detail || 'Try indexing again'}
                        >
                          {retryingDocId === document.id ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            'Try again'
                          )}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="ada-right-section ada-context-library-section">
              <div className="ada-right-section-header ada-context-library-header">
                <p>Available Library</p>
                <div className="ada-context-library-actions">
                  <button
                    type="button"
                    onClick={handleSelectAllFilteredDocuments}
                    disabled={filteredDocuments.length === 0 || allFilteredSelected}
                    aria-label="Select all documents matching the current folder and search"
                  >
                    Select all
                  </button>
                  <button type="button" onClick={() => navigate('/documents')}>View all</button>
                </div>
              </div>

              <div className="ada-context-list ada-context-list--library">
                {availableContextDocuments.length === 0 ? (
                  <p className="ada-muted-line">
                    {filteredDocuments.length === 0
                      ? 'No matching documents found.'
                      : 'All matching documents are selected.'}
                  </p>
                ) : (
                  availableContextDocuments.map((document) => (
                    <label key={document.id} className="ada-context-item selectable">
                      <input
                        type="checkbox"
                        checked={selectedIdSet.has(Number(document.id))}
                        onChange={() => toggleDocumentSelection(document.id)}
                      />
                      <div>
                        <strong>{document.filename || document.name}</strong>
                        <small title={document.status_detail || undefined}>
                          {document.status_label || String(document.status || 'uploaded').toLowerCase()}
                        </small>
                      </div>
                      {isDocumentFailed(document) && (
                        <button
                          type="button"
                          className="ada-retry-index-btn"
                          onClick={(e) => handleRetryIndexing(document.id, e)}
                          disabled={retryingDocId === document.id}
                          title={document.status_detail || 'Try indexing again'}
                        >
                          {retryingDocId === document.id ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            'Try again'
                          )}
                        </button>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="ada-upload-context-btn ada-upload-context-btn--compact"
            onClick={() => navigate('/documents')}
          >
            <Upload size={14} aria-hidden />
            <span className="ada-upload-context-text">
              <span className="ada-upload-context-title">Add documents</span>
              <small className="ada-upload-context-hint">Go to Documents · PDF, DOCX, TXT · max 50&nbsp;MB</small>
            </span>
          </button>

          {pendingSelectedDocuments.length > 0 && (
            <div className="ada-warning-note" role="status">
              <AlertCircle size={14} />
              <span>
                {pendingSelectedDocuments.length} selected document{pendingSelectedDocuments.length !== 1 ? 's are' : ' is'} still processing and will be excluded until ready.
              </span>
            </div>
          )}

          <div className="ada-rail-controls">
            <div className="ada-field">
              <label htmlFor="ai-workspace-select">Workspace</label>
              <select
                id="ai-workspace-select"
                value={activeWorkspaceId ?? ''}
                onChange={handleWorkspaceChange}
                disabled={workspaces.length === 0}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ada-field">
              <label htmlFor="ai-container-select">Folder</label>
              <select
                id="ai-container-select"
                value={activeContainerId}
                onChange={handleContainerChange}
                disabled={!activeWorkspaceId}
              >
                <option value="">All workspace documents</option>
                {(containers.workspace || []).length > 0 && (
                  <optgroup label="Workspace folders">
                    {(containers.workspace || []).map((container) => (
                      <option key={container.id} value={container.id}>
                        {container.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(containers.personal || []).length > 0 && (
                  <optgroup label="My folders">
                    {(containers.personal || []).map((container) => (
                      <option key={container.id} value={container.id}>
                        {container.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default AIAssistant;
