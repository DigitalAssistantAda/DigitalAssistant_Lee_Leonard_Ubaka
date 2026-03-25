import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, CheckCircle, XCircle, Clock, MessageSquare, Users, Trash2, FileText, ListTodo } from 'lucide-react';
import LoadingState from '../components/LoadingState';
import './Notifications.css';

function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [mentionNotifications, setMentionNotifications] = useState([]);
  const [taskNotifications, setTaskNotifications] = useState([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState([]);
  const [dismissedIds, setDismissedIds] = useState({
    deletion_request_ids: [],
    mention_ids: [],
    permanently_deleted_deletion_request_ids: [],
    permanently_deleted_mention_ids: [],
    task_notification_ids: [],
    permanently_deleted_task_notification_ids: [],
  });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('pending');
  const navigate = useNavigate();
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const currentUserId = useMemo(() => {
    try {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return null;
      const parsed = JSON.parse(rawUser);
      const id = parsed?.id ?? parsed?.user_id ?? null;
      return id == null ? null : Number(id);
    } catch {
      return null;
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`${API_URL}/api/v1/deletion-requests/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setNotifications([]);
      } else {
        const data = await response.json();
        setNotifications(data.requests || []);
      }

      const invitationsResponse = await fetch(`${API_URL}/api/v1/workspaces/invitations/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!invitationsResponse.ok) {
        setWorkspaceInvitations([]);
      } else {
        const invitationsData = await invitationsResponse.json();
        setWorkspaceInvitations(Array.isArray(invitationsData?.items) ? invitationsData.items : []);
      }

      const parseMetadata = (log) => {
        let metadata = {};
        if (typeof log.metadata_json === 'string') {
          try { metadata = JSON.parse(log.metadata_json); } catch { metadata = {}; }
        } else if (log.metadata_json && typeof log.metadata_json === 'object') {
          metadata = log.metadata_json;
        }
        return metadata;
      };

      const mentionsResponse = await fetch(`${API_URL}/api/v1/audit-logs?action=message.mentioned&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!mentionsResponse.ok) {
        setMentionNotifications([]);
      } else {
        const mentionsData = await mentionsResponse.json();
        const logs = Array.isArray(mentionsData?.logs) ? mentionsData.logs : [];
        const mentionRows = logs
          .map((log) => {
            const metadata = parseMetadata(log);
            const mentionedUserId = Number(metadata?.mentioned_user_id);
            if (!Number.isFinite(mentionedUserId) || (currentUserId != null && mentionedUserId !== currentUserId)) return null;
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

      const tasksAuditResponse = await fetch(`${API_URL}/api/v1/audit-logs?action=task.&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!tasksAuditResponse.ok) {
        setTaskNotifications([]);
      } else {
        const tasksData = await tasksAuditResponse.json();
        const tlogs = Array.isArray(tasksData?.logs) ? tasksData.logs : [];
        const taskRows = tlogs
          .map((log) => {
            const metadata = parseMetadata(log);
            const notifiedUserId = Number(metadata?.notified_user_id);
            if (!Number.isFinite(notifiedUserId) || (currentUserId != null && notifiedUserId !== currentUserId)) return null;
            const act = String(log.action || '');
            let kind = 'updated';
            if (act.includes('assigned')) kind = 'assigned';
            else if (act.includes('deleted')) kind = 'deleted';
            return {
              id: `task-${log.id}`,
              log_id: log.id,
              created_at: log.created_at,
              workspace_id: Number(metadata?.workspace_id ?? log.workspace_id),
              task_id: metadata?.task_id != null ? Number(metadata.task_id) : (log.object_id != null ? Number(log.object_id) : null),
              task_title: metadata?.task_title || '',
              kind,
            };
          })
          .filter(Boolean);
        setTaskNotifications(taskRows);
      }

      const prefsResponse = await fetch(`${API_URL}/api/v1/users/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (prefsResponse.ok) {
        const prefs = await prefsResponse.json();
        const d = prefs?.dismissed_notification_ids;
        setDismissedIds(
          d && typeof d === 'object'
            ? {
                deletion_request_ids: Array.isArray(d.deletion_request_ids) ? d.deletion_request_ids : [],
                mention_ids: Array.isArray(d.mention_ids) ? d.mention_ids : [],
                permanently_deleted_deletion_request_ids: Array.isArray(d.permanently_deleted_deletion_request_ids) ? d.permanently_deleted_deletion_request_ids : [],
                permanently_deleted_mention_ids: Array.isArray(d.permanently_deleted_mention_ids) ? d.permanently_deleted_mention_ids : [],
                task_notification_ids: Array.isArray(d.task_notification_ids) ? d.task_notification_ids : [],
                permanently_deleted_task_notification_ids: Array.isArray(d.permanently_deleted_task_notification_ids) ? d.permanently_deleted_task_notification_ids : [],
              }
            : {
                deletion_request_ids: [],
                mention_ids: [],
                permanently_deleted_deletion_request_ids: [],
                permanently_deleted_mention_ids: [],
                task_notification_ids: [],
                permanently_deleted_task_notification_ids: [],
              }
        );
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setNotifications([]);
      setMentionNotifications([]);
      setTaskNotifications([]);
      setWorkspaceInvitations([]);
    }
    setLoading(false);
  }, [API_URL, currentUserId]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications, filter]);

  useEffect(() => {
    const onUpdate = () => fetchNotifications();
    window.addEventListener('notifications-updated', onUpdate);
    return () => window.removeEventListener('notifications-updated', onUpdate);
  }, [fetchNotifications]);

  const handleAcceptWorkspaceInvite = async (invitationId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/invitations/${invitationId}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (response.ok) { fetchNotifications(); window.dispatchEvent(new Event('notifications-updated')); }
    } catch (error) { console.error('Error accepting workspace invitation:', error); }
  };

  const handleDeclineWorkspaceInvite = async (invitationId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/invitations/${invitationId}/decline`, {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (response.ok) { fetchNotifications(); window.dispatchEvent(new Event('notifications-updated')); }
    } catch (error) { console.error('Error declining workspace invitation:', error); }
  };

  const handleApprove = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/${requestId}/approve`, {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (response.ok) { fetchNotifications(); window.dispatchEvent(new Event('notifications-updated')); }
    } catch (error) { console.error('Error approving request:', error); }
  };

  const handleDeny = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/${requestId}/deny`, {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (response.ok) { fetchNotifications(); window.dispatchEvent(new Event('notifications-updated')); }
    } catch (error) { console.error('Error denying request:', error); }
  };

  const callDismissEndpoint = async (payload) => {
    return fetch(`${API_URL}/api/v1/users/notifications-dismiss`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const handleDismissDeletionRequest = async (requestId) => {
    try {
      const response = await callDismissEndpoint({ deletion_request_ids: [requestId] });
      if (response.ok) {
        setDismissedIds((prev) => ({ ...prev, deletion_request_ids: [...(prev.deletion_request_ids || []), requestId] }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error dismissing notification:', error); }
  };

  const handleDismissMention = async (mentionId) => {
    try {
      const response = await callDismissEndpoint({ mention_ids: [mentionId] });
      if (response.ok) {
        setDismissedIds((prev) => ({ ...prev, mention_ids: [...(prev.mention_ids || []), mentionId] }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error dismissing mention:', error); }
  };

  const handlePermanentlyDeleteDeletionRequest = async (requestId) => {
    try {
      const response = await callDismissEndpoint({ permanently_deleted_deletion_request_ids: [requestId] });
      if (response.ok) {
        setDismissedIds((prev) => ({ ...prev, permanently_deleted_deletion_request_ids: [...(prev.permanently_deleted_deletion_request_ids || []), requestId] }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error permanently deleting notification:', error); }
  };

  const handlePermanentlyDeleteMention = async (mentionId) => {
    try {
      const response = await callDismissEndpoint({ permanently_deleted_mention_ids: [mentionId] });
      if (response.ok) {
        setDismissedIds((prev) => ({ ...prev, permanently_deleted_mention_ids: [...(prev.permanently_deleted_mention_ids || []), mentionId] }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error permanently deleting mention:', error); }
  };

  const handleDismissTaskNotification = async (taskNotifId) => {
    try {
      const response = await callDismissEndpoint({ task_notification_ids: [taskNotifId] });
      if (response.ok) {
        setDismissedIds((prev) => ({ ...prev, task_notification_ids: [...(prev.task_notification_ids || []), taskNotifId] }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error dismissing task notification:', error); }
  };

  const handlePermanentlyDeleteTaskNotification = async (taskNotifId) => {
    try {
      const response = await callDismissEndpoint({ permanently_deleted_task_notification_ids: [taskNotifId] });
      if (response.ok) {
        setDismissedIds((prev) => ({ ...prev, permanently_deleted_task_notification_ids: [...(prev.permanently_deleted_task_notification_ids || []), taskNotifId] }));
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error permanently deleting task notification:', error); }
  };

  const handleOpenMentionDiscussion = (mention) => {
    const wsId = mention?.workspace_id;
    if (!wsId) return;
    navigate(`/workspace/${wsId}?tab=discussion`);
  };

  const handleOpenWorkspaceIssues = (row) => {
    const wsId = row?.workspace_id;
    if (!wsId) return;
    navigate(`/workspace/${wsId}/issues`);
  };

  const getStatusIcon = (statusValue) => {
    switch (statusValue) {
      case 'approved': return <CheckCircle size={18} className="status-icon approved" />;
      case 'denied': return <XCircle size={18} className="status-icon denied" />;
      case 'pending': return <Clock size={18} className="status-icon pending" />;
      default: return null;
    }
  };

  const getStatusBadge = (statusValue) => <span className={`status-badge ${statusValue}`}>{statusValue}</span>;

  const getRequesterLabel = (notification) => {
    const requester = notification?.requested_by_user;
    if (requester?.username && requester?.email) return `${requester.username} (${requester.email})`;
    if (requester?.username) return requester.username;
    if (requester?.email) return requester.email;
    if (notification?.requested_by != null) return `User #${notification.requested_by}`;
    return 'Unknown user';
  };

  const getRequestedDocumentLabel = (notification) => {
    if (notification?.document?.filename) return notification.document.filename;
    if (notification?.document_id != null) return `Document #${notification.document_id}`;
    return 'Unknown document';
  };

  const drDismissed = dismissedIds.deletion_request_ids || [];
  const mentionDismissed = dismissedIds.mention_ids || [];
  const permDrDeleted = dismissedIds.permanently_deleted_deletion_request_ids || [];
  const permMentionDeleted = dismissedIds.permanently_deleted_mention_ids || [];
  const taskDismissed = dismissedIds.task_notification_ids || [];
  const permTaskDeleted = dismissedIds.permanently_deleted_task_notification_ids || [];

  const pendingDeletionNotifications = notifications.filter(n => n.status === 'pending');
  const pendingCount = pendingDeletionNotifications.length + workspaceInvitations.length;

  // Non-pending, not permanently deleted
  const respondedNotDismissed = notifications.filter(
    (n) => n.status !== 'pending' && !drDismissed.includes(n.id) && !permDrDeleted.includes(n.id)
  );
  const mentionsNotDismissed = mentionNotifications.filter(
    (m) => !mentionDismissed.includes(m.id) && !permMentionDeleted.includes(m.id)
  );
  const dismissedRequests = notifications.filter(
    (n) => drDismissed.includes(n.id) && !permDrDeleted.includes(n.id)
  );
  const dismissedMentions = mentionNotifications.filter(
    (m) => mentionDismissed.includes(m.id) && !permMentionDeleted.includes(m.id)
  );
  const tasksNotDismissed = taskNotifications.filter(
    (t) => !taskDismissed.includes(t.id) && !permTaskDeleted.includes(t.id)
  );
  const dismissedTasks = taskNotifications.filter(
    (t) => taskDismissed.includes(t.id) && !permTaskDeleted.includes(t.id)
  );

  const allCount = pendingCount + respondedNotDismissed.length + mentionsNotDismissed.length + tasksNotDismissed.length + dismissedRequests.length + dismissedMentions.length + dismissedTasks.length;

  const hasAnyVisible = (() => {
    if (filter === 'pending') return pendingCount > 0;
    if (filter === 'all') return allCount > 0;
    return false;
  })();

  const formatDate = (dateStr, prefix) => {
    if (!dateStr) return `${prefix} unknown date`;
    const formatted = new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return prefix ? `${prefix} ${formatted}` : formatted;
  };

  const renderDeletionRequestCard = (notification, { faded, actions }) => (
    <div key={notification.id} className={`notification-card${faded ? ' notification-card--faded' : ''}`}>
      <div className="notification-content">
        <div className="notification-header">
          <div className="status-with-icon">
            {notification.status !== 'pending' && getStatusIcon(notification.status)}
            <h3>Document Deletion Request</h3>
          </div>
          {getStatusBadge(notification.status)}
        </div>
        <p className="notification-document-name">
          <FileText size={16} className="notification-document-icon" aria-hidden="true" />
          <span>{getRequestedDocumentLabel(notification)}</span>
        </p>
        <p className="notification-reason"><strong>Reason:</strong> {notification.reason || 'No reason provided'}</p>
        <p className="notification-requester"><strong>Requested by:</strong> {getRequesterLabel(notification)}</p>
        <p className="notification-date">
          {notification.status === 'approved' ? 'Approved' : notification.status === 'denied' ? 'Denied' : 'Requested'}{' '}
          {(notification.responded_at || notification.created_at)
            ? new Date(notification.responded_at || notification.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
            : 'unknown date'}
        </p>
      </div>
      <div className="notification-actions">{actions}</div>
    </div>
  );

  const renderTaskNotificationCard = (row, { faded, actions }) => {
    const title =
      row.kind === 'assigned' ? 'Task assigned to you' : row.kind === 'deleted' ? 'Task deleted' : 'Task updated';
    const badgeClass = row.kind === 'assigned' ? 'pending' : row.kind === 'deleted' ? 'denied' : 'mention';
    const badgeLabel = row.kind === 'assigned' ? 'assigned' : row.kind === 'deleted' ? 'deleted' : 'update';
    return (
      <div key={row.id} className={`notification-card${faded ? ' notification-card--faded' : ''}`}>
        <div className="notification-content">
          <div className="notification-header">
            <div className="status-with-icon">
              {row.kind === 'deleted' ? (
                <Trash2 size={18} className="status-icon denied" aria-hidden />
              ) : (
                <ListTodo size={18} className="status-icon pending" aria-hidden />
              )}
              <h3>{title}</h3>
            </div>
            {!faded && <span className={`status-badge ${badgeClass}`}>{badgeLabel}</span>}
          </div>
          <p className="notification-reason">
            {row.kind === 'deleted' ? (
              <>
                <strong>{row.task_title || `Task #${row.task_id ?? ''}`}</strong> was removed.
                {row.task_id != null && ` (#${row.task_id})`}
                {row.workspace_id != null && ` · workspace #${row.workspace_id}`}
              </>
            ) : (
              <>
                <strong>{row.task_title || `Task #${row.task_id ?? ''}`}</strong>
                {row.task_id != null && ` · #${row.task_id}`}
                {row.workspace_id != null && ` · workspace #${row.workspace_id}`}
              </>
            )}
          </p>
          <p className="notification-date">{formatDate(row.created_at, '')}</p>
        </div>
        <div className="notification-actions">{actions}</div>
      </div>
    );
  };

  const renderMentionCard = (mention, { faded, actions }) => (
    <div key={mention.id} className={`notification-card${faded ? ' notification-card--faded' : ''}`}>
      <div className="notification-content">
        <div className="notification-header">
          <div className="status-with-icon">
            <MessageSquare size={18} className="status-icon mention" />
            <h3>You were mentioned</h3>
          </div>
          {!faded && <span className="status-badge mention">Mention</span>}
        </div>
        <p className="notification-reason">Mentioned in workspace #{mention.workspace_id}</p>
        <p className="notification-date">{formatDate(mention.created_at, '')}</p>
      </div>
      <div className="notification-actions">{actions}</div>
    </div>
  );

  return (
    <div className="notifications-page">
      <div className="notifications-hero">
        <h1>Notifications</h1>
        <p>Requests, invitations, mentions, and task activity across your workspaces.</p>
      </div>

      <div className="filter-tabs">
        <button className={`filter-tab ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>
          Pending ({pendingCount})
        </button>
        <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All ({allCount})
        </button>
      </div>

      <div className="notifications-list">
        {loading && <LoadingState className="loading-state" message="Loading notifications..." size={36} />}

        {!loading && !hasAnyVisible && (
          <div className="empty-state">
            <Clock size={48} />
            <h2>No notifications</h2>
            <p>You're all caught up!</p>
          </div>
        )}

        {/* Pending deletion requests */}
        {!loading && pendingDeletionNotifications.length > 0 && (
          <>
            <div className="section-title">Awaiting Your Decision</div>
            {pendingDeletionNotifications.map((n) =>
              renderDeletionRequestCard(n, {
                faded: false,
                actions: (
                  <>
                    <button type="button" className="icon-action icon-action-accept" onClick={() => handleApprove(n.id)} title="Approve" aria-label="Approve deletion request"><Check size={18} strokeWidth={2.5} /></button>
                    <button type="button" className="icon-action icon-action-decline" onClick={() => handleDeny(n.id)} title="Deny" aria-label="Deny deletion request"><X size={18} strokeWidth={2.5} /></button>
                  </>
                ),
              })
            )}
          </>
        )}

        {/* Workspace invitations */}
        {!loading && workspaceInvitations.length > 0 && (
          <>
            <div className="section-title">Workspace Invitations</div>
            {workspaceInvitations.map((invitation) => (
              <div key={`workspace-invite-${invitation.invitation_id}`} className="notification-card">
                <div className="notification-content">
                  <div className="notification-header">
                    <div className="status-with-icon">
                      <Users size={18} className="status-icon pending" />
                      <h3>Workspace Invitation</h3>
                    </div>
                    <span className="status-badge pending">pending</span>
                  </div>
                  <p className="notification-reason">You were invited to join <strong>{invitation.workspace_name}</strong> as <strong>{invitation.role}</strong>.</p>
                  <p className="notification-date">{formatDate(invitation.invited_at, 'Invited')}</p>
                </div>
                <div className="notification-actions">
                  <button type="button" className="icon-action icon-action-accept" onClick={() => handleAcceptWorkspaceInvite(invitation.invitation_id)} title="Accept" aria-label="Accept workspace invitation"><Check size={18} strokeWidth={2.5} /></button>
                  <button type="button" className="icon-action icon-action-decline" onClick={() => handleDeclineWorkspaceInvite(invitation.invitation_id)} title="Decline" aria-label="Decline workspace invitation"><X size={18} strokeWidth={2.5} /></button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* All tab only: responded requests (not dismissed) */}
        {!loading && filter === 'all' && respondedNotDismissed.length > 0 && (
          <>
            <div className="section-title">Responded</div>
            {respondedNotDismissed.map((n) =>
              renderDeletionRequestCard(n, {
                faded: false,
                actions: (
                  <button type="button" className="btn btn-dismiss" onClick={() => handleDismissDeletionRequest(n.id)} title="Dismiss" aria-label="Dismiss notification"><Trash2 size={15} /> Dismiss</button>
                ),
              })
            )}
          </>
        )}

        {/* All tab only: active mentions (not dismissed) */}
        {!loading && filter === 'all' && mentionsNotDismissed.length > 0 && (
          <>
            <div className="section-title">Mentions</div>
            {mentionsNotDismissed.map((m) =>
              renderMentionCard(m, {
                faded: false,
                actions: (
                  <>
                    <button className="btn btn-mention-open" onClick={() => handleOpenMentionDiscussion(m)}>Open discussion</button>
                    <button type="button" className="btn btn-dismiss" onClick={() => handleDismissMention(m.id)} title="Dismiss" aria-label="Dismiss mention"><Trash2 size={15} /> Dismiss</button>
                  </>
                ),
              })
            )}
          </>
        )}

        {!loading && filter === 'all' && tasksNotDismissed.length > 0 && (
          <>
            <div className="section-title">Tasks</div>
            {tasksNotDismissed.map((t) =>
              renderTaskNotificationCard(t, {
                faded: false,
                actions: (
                  <>
                    <button type="button" className="btn btn-mention-open" onClick={() => handleOpenWorkspaceIssues(t)}>Open issues</button>
                    <button type="button" className="btn btn-dismiss" onClick={() => handleDismissTaskNotification(t.id)} title="Dismiss" aria-label="Dismiss task notification"><Trash2 size={15} /> Dismiss</button>
                  </>
                ),
              })
            )}
          </>
        )}

        {/* All tab only: dismissed requests (faded, with permanent delete) */}
        {!loading && filter === 'all' && (dismissedRequests.length > 0 || dismissedMentions.length > 0 || dismissedTasks.length > 0) && (
          <>
            <div className="section-title">Dismissed</div>
            {dismissedRequests.map((n) =>
              renderDeletionRequestCard(n, {
                faded: true,
                actions: (
                  <button type="button" className="btn btn-permanent-delete" onClick={() => handlePermanentlyDeleteDeletionRequest(n.id)} title="Delete permanently" aria-label="Permanently delete notification"><Trash2 size={15} /> Delete</button>
                ),
              })
            )}
            {dismissedMentions.map((m) =>
              renderMentionCard(m, {
                faded: true,
                actions: (
                  <button type="button" className="btn btn-permanent-delete" onClick={() => handlePermanentlyDeleteMention(m.id)} title="Delete permanently" aria-label="Permanently delete mention"><Trash2 size={15} /> Delete</button>
                ),
              })
            )}
            {dismissedTasks.map((t) =>
              renderTaskNotificationCard(t, {
                faded: true,
                actions: (
                  <button type="button" className="btn btn-permanent-delete" onClick={() => handlePermanentlyDeleteTaskNotification(t.id)} title="Delete permanently" aria-label="Permanently delete task notification"><Trash2 size={15} /> Delete</button>
                ),
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default NotificationsPage;
