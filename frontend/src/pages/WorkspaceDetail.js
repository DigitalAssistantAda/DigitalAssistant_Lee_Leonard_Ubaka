import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './WorkspaceDetail.css';

function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [documents, setDocuments] = useState([]);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const getInitial = (value) => {
    if (!value || typeof value !== 'string') return '?';
    return value.charAt(0).toUpperCase();
  };

  useEffect(() => {
    const fetchWorkspaceDetail = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/v1/workspaces/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (!response.ok) throw new Error('Failed to fetch workspace');
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
    <div className="workspace-detail-page">
      <header className="detail-header">
        <button className="back-btn" onClick={() => navigate('/workspace')}>&larr; Back</button>
        <div className="header-content">
          <h1>{workspace.name}</h1>
          <p>ID: {workspace.id} • {workspace.member_count ?? 0} Members • {workspace.document_count ?? 0} Documents</p>
        </div>
      </header>

      <div className="detail-container">
        <nav className="detail-tabs">
          <button
            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`tab ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
          >
            Documents
          </button>
          <button
            className={`tab ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            Members
          </button>
          <button
            className={`tab ${activeTab === 'discussion' ? 'active' : ''}`}
            onClick={() => setActiveTab('discussion')}
          >
            Discussion
          </button>
          <button
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </nav>

        <div className="detail-content">
          {activeTab === 'overview' && (
            <div className="tab-overview">
              <h2>Overview</h2>
              <div className="stats-grid">
                <div className="stat-card">
                  <h3>{workspace.document_count ?? 0}</h3>
                  <p>Documents</p>
                </div>
                <div className="stat-card">
                  <h3>{workspace.member_count ?? 0}</h3>
                  <p>Members</p>
                </div>
                <div className="stat-card">
                  <h3>{new Date(workspace.created_at).toLocaleDateString()}</h3>
                  <p>Created</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="tab-documents">
              <h2>Documents</h2>
              {documents.length === 0 ? (
                <p className="empty-message">No documents in this workspace</p>
              ) : (
                <div className="documents-list">
                  {documents.map((doc) => (
                    <div key={doc.id} className="document-item">
                      <div className="doc-name">{doc.filename}</div>
                      <div className="doc-meta">Uploaded by {doc.uploaded_by}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            <div className="tab-members">
              <h2>Members</h2>
              {members.length === 0 ? (
                <p className="empty-message">No members in this workspace</p>
              ) : (
                <div className="members-list">
                  {members.map((member, index) => (
                    <div key={member.id ?? member.user_id ?? index} className="member-item">
                      <div className="member-avatar">{getInitial(member.username ?? member.email)}</div>
                      <div>
                        <div className="member-name">{member.username ?? member.email ?? 'Unknown user'}</div>
                        <div className="member-role">{member.role ?? 'member'}</div>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDetail;
