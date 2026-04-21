import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, CheckCircle, XCircle, Clock, MessageSquare, Users, Trash2, FileText, ListTodo, Bell } from 'lucide-react';
import LoadingState from '../components/LoadingState';
import './Notifications.css';

const EMPTY_DISMISSED = {
  deletion_request_ids: [],
  mention_ids: [],
  permanently_deleted_deletion_request_ids: [],
  permanently_deleted_mention_ids: [],
  task_notification_ids: [],
  permanently_deleted_task_notification_ids: [],
  workspace_invitation_ids: [],
  permanently_deleted_workspace_invitation_ids: [],
};

function normalizeDismissedFromApi(d) {
  if (!d || typeof d !== 'object') return { ...EMPTY_DISMISSED };
  const asStrings = (arr) => (Array.isArray(arr) ? arr.map((x) => String(x)) : []);
  return {
    deletion_request_ids: Array.isArray(d.deletion_request_ids) ? d.deletion_request_ids : [],
    mention_ids: asStrings(d.mention_ids),
    permanently_deleted_deletion_request_ids: Array.isArray(d.permanently_deleted_deletion_request_ids)
      ? d.permanently_deleted_deletion_request_ids
      : [],
    permanently_deleted_mention_ids: asStrings(d.permanently_deleted_mention_ids),
    task_notification_ids: asStrings(d.task_notification_ids),
    permanently_deleted_task_notification_ids: asStrings(d.permanently_deleted_task_notification_ids),
    workspace_invitation_ids: asStrings(d.workspace_invitation_ids),
    permanently_deleted_workspace_invitation_ids: asStrings(d.permanently_deleted_workspace_invitation_ids),
  };
}

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
    workspace_invitation_ids: [],
    permanently_deleted_workspace_invitation_ids: [],
  });
  const [loading, setLoading] = useState(false);
  const [clearingAllPending, setClearingAllPending] = useState(false);
  const [filter, setFilter] = useState('pending');
  const navigate = useNavigate();
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const fetchEpochRef = useRef(0);

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
    const epoch = ++fetchEpochRef.current;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setNotifications([]);
        setMentionNotifications([]);
        setTaskNotifications([]);
        setWorkspaceInvitations([]);
        setDismissedIds({ ...EMPTY_DISMISSED });
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/deletion-requests/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (epoch !== fetchEpochRef.current) return;
      if (!response.ok) {
        setNotifications([]);
      } else {
        const data = await response.json();
        setNotifications(data.requests || []);
      }

      const invitationsResponse = await fetch(`${API_URL}/api/v1/workspaces/invitations/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (epoch !== fetchEpochRef.current) return;
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
      if (epoch !== fetchEpochRef.current) return;
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
      if (epoch !== fetchEpochRef.current) return;
      if (!tasksAuditResponse.ok) {
        setTaskNotifications([]);
      } else {
        const tasksData = await tasksAuditResponse.json();
        const tlogs = Array.isArray(tasksData?.logs) ? tasksData.logs : [];
        const taskRowsRaw = tlogs
          .map((log) => {
            const metadata = parseMetadata(log);
            const notifiedUserId = Number(metadata?.notified_user_id);
            if (!Number.isFinite(notifiedUserId) || (currentUserId != null && notifiedUserId !== currentUserId)) return null;
            const act = String(log.action || '');
            let kind = 'updated';
            if (act.includes('assigned')) kind = 'assigned';
            else if (act.includes('deleted')) kind = 'deleted';
            else if (act.includes('reminders_generated')) kind = 'reminders';
            const reminderCountRaw = metadata?.reminder_count;
            const reminder_count =
              reminderCountRaw != null && Number.isFinite(Number(reminderCountRaw))
                ? Number(reminderCountRaw)
                : null;
            let reminder_lines = [];
            const rawLines = metadata?.reminder_lines;
            if (Array.isArray(rawLines)) {
              reminder_lines = rawLines
                .filter((x) => x && (x.content != null || x.hint_type != null))
                .map((x) => ({
                  id: x.id != null ? Number(x.id) : null,
                  hint_type: String(x.hint_type || ''),
                  content: String(x.content || ''),
                }))
                .filter((x) => Number.isFinite(x.id));
            }
            const wsId = Number(metadata?.workspace_id ?? log.workspace_id);
            const taskIdNum =
              metadata?.task_id != null ? Number(metadata.task_id) : log.object_id != null ? Number(log.object_id) : NaN;
            const useStableReminderDismissId =
              kind === 'reminders' && Number.isFinite(wsId) && Number.isFinite(taskIdNum);
            return {
              id: useStableReminderDismissId ? `task-reminders-${wsId}-${taskIdNum}` : `task-${log.id}`,
              log_id: log.id,
              created_at: log.created_at,
              workspace_id: Number(metadata?.workspace_id ?? log.workspace_id),
              task_id: metadata?.task_id != null ? Number(metadata.task_id) : (log.object_id != null ? Number(log.object_id) : null),
              task_title: metadata?.task_title || '',
              kind,
              reminder_count,
              reminder_lines,
            };
          })
          .filter(Boolean);
        /* Audit logs are newest-first; keep one reminders_generated row per issue so dismiss matches the visible card. */
        const seenReminderKeys = new Set();
        const taskRows = taskRowsRaw.filter((row) => {
          if (row.kind !== 'reminders') return true;
          const ws = row.workspace_id;
          const tid = row.task_id;
          if (!Number.isFinite(ws) || !Number.isFinite(tid)) return true;
          const key = `${ws}:${tid}`;
          if (seenReminderKeys.has(key)) return false;
          seenReminderKeys.add(key);
          return true;
        });
        setTaskNotifications(taskRows);
      }

      const prefsResponse = await fetch(`${API_URL}/api/v1/users/preferences`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (epoch !== fetchEpochRef.current) return;
      if (prefsResponse.ok) {
        const prefs = await prefsResponse.json();
        if (epoch !== fetchEpochRef.current) return;
        setDismissedIds(normalizeDismissedFromApi(prefs?.dismissed_notification_ids));
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      /* Do not clear all lists: a single failing request would wipe unrelated items. */
    } finally {
      if (epoch === fetchEpochRef.current) setLoading(false);
    }
  }, [API_URL, currentUserId]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

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
      cache: 'no-store',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const applyDismissResponse = async (response) => {
    if (!response.ok) return false;
    try {
      const data = await response.json();
      if (data?.dismissed_notification_ids && typeof data.dismissed_notification_ids === 'object') {
        setDismissedIds(normalizeDismissedFromApi(data.dismissed_notification_ids));
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  };

  const handleDismissDeletionRequest = async (requestId) => {
    try {
      const response = await callDismissEndpoint({ deletion_request_ids: [requestId] });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({ ...prev, deletion_request_ids: [...(prev.deletion_request_ids || []), requestId] }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error dismissing notification:', error); }
  };

  const handleDismissMention = async (mentionId) => {
    try {
      const response = await callDismissEndpoint({ mention_ids: [String(mentionId)] });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({ ...prev, mention_ids: [...(prev.mention_ids || []), String(mentionId)] }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error dismissing mention:', error); }
  };

  const handlePermanentlyDeleteDeletionRequest = async (requestId) => {
    try {
      const response = await callDismissEndpoint({ permanently_deleted_deletion_request_ids: [requestId] });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({
            ...prev,
            permanently_deleted_deletion_request_ids: [...(prev.permanently_deleted_deletion_request_ids || []), requestId],
          }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error permanently deleting notification:', error); }
  };

  const handlePermanentlyDeleteMention = async (mentionId) => {
    try {
      const response = await callDismissEndpoint({ permanently_deleted_mention_ids: [String(mentionId)] });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({
            ...prev,
            permanently_deleted_mention_ids: [...(prev.permanently_deleted_mention_ids || []), String(mentionId)],
          }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error permanently deleting mention:', error); }
  };

  const handleDismissTaskNotification = async (taskNotifId) => {
    try {
      const response = await callDismissEndpoint({ task_notification_ids: [String(taskNotifId)] });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({
            ...prev,
            task_notification_ids: Array.from(
              new Set([...(prev.task_notification_ids || []).map(String), String(taskNotifId)])
            ),
          }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error dismissing task notification:', error); }
  };

  const handlePermanentlyDeleteTaskNotification = async (taskNotifId) => {
    try {
      const response = await callDismissEndpoint({
        permanently_deleted_task_notification_ids: [String(taskNotifId)],
      });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({
            ...prev,
            permanently_deleted_task_notification_ids: Array.from(
              new Set([...(prev.permanently_deleted_task_notification_ids || []).map(String), String(taskNotifId)])
            ),
          }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error permanently deleting task notification:', error); }
  };

  const workspaceInviteKey = (invitationId) => `invite-${invitationId}`;

  const handleDismissWorkspaceInvitation = async (invitationId) => {
    const key = workspaceInviteKey(invitationId);
    try {
      const response = await callDismissEndpoint({ workspace_invitation_ids: [key] });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({ ...prev, workspace_invitation_ids: [...(prev.workspace_invitation_ids || []), key] }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error dismissing workspace invitation:', error); }
  };

  const handlePermanentlyDeleteWorkspaceInvitation = async (invitationId) => {
    const key = workspaceInviteKey(invitationId);
    try {
      const response = await callDismissEndpoint({ permanently_deleted_workspace_invitation_ids: [key] });
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({
            ...prev,
            permanently_deleted_workspace_invitation_ids: [
              ...(prev.permanently_deleted_workspace_invitation_ids || []),
              key,
            ],
          }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) { console.error('Error permanently deleting workspace invitation:', error); }
  };

  const handleOpenMentionDiscussion = (mention) => {
    const wsId = mention?.workspace_id;
    if (!wsId) return;
    const params = new URLSearchParams({ tab: 'discussion' });
    if (mention?.message_id != null) {
      params.set('messageId', String(mention.message_id));
    }
    navigate(`/workspace/${wsId}?${params.toString()}`);
  };

  const handleOpenWorkspaceIssues = (row, opts = {}) => {
    const wsId = row?.workspace_id;
    if (!wsId) return;
    const params = new URLSearchParams();
    if (row?.task_id != null) {
      params.set('issueId', String(row.task_id));
    }
    const q = params.toString();
    const path = q ? `/workspace/${wsId}/issues?${q}` : `/workspace/${wsId}/issues`;
    const hash = opts.focusReminders ? '#issue-reminders' : '';
    navigate(path + hash);
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

  const taskDismissSet = useMemo(
    () => new Set((dismissedIds.task_notification_ids || []).map(String)),
    [dismissedIds.task_notification_ids]
  );
  const permTaskSet = useMemo(
    () => new Set((dismissedIds.permanently_deleted_task_notification_ids || []).map(String)),
    [dismissedIds.permanently_deleted_task_notification_ids]
  );
  const inviteDismissSet = useMemo(
    () => new Set((dismissedIds.workspace_invitation_ids || []).map(String)),
    [dismissedIds.workspace_invitation_ids]
  );
  const permInviteSet = useMemo(
    () => new Set((dismissedIds.permanently_deleted_workspace_invitation_ids || []).map(String)),
    [dismissedIds.permanently_deleted_workspace_invitation_ids]
  );
  const mentionDismissSet = useMemo(
    () => new Set((dismissedIds.mention_ids || []).map(String)),
    [dismissedIds.mention_ids]
  );
  const permMentionSet = useMemo(
    () => new Set((dismissedIds.permanently_deleted_mention_ids || []).map(String)),
    [dismissedIds.permanently_deleted_mention_ids]
  );

  const drDismissed = dismissedIds.deletion_request_ids || [];
  const permDrDeleted = dismissedIds.permanently_deleted_deletion_request_ids || [];

  const activeWorkspaceInvitations = workspaceInvitations.filter((inv) => {
    const key = workspaceInviteKey(inv.invitation_id);
    return !inviteDismissSet.has(key) && !permInviteSet.has(key);
  });

  const historyWorkspaceInvitations = workspaceInvitations.filter((inv) => {
    const key = workspaceInviteKey(inv.invitation_id);
    return inviteDismissSet.has(key) && !permInviteSet.has(key);
  });

  const pendingDeletionNotifications = notifications.filter(
    (n) => n.status === 'pending' && !drDismissed.includes(n.id) && !permDrDeleted.includes(n.id)
  );

  // Non pending, not permanently deleted
  const respondedNotDismissed = notifications.filter(
    (n) => n.status !== 'pending' && !drDismissed.includes(n.id) && !permDrDeleted.includes(n.id)
  );
  const mentionsNotDismissed = mentionNotifications.filter(
    (m) => !mentionDismissSet.has(String(m.id)) && !permMentionSet.has(String(m.id))
  );
  const dismissedRequests = notifications.filter(
    (n) => drDismissed.includes(n.id) && !permDrDeleted.includes(n.id)
  );
  const dismissedMentions = mentionNotifications.filter(
    (m) => mentionDismissSet.has(String(m.id)) && !permMentionSet.has(String(m.id))
  );
  const tasksNotDismissed = taskNotifications.filter(
    (t) => !taskDismissSet.has(String(t.id)) && !permTaskSet.has(String(t.id))
  );
  const dismissedTasks = taskNotifications.filter(
    (t) => taskDismissSet.has(String(t.id)) && !permTaskSet.has(String(t.id))
  );

  const pendingCount =
    pendingDeletionNotifications.length +
    activeWorkspaceInvitations.length +
    tasksNotDismissed.length;

  const handleClearAllPending = async () => {
    if (pendingCount === 0) return;
    const drIds = pendingDeletionNotifications
      .map((n) => Number(n.id))
      .filter((id) => Number.isFinite(id));
    const inviteKeys = activeWorkspaceInvitations.map((inv) => workspaceInviteKey(inv.invitation_id));
    const taskIds = tasksNotDismissed.map((t) => t.id).filter((id) => typeof id === 'string' && id.length > 0);
    const payload = {};
    if (drIds.length) payload.deletion_request_ids = drIds;
    if (inviteKeys.length) payload.workspace_invitation_ids = inviteKeys;
    if (taskIds.length) payload.task_notification_ids = taskIds;
    if (Object.keys(payload).length === 0) return;

    setClearingAllPending(true);
    try {
      const response = await callDismissEndpoint(payload);
      if (response.ok) {
        const applied = await applyDismissResponse(response);
        if (!applied) {
          setDismissedIds((prev) => ({
            ...prev,
            deletion_request_ids: Array.from(new Set([...(prev.deletion_request_ids || []), ...drIds])),
            workspace_invitation_ids: Array.from(new Set([...(prev.workspace_invitation_ids || []).map(String), ...inviteKeys])),
            task_notification_ids: Array.from(
              new Set([...(prev.task_notification_ids || []).map(String), ...taskIds.map(String)])
            ),
          }));
        }
        window.dispatchEvent(new Event('notifications-updated'));
      }
    } catch (error) {
      console.error('Error clearing pending notifications:', error);
    } finally {
      setClearingAllPending(false);
    }
  };

  const historyCount =
    dismissedRequests.length + dismissedMentions.length + dismissedTasks.length + historyWorkspaceInvitations.length;

  const allCount =
    pendingCount +
    respondedNotDismissed.length +
    mentionsNotDismissed.length +
    historyCount;

  const historyRows = useMemo(() => {
    const rows = [];
    dismissedRequests.forEach((n) => {
      rows.push({
        kind: 'dr',
        key: `history-dr-${n.id}`,
        sortAt: n.responded_at || n.created_at,
        data: n,
      });
    });
    dismissedMentions.forEach((m) => {
      rows.push({ kind: 'mention', key: m.id, sortAt: m.created_at, data: m });
    });
    dismissedTasks.forEach((t) => {
      rows.push({ kind: 'task', key: t.id, sortAt: t.created_at, data: t });
    });
    historyWorkspaceInvitations.forEach((inv) => {
      rows.push({
        kind: 'invite',
        key: `history-inv-${inv.invitation_id}`,
        sortAt: inv.invited_at,
        data: inv,
      });
    });
    rows.sort((a, b) => new Date(b.sortAt || 0).getTime() - new Date(a.sortAt || 0).getTime());
    return rows;
  }, [dismissedRequests, dismissedMentions, dismissedTasks, historyWorkspaceInvitations]);

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

  const formatReminderTypeLabel = (t) =>
    String(t || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

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
      row.kind === 'assigned'
        ? 'Task assigned to you'
        : row.kind === 'deleted'
          ? 'Task deleted'
          : row.kind === 'reminders'
            ? 'Issue reminders updated'
            : 'Task updated';
    const badgeClass =
      row.kind === 'assigned'
        ? 'pending'
        : row.kind === 'deleted'
          ? 'denied'
          : row.kind === 'reminders'
            ? 'reminders'
            : 'mention';
    const badgeLabel =
      row.kind === 'assigned'
        ? 'assigned'
        : row.kind === 'deleted'
          ? 'deleted'
          : row.kind === 'reminders'
            ? 'Reminders'
            : 'update';
    const cardMods = [
      'notification-card',
      faded ? 'notification-card--faded' : '',
      row.kind === 'reminders' ? 'notification-card--reminders' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div key={row.id} className={cardMods}>
        <div className="notification-content">
          <div className="notification-header">
            <div className="status-with-icon">
              {row.kind === 'deleted' ? (
                <Trash2 size={18} className="status-icon denied" aria-hidden />
              ) : row.kind === 'reminders' ? (
                <Bell size={18} className="status-icon reminders" strokeWidth={1.75} aria-hidden />
              ) : (
                <ListTodo size={18} className="status-icon pending" aria-hidden />
              )}
              <h3 className={row.kind === 'reminders' ? 'notification-title--ui' : undefined}>{title}</h3>
            </div>
            {!faded && <span className={`status-badge ${badgeClass}`}>{badgeLabel}</span>}
          </div>
          {row.kind === 'reminders' ? (
            <>
              <p className="notification-reason notification-reason--reminders">
                Suggestions for{' '}
                <span className="notification-issue-title">{row.task_title || `Issue #${row.task_id ?? ''}`}</span>
                {row.reminder_count != null && row.reminder_count > 0 && (
                  <span className="notification-reminder-meta"> · {row.reminder_count} active</span>
                )}
                {row.reminder_count === 0 && (
                  <span className="notification-reminder-meta"> · none active</span>
                )}
              </p>
              {Array.isArray(row.reminder_lines) && row.reminder_lines.length > 0 && (
                <ul className="notification-reminder-lines" aria-label="Reminder suggestions">
                  {row.reminder_lines.map((line) => (
                    <li key={line.id}>
                      <button
                        type="button"
                        className="notification-reminder-line"
                        onClick={() => handleOpenWorkspaceIssues(row, { focusReminders: true })}
                      >
                        <span className="notification-reminder-line-type">{formatReminderTypeLabel(line.hint_type)}</span>
                        <span className="notification-reminder-line-text">{line.content}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
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
          )}
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

  const renderWorkspaceInvitationCard = (invitation, { faded, actions }) => (
    <div key={`workspace-invite-${invitation.invitation_id}`} className={`notification-card${faded ? ' notification-card--faded' : ''}`}>
      <div className="notification-content">
        <div className="notification-header">
          <div className="status-with-icon">
            <Users size={18} className="status-icon pending" />
            <h3>Workspace invitation</h3>
          </div>
          {!faded && <span className="status-badge pending">pending</span>}
        </div>
        <p className="notification-reason">
          Invited to join <strong>{invitation.workspace_name}</strong> as <strong>{invitation.role}</strong>.
        </p>
        <p className="notification-date">{formatDate(invitation.invited_at, 'Invited')}</p>
      </div>
      <div className="notification-actions">{actions}</div>
    </div>
  );

  return (
    <div className="notifications-page">
      <div className="notifications-hero">
        <h1>Notifications</h1>
        <p>Invites, mentions, tasks, and document requests — dismiss anything to move it into history, or remove it for good.</p>
      </div>

      <div className="notifications-filter-row">
        <div className="filter-tabs">
          <button type="button" className={`filter-tab ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>
            Pending ({pendingCount})
          </button>
          <button type="button" className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All ({allCount})
          </button>
        </div>
        {filter === 'pending' && pendingCount > 0 && (
          <button
            type="button"
            className="notifications-clear-all"
            onClick={handleClearAllPending}
            disabled={loading || clearingAllPending}
            aria-label="Dismiss all pending notifications from this view"
          >
            {clearingAllPending ? 'Clearing…' : 'Clear all'}
          </button>
        )}
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

        {/* Pending deletion requests — Pending + All */}
        {!loading && (filter === 'pending' || filter === 'all') && pendingDeletionNotifications.length > 0 && (
          <>
            <div className="section-title">Awaiting your decision</div>
            {pendingDeletionNotifications.map((n) =>
              renderDeletionRequestCard(n, {
                faded: false,
                actions: (
                  <>
                    <button type="button" className="icon-action icon-action-accept" onClick={() => handleApprove(n.id)} title="Approve" aria-label="Approve deletion request"><Check size={18} strokeWidth={2.5} /></button>
                    <button type="button" className="icon-action icon-action-decline" onClick={() => handleDeny(n.id)} title="Deny" aria-label="Deny deletion request"><X size={18} strokeWidth={2.5} /></button>
                    <button type="button" className="btn btn-dismiss" onClick={() => handleDismissDeletionRequest(n.id)} title="Hide for now" aria-label="Dismiss deletion request"><Trash2 size={15} /> Dismiss</button>
                  </>
                ),
              })
            )}
          </>
        )}

        {/* Workspace invitations — Pending + All */}
        {!loading && (filter === 'pending' || filter === 'all') && activeWorkspaceInvitations.length > 0 && (
          <>
            <div className="section-title">Workspace invitations</div>
            {activeWorkspaceInvitations.map((invitation) =>
              renderWorkspaceInvitationCard(invitation, {
                faded: false,
                actions: (
                  <>
                    <button type="button" className="icon-action icon-action-accept" onClick={() => handleAcceptWorkspaceInvite(invitation.invitation_id)} title="Accept" aria-label="Accept workspace invitation"><Check size={18} strokeWidth={2.5} /></button>
                    <button type="button" className="icon-action icon-action-decline" onClick={() => handleDeclineWorkspaceInvite(invitation.invitation_id)} title="Decline" aria-label="Decline workspace invitation"><X size={18} strokeWidth={2.5} /></button>
                    <button type="button" className="btn btn-dismiss" onClick={() => handleDismissWorkspaceInvitation(invitation.invitation_id)} title="Hide for now" aria-label="Dismiss invitation"><Trash2 size={15} /> Dismiss</button>
                  </>
                ),
              })
            )}
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

        {!loading && (filter === 'pending' || filter === 'all') && tasksNotDismissed.length > 0 && (
          <>
            <div className="section-title">Tasks</div>
            {tasksNotDismissed.map((t) =>
              renderTaskNotificationCard(t, {
                faded: false,
                actions: (
                  <>
                    <button
                      type="button"
                      className="btn btn-mention-open"
                      onClick={() =>
                        handleOpenWorkspaceIssues(t, { focusReminders: t.kind === 'reminders' })
                      }
                    >
                      {t.kind === 'reminders' ? 'Open issue' : 'Open issues'}
                    </button>
                    <button type="button" className="btn btn-dismiss" onClick={() => handleDismissTaskNotification(t.id)} title="Dismiss" aria-label="Dismiss task notification"><Trash2 size={15} /> Dismiss</button>
                  </>
                ),
              })
            )}
          </>
        )}

        {/* All tab: chronological history (dismissed / hidden items) */}
        {!loading && filter === 'all' && historyRows.length > 0 && (
          <>
            <div className="section-title">History</div>
            <p className="section-subtitle notifications-history-hint">Newest first. Delete removes an item from this list permanently.</p>
            {historyRows.map((row) => (
              <React.Fragment key={row.key}>
                {row.kind === 'dr' &&
                  renderDeletionRequestCard(row.data, {
                    faded: true,
                    actions: (
                      <button type="button" className="btn btn-permanent-delete" onClick={() => handlePermanentlyDeleteDeletionRequest(row.data.id)} title="Delete permanently" aria-label="Permanently delete notification"><Trash2 size={15} /> Delete</button>
                    ),
                  })}
                {row.kind === 'mention' &&
                  renderMentionCard(row.data, {
                    faded: true,
                    actions: (
                      <button type="button" className="btn btn-permanent-delete" onClick={() => handlePermanentlyDeleteMention(row.data.id)} title="Delete permanently" aria-label="Permanently delete mention"><Trash2 size={15} /> Delete</button>
                    ),
                  })}
                {row.kind === 'task' &&
                  renderTaskNotificationCard(row.data, {
                    faded: true,
                    actions: (
                      <button type="button" className="btn btn-permanent-delete" onClick={() => handlePermanentlyDeleteTaskNotification(row.data.id)} title="Delete permanently" aria-label="Permanently delete task notification"><Trash2 size={15} /> Delete</button>
                    ),
                  })}
                {row.kind === 'invite' &&
                  renderWorkspaceInvitationCard(row.data, {
                    faded: true,
                    actions: (
                      <button type="button" className="btn btn-permanent-delete" onClick={() => handlePermanentlyDeleteWorkspaceInvitation(row.data.invitation_id)} title="Delete permanently" aria-label="Permanently delete invitation from history"><Trash2 size={15} /> Delete</button>
                    ),
                  })}
              </React.Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default NotificationsPage;
