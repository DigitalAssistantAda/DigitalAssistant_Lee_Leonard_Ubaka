import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock, MessageSquare, Users } from 'lucide-react';
import LoadingState from '../components/LoadingState';
import './Notifications.css';

function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [mentionNotifications, setMentionNotifications] = useState([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState([]);
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
      }
    } catch (error) {
      console.error('Error denying request:', error);
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

  const pendingDeletionNotifications = notifications.filter(n => n.status === 'pending');
  const pendingCount = pendingDeletionNotifications.length + workspaceInvitations.length;
  const displayResponded = filter === 'all'
    ? notifications.filter(n => n.status !== 'pending')
    : [];
  const displayMentions = filter === 'all' ? mentionNotifications : [];
  const displayInvitations = workspaceInvitations;
  const allCount = notifications.length + mentionNotifications.length + workspaceInvitations.length;
  const hasAnyVisibleNotifications =
    pendingDeletionNotifications.length > 0 ||
    displayMentions.length > 0 ||
    displayInvitations.length > 0;

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
                    <p className="notification-reason">
                      <strong>Reason:</strong> {notification.reason || 'No reason provided'}
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
                      className="btn btn-approve"
                      onClick={() => handleApprove(notification.id)}
                    >
                      Approve
                    </button>
                    <button 
                      className="btn btn-deny"
                      onClick={() => handleDeny(notification.id)}
                    >
                      Deny
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
                      className="btn btn-approve"
                      onClick={() => handleAcceptWorkspaceInvite(invitation.invitation_id)}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-deny"
                      onClick={() => handleDeclineWorkspaceInvite(invitation.invitation_id)}
                    >
                      Decline
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
                      onClick={() => navigate(`/workspace/${mention.workspace_id}`)}
                    >
                      Open discussion
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