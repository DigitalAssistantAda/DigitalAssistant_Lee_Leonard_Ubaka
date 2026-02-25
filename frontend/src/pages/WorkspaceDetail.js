import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, Users, MessageSquare, AlertCircle, Settings } from 'lucide-react';
import WorkspaceSettings from './WorkspaceSettings';
import { getApiErrorMessage, parseApiErrorMessage } from '../utils/apiError';
import './WorkspaceDetail.css';

function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('documents');
  const [documents, setDocuments] = useState([]);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);
  const [issueCount, setIssueCount] = useState(0);
  const [issueHasUpdates, setIssueHasUpdates] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [inviteValue, setInviteValue] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteMessage, setInviteMessage] = useState('');

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const getInitial = (value) => {
    if (!value || typeof value !== 'string') return '?';
    return value.charAt(0).toUpperCase();
  };

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
  };

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  };

  const isRecent = (value, days) => {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return false;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return timestamp >= cutoff;
  };

  const documentCount = documents.length || workspace?.document_count || 0;
  const memberCount = members.length || workspace?.member_count || 0;
  const discussionCount = messages.length;
  const documentsHasUpdates = documents.some((doc) => isRecent(doc.created_at, 7));
  const membersHasUpdates = members.some((member) => isRecent(member.joined_at, 30));
  const discussionHasUpdates = messages.some((msg) => isRecent(msg.created_at, 2));

  useEffect(() => {
    // Fire petals once when workspace detail loads
    if (!loading && workspace) {
      window.dispatchEvent(
        new CustomEvent('ada:petalburst', {
          detail: {
            x: window.innerWidth / 2,
            y: 150,
            count: 14,
          },
        })
      );
    }
  }, [loading, workspace]);

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
    fetchDocuments();
    fetchMembers();
    fetchMessages();
    fetchIssueSummary();
  }, [id, API_URL]);

  const fetchDocuments = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces/${id}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setDocuments(Array.isArray(data?.documents) ? data.documents : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    }
  };

  const fetchMembers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces/${id}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setMembers(Array.isArray(data?.members) ? data.members : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
    }
  };

  const fetchMessages = async () => {
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
  };

  const fetchIssueSummary = async () => {
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
  };

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

  const handleInviteMember = async (e) => {
    e.preventDefault();
    setInviteMessage('');
    if (!inviteValue.trim()) {
      setInviteMessage('Enter an email or user ID.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces/${id}/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_or_user_id: inviteValue.trim(),
          role: inviteRole,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        setInviteMessage(parseApiErrorMessage(errData, 'Failed to invite member.'));
        return;
      }

      const newMember = await response.json();
      setMembers((prev) => [...prev, newMember]);
      setInviteValue('');
      setInviteRole('member');
      setInviteMessage('Invite sent.');
    } catch (err) {
      setInviteMessage('Failed to invite member.');
    }
  };

  if (loading) return <div className="workspace-detail-page"><div className="loading">Loading workspace...</div></div>;
  if (error) return <div className="workspace-detail-page"><div className="error">{error}</div></div>;
  if (!workspace) return <div className="workspace-detail-page"><div className="error">Workspace not found</div></div>;

  return (
    <div className="workspace-detail-page">
      <header className="detail-header">
        <button className="back-btn" onClick={() => navigate('/workspace')}>&larr; Back</button>
        <div className="header-content">
          <h1>{workspace.name}</h1>
          <p>ID: {workspace.id} • {memberCount} Members • {documentCount} Documents</p>
        </div>
      </header>

      <div className="detail-container">
        <div className="detail-layout">
          <aside className="detail-sidebar">
            <button
              className={`detail-nav-item ${activeTab === 'documents' ? 'active' : ''}`}
              onClick={() => setActiveTab('documents')}
              type="button"
              title="Documents"
              aria-label="Documents"
            >
              <span className="detail-nav-icon" aria-hidden="true"><FileText size={16} /></span>
              <span className="detail-nav-meta">
                <span className="detail-nav-count">{documentCount}</span>
                {documentsHasUpdates && <span className="detail-nav-dot" aria-label="New documents"></span>}
              </span>
            </button>
            <button
              className={`detail-nav-item ${activeTab === 'members' ? 'active' : ''}`}
              onClick={() => setActiveTab('members')}
              type="button"
              title="Members"
              aria-label="Members"
            >
              <span className="detail-nav-icon" aria-hidden="true"><Users size={16} /></span>
              <span className="detail-nav-meta">
                <span className="detail-nav-count">{memberCount}</span>
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
              <span className="detail-nav-meta">
                <span className="detail-nav-count">{issueCount}</span>
                {issueHasUpdates && <span className="detail-nav-dot" aria-label="New issues"></span>}
              </span>
            </button>
            <button
              className={`detail-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('settings');
                setShowSettingsModal(true);
              }}
              type="button"
              title="Settings"
              aria-label="Settings"
            >
              <span className="detail-nav-icon" aria-hidden="true"><Settings size={16} /></span>
              <span className="detail-nav-meta"></span>
            </button>
          </aside>

          <div className="detail-content">
            {activeTab === 'documents' && (
              <div className="tab-documents">
                <h2>Documents</h2>
                <div className="settings-section">
                  <h3>AI signals</h3>
                  <div className="documents-list">
                    <div className="document-item">
                      <div className="doc-name">Auto-tag recent uploads</div>
                      <div className="doc-meta">Preview only • Based on recent file types</div>
                    </div>
                    <div className="document-item">
                      <div className="doc-name">Generate a workspace summary</div>
                      <div className="doc-meta">Preview only • Uses latest documents</div>
                    </div>
                  </div>
                </div>
                {documents.length === 0 ? (
                  <p className="empty-message">No documents in this workspace</p>
                ) : (
                  <div className="documents-list">
                    {documents.map((doc) => (
                      <div key={doc.id} className="document-item">
                        <div className="doc-name">{doc.filename}</div>
                        <div className="doc-meta">
                          {doc.status || 'uploaded'} • {formatBytes(doc.size_bytes)} • {formatDate(doc.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'members' && (
              <div className="tab-members">
                <h2>Members</h2>
                <form className="member-invite" onSubmit={handleInviteMember}>
                  <div className="member-invite-row">
                    <input
                      type="text"
                      value={inviteValue}
                      onChange={(e) => setInviteValue(e.target.value)}
                      placeholder="Email or user ID"
                      aria-label="Invite member"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      aria-label="Invite role"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button type="submit">Invite</button>
                  </div>
                  {inviteMessage && <p className="invite-message">{inviteMessage}</p>}
                </form>
                {members.length === 0 ? (
                  <p className="empty-message">No members in this workspace</p>
                ) : (
                  <div className="members-list">
                    {members.map((member, index) => (
                      <div key={member.id ?? member.user_id ?? index} className="member-item">
                        <div className="member-avatar">{getInitial(member.username ?? member.email)}</div>
                        <div>
                          <div className="member-name">{member.username ?? member.email ?? 'Unknown user'}</div>
                          <div className="member-role">{member.role ?? 'member'}{member.joined_at ? ` • Joined ${formatDate(member.joined_at)}` : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'discussion' && (
              <div className="tab-discussion">
                <h2>Discussion</h2>
                <div className="messages-container">
                  {messages.length === 0 ? (
                    <p className="empty-message">No messages yet. Start the conversation.</p>
                  ) : (
                    messages.map((msg, index) => (
                      <div key={msg.id ?? index} className="message">
                        <div className="message-avatar">{getInitial(msg.sender_username ?? msg.sender ?? msg.user)}</div>
                        <div>
                          <div className="message-header">
                            <span className="message-author">{msg.sender_username ?? msg.sender ?? msg.user ?? 'Unknown'}</span>
                            <span className="message-time">{msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : ''}</span>
                          </div>
                          <div className="message-content">{msg.content ?? ''}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={handleSendMessage} className="message-form">
                  <input
                    type="text"
                    placeholder="Type your message..."
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
                <h2>Settings</h2>
                <div className="settings-section">
                  <h3>Workspace Information</h3>
                  <div className="setting-item">
                    <label>Workspace Name</label>
                    <p>{workspace.name}</p>
                  </div>
                  <div className="setting-item">
                    <label>Created</label>
                    <p>{new Date(workspace.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="settings-actions">
                    <button type="button" onClick={() => setShowSettingsModal(true)}>
                      Open Workspace Settings
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {showSettingsModal && (
        <WorkspaceSettings
          workspaceId={id}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}

export default WorkspaceDetail;
