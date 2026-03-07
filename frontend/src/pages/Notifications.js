import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock, MessageSquare, Users, Trash2, FileText } from 'lucide-react';
import LoadingState from '../components/LoadingState';
import './Notifications.css';

function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [mentionNotifications, setMentionNotifications] = useState([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState([]);
  const [dismissedIds, setDismissedIds] = useState({ deletion_request_ids: [], mention_ids: [] });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('pending'); // pending, approved, denied, all
  const navigate = useNavigate();
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const currentUserId = (() => {
    try {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return null;
      const parsed = JSON.parse(rawUser);
      const id = parsed?.id ?? parsed?.user_id ?? null;
      return id == null ? null : Number(id);
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    fetchNotifications();
  }, [filter]);

  useEffect(() => {
    const onUpdate = () => fetchNotifications();
    window.addEventListener('notifications-updated', onUpdate);
    return () => window.removeEventListener('notifications-updated', onUpdate);
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/all`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        setNotifications([]);
      } else {
        const data = await response.json();
        setNotifications(data.requests || []);
      }

      const invitationsResponse = await fetch(`${API_URL}/api/v1/workspaces/invitations/pending`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!invitationsResponse.ok) {
        setWorkspaceInvitations([]);
      } else {
        const invitationsData = await invitationsResponse.json();
        setWorkspaceInvitations(Array.isArray(invitationsData?.items) ? invitationsData.items : []);
      }

      const mentionsResponse = await fetch(`${API_URL}/api/v1/audit-logs?action=message.mentioned&limit=200`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!mentionsResponse.ok) {
        setMentionNotifications([]);
      } else {
        const mentionsData = await mentionsResponse.json();
        const logs = Array.isArray(mentionsData?.logs) ? mentionsData.logs : [];
        const mentionRows = logs
          .map((log) => {
            let metadata = {};
            if (typeof log.metadata_json === 'string') {
              try {
                metadata = JSON.parse(log.metadata_json);
              } catch {
                metadata = {};
              }
            } else if (log.metadata_json && typeof log.metadata_json === 'object') {
              metadata = log.metadata_json;
            }

            const mentionedUserId = Number(metadata?.mentioned_user_id);
            if (!Number.isFinite(mentionedUserId) || (currentUserId != null && mentionedUserId !== currentUserId)) {
              return null;
            }

            return {
              id: `mention-${log.id}`,
              created_at: log.created_at,
              workspace_id: Number(log.workspace_id),
              message_id: metadata?.message_id || log.object_id || null,
              mentioned_username: metadata?.mentioned_username || '',
            };
          })
          .filter(Boolean);

        setMentionNotifications(mentionRows);
      }

      const prefsResponse = await fetch(`${API_URL}/api/v1/users/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (prefsResponse.ok) {
        const prefs = await prefsResponse.json();
        const d = prefs?.dismissed_notification_ids;
        setDismissedIds(d && typeof d === 'object' ? {
          deletion_request_ids: Array.isArray(d.deletion_request_ids) ? d.deletion_request_ids : [],
          mention_ids: Array.isArray(d.mention_ids) ? d.mention_ids : [],
        } : { deletion_request_ids: [], mention_ids: [] });
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setNotifications([]);
      setMentionNotifications([]);
      setWorkspaceInvitations([]);
    }
    setLoading(false);
  };

  const handleAcceptWorkspaceInvite = async (invitationId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/invitations/${invitationId}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        fetchNotifications();
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Error accepting workspace invitation:', error);
    }
  };

  const handleDeclineWorkspaceInvite = async (invitationId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/invitations/${invitationId}/decline`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        fetchNotifications();
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Error declining workspace invitation:', error);
    }
  };

  const handleApprove = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        fetchNotifications();
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Error approving request:', error);
    }
  };

  const handleDeny = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/${requestId}/deny`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        fetchNotifications();
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Error denying request:', error);
    }
  };

  const handleDismissDeletionRequest = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/users/notifications-dismiss`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deletion_request_ids: [requestId] }),
      });
      if (response.ok) {
        setDismissedIds((prev) => ({
          ...prev,
          deletion_request_ids: [...(prev.deletion_request_ids || []), requestId],
        }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Error dismissing notification:', error);
    }
  };

  const handleDismissMention = async (mentionId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/users/notifications-dismiss`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mention_ids: [mentionId] }),
      });
      if (response.ok) {
        setDismissedIds((prev) => ({
          ...prev,
          mention_ids: [...(prev.mention_ids || []), mentionId],
        }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Error dismissing mention:', error);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved':
        return <CheckCircle size={20} className="status-icon approved" />;
      case 'denied':
        return <XCircle size={20} className="status-icon denied" />;
      case 'pending':
        return <Clock size={20} className="status-icon pending" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status) => {
    return <span className={`status-badge ${status}`}>{status}</span>;
  };

  const getRequesterLabel = (notification) => {
    const requester = notification?.requested_by_user;
    if (requester?.username && requester?.email) {
      return `${requester.username} (${requester.email})`;
    }
    if (requester?.username) {
      return requester.username;
    }
    if (requester?.email) {
      return requester.email;
    }
    if (notification?.requested_by != null) {
      return `User #${notification.requested_by}`;
    }
    return 'Unknown user';
  };

  const getRequestedDocumentLabel = (notification) => {
    const filename = notification?.document?.filename;
    if (filename) {
      return filename;
    }
    if (notification?.document_id != null) {
      return `Document #${notification.document_id}`;
    }
    return 'Unknown document';
  };

  const pendingDeletionNotifications = notifications.filter(n => n.status === 'pending');
  const pendingCount = pendingDeletionNotifications.length + workspaceInvitations.length;
  const drDismissed = dismissedIds.deletion_request_ids || [];
  const mentionDismissed = dismissedIds.mention_ids || [];
  const displayResponded = filter === 'all'
    ? notifications.filter(n => n.status !== 'pending' && !drDismissed.includes(n.id))
    : [];
  const displayMentions = filter === 'all'
    ? mentionNotifications.filter(m => !mentionDismissed.includes(m.id))
    : [];
  const displayInvitations = workspaceInvitations;
  const allCount =
    pendingDeletionNotifications.length +
    displayInvitations.length +
    displayResponded.length +
    displayMentions.length;
  const hasAnyVisibleNotifications =
    pendingDeletionNotifications.length > 0 ||
    displayMentions.length > 0 ||
    displayInvitations.length > 0 ||
    displayResponded.length > 0;

  return (
    <div className="notifications-page">
      <div className="notifications-header">
        <button 
          className="back-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ArrowLeft size={24} />
        </button>
        <h1>Notifications</h1>
        <div className="header-spacer"></div>
      </div>

      <div className="notifications-container">
        <div className="filter-tabs">
          <button 
            className={`filter-tab ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            Pending ({pendingCount})
          </button>
          <button 
            className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({allCount})
          </button>
        </div>

        <div className="notifications-list">
          {loading && (
            <LoadingState className="loading-state" message="Loading notifications..." size={36} />
          )}

          {!loading && !hasAnyVisibleNotifications && (
            <div className="empty-state">
              <Clock size={48} />
              <h2>No notifications</h2>
              <p>You're all caught up!</p>
            </div>
          )}

          {!loading && pendingDeletionNotifications.length > 0 && (
            <>
              <div className="section-title">Awaiting Your Decision</div>
              {pendingDeletionNotifications.map(notification => (
                <div key={notification.id} className="notification-card pending-card">
                  <div className="notification-content">
                    <div className="notification-header">
                      <h3>Document Deletion Request</h3>
                      {getStatusBadge(notification.status)}
                    </div>
                    <p className="notification-document notification-document-name">
                      <FileText size={18} className="notification-document-icon" aria-hidden="true" />
                      <span>{getRequestedDocumentLabel(notification)}</span>
                    </p>
                    <p className="notification-reason">
                      <strong>Reason:</strong> {notification.reason || 'No reason provided'}
                    </p>
                    <p className="notification-requester">
                      <strong>Requested by:</strong> {getRequesterLabel(notification)}
                    </p>
                    <p className="notification-date">
                      Requested on {new Date(notification.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <div className="notification-actions">
                    <button 
                      className="btn btn-approve btn-icon-action"
                      onClick={() => handleApprove(notification.id)}
                      aria-label="Approve"
                    >
                      ✓
                    </button>
                    <button 
                      className="btn btn-deny btn-icon-action"
                      onClick={() => handleDeny(notification.id)}
                      aria-label="Deny"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && displayInvitations.length > 0 && (
            <>
              <div className="section-title">Workspace Invitations</div>
              {displayInvitations.map((invitation) => (
                <div key={`workspace-invite-${invitation.invitation_id}`} className="notification-card pending-card invitation-card">
                  <div className="notification-content">
                    <div className="notification-header">
                      <div className="status-with-icon">
                        <Users size={20} className="status-icon pending" />
                        <h3>Workspace Invitation</h3>
                      </div>
                      <span className="status-badge pending">pending</span>
                    </div>
                    <p className="notification-reason">
                      You were invited to join <strong>{invitation.workspace_name}</strong> as <strong>{invitation.role}</strong>.
                    </p>
                    <p className="notification-date">
                      Invited on {new Date(invitation.invited_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <div className="notification-actions">
                    <button
                      className="btn btn-approve btn-icon-action"
                      onClick={() => handleAcceptWorkspaceInvite(invitation.invitation_id)}
                      aria-label="Accept"
                    >
                      ✓
                    </button>
                    <button
                      className="btn btn-deny btn-icon-action"
                      onClick={() => handleDeclineWorkspaceInvite(invitation.invitation_id)}
                      aria-label="Decline"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && displayResponded.length > 0 && (
            <>
              <div className="section-title">History</div>
              {displayResponded.map(notification => (
                <div key={notification.id} className="notification-card responded-card">
                  <div className="notification-content">
                    <div className="notification-header">
                      <div className="status-with-icon">
                        {getStatusIcon(notification.status)}
                        <h3>Document Deletion Request</h3>
                      </div>
                      {getStatusBadge(notification.status)}
                    </div>
                    <p className="notification-document notification-document-name">
                      <FileText size={18} className="notification-document-icon" aria-hidden="true" />
                      <span>{getRequestedDocumentLabel(notification)}</span>
                    </p>
                    <p className="notification-requester">
                      <strong>Requested by:</strong> {getRequesterLabel(notification)}
                    </p>
                    <p className="notification-reason">
                      <strong>Reason:</strong> {notification.reason || 'No reason provided'}
                    </p>
                    <p className="notification-date">
                      {notification.status === 'approved' ? 'Approved' : 'Denied'} on{' '}
                      {notification.responded_at 
                        ? new Date(notification.responded_at).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })
                        : 'Unknown date'
                      }
                    </p>
                  </div>
                  <div className="notification-actions">
                    <button
                      type="button"
                      className="btn btn-dismiss"
                      onClick={() => handleDismissDeletionRequest(notification.id)}
                      title="Remove from list"
                      aria-label="Dismiss notification"
                    >
                      <Trash2 size={18} />
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && displayMentions.length > 0 && (
            <>
              <div className="section-title">Mentions</div>
              {displayMentions.map((mention) => (
                <div key={mention.id} className="notification-card mention-card">
                  <div className="notification-content">
                    <div className="notification-header">
                      <div className="status-with-icon">
                        <MessageSquare size={20} className="status-icon mention" />
                        <h3>You were mentioned</h3>
                      </div>
                      <span className="status-badge mention">Mention</span>
                    </div>
                    <p className="notification-reason">
                      Mentioned in workspace #{mention.workspace_id}
                    </p>
                    <p className="notification-date">
                      {new Date(mention.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <div className="notification-actions">
                    <button
                      className="btn btn-mention-open"
                      onClick={() => {
                        const params = new URLSearchParams({ tab: 'discussion' });
                        if (mention.message_id != null) {
                          params.set('messageId', String(mention.message_id));
                        }
                        navigate(`/workspace/${mention.workspace_id}?${params.toString()}`);
                      }}
                    >
                      Open discussion
                    </button>
                    <button
                      type="button"
                      className="btn btn-dismiss"
                      onClick={() => handleDismissMention(mention.id)}
                      title="Remove from list"
                      aria-label="Dismiss mention"
                    >
                      <Trash2 size={18} />
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotificationsPage;