import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, MessageSquare, AlertCircle, Settings } from 'lucide-react';
import WorkspaceSettings from './WorkspaceSettings';
import { getApiErrorMessage } from '../utils/apiError';
import { buildAccentStyleVars } from '../utils/accentAccessibility';
import './WorkspaceDetail.css';

function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('discussion');
  const [liveMemberCount, setLiveMemberCount] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);
  const [issueCount, setIssueCount] = useState(0);
  const [issueHasUpdates, setIssueHasUpdates] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const currentUsername = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return String(parsed?.username || '').trim().toLowerCase() || null;
    } catch {
      return null;
    }
  }, []);

  const getInitial = (value) => {
    if (!value || typeof value !== 'string') return '?';
    return value.charAt(0).toUpperCase();
  };

  const formatMessageTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const isRecent = (value, days) => {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return false;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return timestamp >= cutoff;
  };

  const documentCount = workspace?.document_count || 0;
  const memberCount = Number.isFinite(liveMemberCount)
    ? liveMemberCount
    : (workspace?.member_count || 0);
  const discussionCount = messages.length;
  const discussionHasUpdates = messages.some((msg) => isRecent(msg.created_at, 2));
  const workspaceAccentStyle = useMemo(() => {
    if (!workspace?.accent_color) return undefined;
    const rootStyles = getComputedStyle(document.documentElement);
    const bg = rootStyles.getPropertyValue('--bg-primary').trim() || '#F4F3F1';
    return buildAccentStyleVars(workspace.accent_color, bg);
  }, [workspace?.accent_color]);

  const fetchMessages = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/messages/workspace/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setMessages(Array.isArray(data) ? data.reverse() : []);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }, [API_URL, id]);

  const fetchIssueSummary = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/tasks/${id}?task_type=issue&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        const total = Number.isFinite(data?.total) ? data.total : items.length;
        setIssueCount(total);
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const hasUpdates = items.some((issue) => {
          if (!issue?.created_at) return false;
          const created = new Date(issue.created_at).getTime();
          return Number.isFinite(created) && created >= cutoff;
        });
        setIssueHasUpdates(hasUpdates);
      }
    } catch (err) {
      console.error('Failed to fetch issues:', err);
    }
  }, [API_URL, id]);

  const fetchMemberCount = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces/${id}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.members)
        ? data.members
        : Array.isArray(data)
        ? data
        : [];
      setLiveMemberCount(items.length);
    } catch (err) {
      console.error('Failed to fetch member count:', err);
    }
  }, [API_URL, id]);

  useEffect(() => {
    const fetchWorkspaceDetail = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/v1/workspaces/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          const message = await getApiErrorMessage(response, 'Failed to fetch workspace');
          throw new Error(message);
        }
        const data = await response.json();
        setWorkspace(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchWorkspaceDetail();
    fetchMessages();
    fetchMemberCount();
    fetchIssueSummary();
  }, [id, API_URL, fetchMessages, fetchIssueSummary, fetchMemberCount]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setMessageLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/messages/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspace_id: parseInt(id), content: newMessage.trim() }),
      });

      if (response.ok) {
        setNewMessage('');
        fetchMessages();
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setMessageLoading(false);
    }
  };

  if (loading) return <div className="workspace-detail-page"><div className="loading">Loading workspace...</div></div>;
  if (error) return <div className="workspace-detail-page"><div className="error">{error}</div></div>;
  if (!workspace) return <div className="workspace-detail-page"><div className="error">Workspace not found</div></div>;

  return (
    <div className="workspace-detail-page" style={workspaceAccentStyle}>
      <header className="detail-header">
        <div className="header-content">
          <button className="back-btn" onClick={() => navigate('/workspace')}>&larr; Back to Workspaces</button>
          <h1>{workspace.name}</h1>
          <p>ID: {workspace.id} • {memberCount} Members • {documentCount} Documents</p>
        </div>
      </header>

      <div className="detail-container">
        <div className="detail-layout">
          <aside className="detail-sidebar">
            <button
              className="detail-nav-item"
              onClick={() => navigate(`/documents?workspaceId=${id}`)}
              type="button"
              title="Documents"
              aria-label="Documents"
            >
              <span className="detail-nav-icon" aria-hidden="true"><FileText size={16} /></span>
              <span className="detail-nav-label">Documents</span>
              <span className="detail-nav-meta">
                <span className="detail-nav-count">{documentCount}</span>
              </span>
            </button>
            <button
              className={`detail-nav-item ${activeTab === 'discussion' ? 'active' : ''}`}
              onClick={() => setActiveTab('discussion')}
              type="button"
              title="Discussion"
              aria-label="Discussion"
            >
              <span className="detail-nav-icon" aria-hidden="true"><MessageSquare size={16} /></span>
              <span className="detail-nav-label">Chat History</span>
              <span className="detail-nav-meta">
                <span className="detail-nav-count">{discussionCount}</span>
                {discussionHasUpdates && <span className="detail-nav-dot" aria-label="New messages"></span>}
              </span>
            </button>
            <button
              className="detail-nav-item"
              onClick={() => navigate(`/workspace/${id}/issues`)}
              type="button"
              title="Issues"
              aria-label="Issues"
            >
              <span className="detail-nav-icon" aria-hidden="true"><AlertCircle size={16} /></span>
              <span className="detail-nav-label">Issues</span>
              <span className="detail-nav-meta">
                <span className="detail-nav-count">{issueCount}</span>
                {issueHasUpdates && <span className="detail-nav-dot" aria-label="New issues"></span>}
              </span>
            </button>
            <button
              className={`detail-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
              type="button"
              title="Settings"
              aria-label="Settings"
            >
              <span className="detail-nav-icon" aria-hidden="true"><Settings size={16} /></span>
              <span className="detail-nav-label">Settings</span>
              <span className="detail-nav-meta"></span>
            </button>
          </aside>

          <div className="detail-content">
            {activeTab === 'discussion' && (
              <div className="tab-discussion">
                <div className="discussion-head">
                  <div className="discussion-title-wrap">
                    <h2>Team Discussion</h2>
                    <p>
                      <span className="discussion-online-dot" aria-hidden="true" />
                      {memberCount} members in workspace
                    </p>
                  </div>
                </div>

                <div className="messages-container">
                  <div className="messages-surface">
                    {messages.length === 0 ? (
                      <p className="empty-message">No messages yet. Start the conversation.</p>
                    ) : (
                      messages.map((msg, index) => {
                        const author = String(msg.sender_username ?? msg.sender ?? msg.user ?? 'Unknown');
                        const isSelf = currentUsername && author.toLowerCase() === currentUsername;

                        return (
                          <div key={msg.id ?? index} className={`message-row ${isSelf ? 'self' : ''}`}>
                            {!isSelf && (
                              <div className="message-avatar">{getInitial(author)}</div>
                            )}
                            <div className="message-body">
                              <div className="message-header">
                                <span className="message-author">{isSelf ? 'You' : author}</span>
                                <span className="message-time">{formatMessageTime(msg.created_at)}</span>
                              </div>
                              <div className="message-bubble">{msg.content ?? ''}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <form onSubmit={handleSendMessage} className="message-form">
                  <input
                    type="text"
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    disabled={messageLoading}
                  />
                  <button type="submit" disabled={!newMessage.trim() || messageLoading}>
                    Send
                  </button>
                </form>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="tab-settings">
                <WorkspaceSettings workspaceId={id} inline />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDetail;
