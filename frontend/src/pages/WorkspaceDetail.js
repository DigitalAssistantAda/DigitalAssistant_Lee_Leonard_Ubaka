import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileText, MessageSquare, AlertCircle, Settings } from 'lucide-react';
import WorkspaceSettings from './WorkspaceSettings';
import LoadingState from '../components/LoadingState';
import AccessState from '../components/AccessState';
import { getApiErrorMessage, isWorkspaceAccessErrorMessage } from '../utils/apiError';
import { buildAccentStyleVars } from '../utils/accentAccessibility';
import './WorkspaceDetail.css';

function WorkspaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [liveMemberCount, setLiveMemberCount] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [workspaceMemberUsernames, setWorkspaceMemberUsernames] = useState([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [messageCaret, setMessageCaret] = useState(0);
  const [issueCount, setIssueCount] = useState(0);
  const [issueHasUpdates, setIssueHasUpdates] = useState(false);
  const [targetMessageId, setTargetMessageId] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [pendingAutoScroll, setPendingAutoScroll] = useState(false);
  const messageInputRef = useRef(null);
  const messageRowRefs = useRef(new Map());
  const highlightClearTimeoutRef = useRef(null);
  const messagesContainerRef = useRef(null);

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

  const documentCount = workspace?.document_count ?? 0;
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

  const mentionSuggestions = useMemo(() => {
    if (!showMentionSuggestions) return [];
    const normalized = mentionQuery.trim().toLowerCase();
    const uniqueNames = Array.from(new Set(workspaceMemberUsernames.map((name) => String(name || '').trim()).filter(Boolean)));
    if (!normalized) {
      return uniqueNames.slice(0, 6);
    }
    return uniqueNames
      .filter((name) => name.toLowerCase().startsWith(normalized) || name.toLowerCase().includes(normalized))
      .slice(0, 6);
  }, [showMentionSuggestions, mentionQuery, workspaceMemberUsernames]);

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
      const usernames = items
        .map((member) => String(member?.username || '').trim())
        .filter(Boolean);
      setWorkspaceMemberUsernames(usernames);
    } catch (err) {
      console.error('Failed to fetch member count:', err);
    }
  }, [API_URL, id]);

  const updateMentionState = useCallback((value, caretPosition) => {
    const beforeCaret = value.slice(0, caretPosition);
    const match = beforeCaret.match(/(?:^|\s)@([A-Za-z0-9_.-]{0,50})$/);
    if (!match) {
      setMentionQuery('');
      setShowMentionSuggestions(false);
      return;
    }
    setMentionQuery(match[1] || '');
    setShowMentionSuggestions(true);
  }, []);

  const getSearchState = useCallback(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const nextTab = tab === 'discussion' || tab === 'overview' || tab === 'settings'
      ? tab
      : 'overview';
    const messageIdParam = params.get('messageId');
    return {
      tab: nextTab,
      messageId: messageIdParam ? String(messageIdParam) : null,
    };
  }, [location.search]);

  const handleMessageInputChange = (event) => {
    const value = event.target.value;
    const caretPosition = event.target.selectionStart ?? value.length;
    setNewMessage(value);
    setMessageCaret(caretPosition);
    setMessageError('');
    updateMentionState(value, caretPosition);
  };

  const handleMentionSelect = (username) => {
    const beforeCaret = newMessage.slice(0, messageCaret);
    const afterCaret = newMessage.slice(messageCaret);
    const atIndex = beforeCaret.lastIndexOf('@');
    if (atIndex < 0) return;

    const nextMessage = `${beforeCaret.slice(0, atIndex)}@${username} ${afterCaret}`;
    const nextCaret = beforeCaret.slice(0, atIndex).length + username.length + 2;

    setNewMessage(nextMessage);
    setMessageCaret(nextCaret);
    setMentionQuery('');
    setShowMentionSuggestions(false);

    setTimeout(() => {
      if (messageInputRef.current) {
        messageInputRef.current.focus();
        messageInputRef.current.setSelectionRange(nextCaret, nextCaret);
      }
    }, 0);
  };

  const renderMessageContent = (content, mentionedUsernames) => {
    const mentionSet = new Set((Array.isArray(mentionedUsernames) ? mentionedUsernames : []).map((name) => String(name || '').toLowerCase()));
    const parts = String(content || '').split(/(@[A-Za-z0-9_.-]{1,50})/g);
    return parts.map((part, index) => {
      const isToken = /^@[A-Za-z0-9_.-]{1,50}$/.test(part);
      if (!isToken) {
        return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
      }
      const normalized = part.slice(1).toLowerCase();
      const isMention = mentionSet.has(normalized);
      return (
        <span
          key={`mention-${index}`}
          className={isMention ? 'message-mention' : 'message-token'}
        >
          {part}
        </span>
      );
    });
  };

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

  useEffect(() => {
    const { tab, messageId } = getSearchState();
    setActiveTab(tab);
    setTargetMessageId(tab === 'discussion' ? messageId : null);
    setPendingAutoScroll(tab === 'discussion' && !messageId);
  }, [getSearchState, id]);

  useEffect(() => {
    if (activeTab !== 'discussion' || !targetMessageId || messages.length === 0) {
      return;
    }
    const targetRow = messageRowRefs.current.get(String(targetMessageId));
    if (!targetRow) {
      return;
    }

    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(String(targetMessageId));
    setTargetMessageId(null);

    if (highlightClearTimeoutRef.current) {
      clearTimeout(highlightClearTimeoutRef.current);
    }
    highlightClearTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
    }, 1500);
  }, [activeTab, targetMessageId, messages]);

  useEffect(() => {
    if (activeTab !== 'discussion' || !pendingAutoScroll || targetMessageId || messages.length === 0) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      setPendingAutoScroll(false);
      return;
    }

    const forceBottom = () => {
      container.scrollTop = container.scrollHeight;
    };

    const raf1 = requestAnimationFrame(forceBottom);
    const raf2 = requestAnimationFrame(forceBottom);
    const t1 = setTimeout(forceBottom, 60);
    const t2 = setTimeout(() => setPendingAutoScroll(false), 140);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [activeTab, pendingAutoScroll, targetMessageId, messages]);

  useEffect(() => {
    return () => {
      if (highlightClearTimeoutRef.current) {
        clearTimeout(highlightClearTimeoutRef.current);
      }
    };
  }, []);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setMessageError('');
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
        await response.json();
        setNewMessage('');
        setMentionQuery('');
        setShowMentionSuggestions(false);
        await fetchMessages();
        setPendingAutoScroll(true);
      } else {
        const message = await getApiErrorMessage(response, 'Failed to send message');
        setMessageError(message);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessageError('Failed to send message');
    } finally {
      setMessageLoading(false);
    }
  };

  if (loading) return <div className="workspace-detail-page"><LoadingState className="loading" message="Loading workspace..." size={40} /></div>;
  if (error) {
    if (isWorkspaceAccessErrorMessage(error)) {
      return (
        <div className="workspace-detail-page">
          <AccessState
            title="This workspace drifted away"
            message="We couldn’t open this workspace. It may not exist, or you may not have access."
            primaryLabel="View Workspaces"
            primaryTo="/workspace"
          />
        </div>
      );
    }
    return <div className="workspace-detail-page"><div className="error">{error}</div></div>;
  }
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
              className={`detail-nav-item ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
              type="button"
              title="Overview"
              aria-label="Overview"
            >
              <span className="detail-nav-icon" aria-hidden="true"><LayoutDashboard size={16} /></span>
              <span className="detail-nav-label">Overview</span>
              <span className="detail-nav-meta" />
            </button>
            <button
              className="detail-nav-item"
              onClick={() => {
                const containerId = workspace?.default_container_id;
                if (containerId != null) {
                  navigate(`/documents/${containerId}`);
                } else {
                  navigate(`/documents?workspaceId=${id}`);
                }
              }}
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
              onClick={() => {
                setTargetMessageId(null);
                setPendingAutoScroll(true);
                setActiveTab('discussion');
              }}
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
            {activeTab === 'overview' && (
              <div className="tab-overview">
                <div className="overview-head">
                  <h2>Workspace overview</h2>
                  <p className="overview-subtitle">Key details for {workspace.name}</p>
                </div>
                <div className="overview-stats">
                  <div className="overview-stat">
                    <span className="overview-stat-label">Created</span>
                    <span className="overview-stat-value">
                      {workspace.created_at
                        ? new Date(workspace.created_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })
                        : '—'}
                    </span>
                  </div>
                  <div className="overview-stat">
                    <span className="overview-stat-label">Members</span>
                    <span className="overview-stat-value">{memberCount}</span>
                  </div>
                  <div className="overview-stat">
                    <span className="overview-stat-label">Documents</span>
                    <span className="overview-stat-value">{documentCount}</span>
                  </div>
                  <div className="overview-stat">
                    <span className="overview-stat-label">Workspace ID</span>
                    <span className="overview-stat-value">{workspace.id}</span>
                  </div>
                </div>
              </div>
            )}
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

                <div className="messages-container" ref={messagesContainerRef}>
                  <div className="messages-surface">
                    {messages.length === 0 ? (
                      <p className="empty-message">No messages yet. Start the conversation.</p>
                    ) : (
                      messages.map((msg, index) => {
                        const author = String(msg.sender_username ?? msg.sender ?? msg.user ?? 'Unknown');
                        const isSelf = currentUsername && author.toLowerCase() === currentUsername;
                        const messageKey = msg.id != null ? String(msg.id) : '';

                        return (
                          <div
                            key={msg.id ?? index}
                            ref={(element) => {
                              if (!messageKey) return;
                              if (element) {
                                messageRowRefs.current.set(messageKey, element);
                              } else {
                                messageRowRefs.current.delete(messageKey);
                              }
                            }}
                            className={`message-row ${isSelf ? 'self' : ''} ${highlightedMessageId === messageKey ? 'targeted' : ''}`}
                          >
                            {!isSelf && (
                              <div className="message-avatar">{getInitial(author)}</div>
                            )}
                            <div className="message-body">
                              <div className="message-header">
                                <span className="message-author">{isSelf ? 'You' : author}</span>
                                <span className="message-time">{formatMessageTime(msg.created_at)}</span>
                              </div>
                              <div className="message-bubble">
                                {renderMessageContent(msg.content, msg.mentioned_usernames)}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="message-form-wrap">
                  {showMentionSuggestions && mentionSuggestions.length > 0 && (
                    <div className="mention-suggestions" role="listbox" aria-label="Mention suggestions">
                      {mentionSuggestions.map((username) => (
                        <button
                          type="button"
                          key={username}
                          className="mention-suggestion-item"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleMentionSelect(username)}
                        >
                          @{username}
                        </button>
                      ))}
                    </div>
                  )}
                  <form onSubmit={handleSendMessage} className="message-form">
                    <input
                      ref={messageInputRef}
                      type="text"
                      placeholder="Type a message… Use @ to mention"
                      value={newMessage}
                      onChange={handleMessageInputChange}
                      onClick={(event) => {
                        const caretPosition = event.target.selectionStart ?? newMessage.length;
                        setMessageCaret(caretPosition);
                        updateMentionState(newMessage, caretPosition);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && showMentionSuggestions) {
                          setShowMentionSuggestions(false);
                          setMentionQuery('');
                        }
                        if (event.key === 'Enter' && showMentionSuggestions && mentionSuggestions.length > 0) {
                          event.preventDefault();
                          handleMentionSelect(mentionSuggestions[0]);
                        }
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          setShowMentionSuggestions(false);
                        }, 120);
                      }}
                      onFocus={(event) => {
                        const caretPosition = event.target.selectionStart ?? newMessage.length;
                        setMessageCaret(caretPosition);
                        updateMentionState(newMessage, caretPosition);
                      }}
                      disabled={messageLoading}
                    />
                    <button type="submit" disabled={!newMessage.trim() || messageLoading}>
                      Send
                    </button>
                  </form>
                </div>
                {messageError && <p className="message-error-inline">{messageError}</p>}
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
