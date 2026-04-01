import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch } from '../utils/apiClient';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Plus,
  Trash2,
  AlertCircle,
  Pencil,
  Search as SearchIcon,
  List,
  ListTodo,
  Columns3,
  ChevronDown,
  ChevronRight,
  Bell,
} from 'lucide-react';
import { getApiErrorMessage } from '../utils/apiError';
import LoadingState from '../components/LoadingState';
import IssueDescriptionMarkdown from '../components/IssueDescriptionMarkdown';
import './WorkspaceIssues.css';

const ISSUE_STATUS_ORDER = ['open', 'in_progress', 'overdue', 'completed', 'closed'];

function WorkspaceIssues({ workspaceId, currentUser }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [issues, setIssues] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [assignmentScope, setAssignmentScope] = useState('assigned');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'todo' | 'kanban'
  const [workspaces, setWorkspaces] = useState([]);
  const [draggingIssueId, setDraggingIssueId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [taskHistory, setTaskHistory] = useState([]);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
  const [taskHistoryOpen, setTaskHistoryOpen] = useState(false);
  const [issueReminders, setIssueReminders] = useState([]);
  const [issueRemindersLoading, setIssueRemindersLoading] = useState(false);
  const [issueRemindersFetchError, setIssueRemindersFetchError] = useState(null);
  const [issueRemindersDegraded, setIssueRemindersDegraded] = useState(null);
  const [issueReminderActionId, setIssueReminderActionId] = useState(null);
  const [issueRemindersBusy, setIssueRemindersBusy] = useState(false);
  /** Bumps when this workspace's documents change so reminder context can refresh. */
  const [reminderDocEpoch, setReminderDocEpoch] = useState(0);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    assigned_to: null,
    assignees: [],
    due_date: '',
  });

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  const storedUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch (err) {
      return null;
    }
  }, []);

  const currentUserId = currentUser?.id || storedUser?.id || null;

  const issueIdFromQuery = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const value = Number(params.get('issueId'));
    return Number.isFinite(value) ? value : null;
  }, [location.search]);

  const focusRemindersFromHash = location.hash === '#issue-reminders';

  const memberLookup = useMemo(() => {
    const map = new Map();
    members.forEach((member) => {
      map.set(member.user_id, member.username || member.email || `User ${member.user_id}`);
    });
    return map;
  }, [members]);

  const getEffectiveStatus = (issue) => {
    const rawStatus = issue?.status || 'open';
    if (rawStatus === 'completed' || rawStatus === 'closed') return rawStatus;
    if (rawStatus === 'overdue') return 'overdue';
    if (!issue?.due_date) return rawStatus;

    const dueDate = new Date(issue.due_date);
    if (Number.isNaN(dueDate.getTime())) return rawStatus;

    const dueUtcDate = Date.UTC(
      dueDate.getUTCFullYear(),
      dueDate.getUTCMonth(),
      dueDate.getUTCDate()
    );
    const now = new Date();
    const todayUtcDate = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );

    if (dueUtcDate < todayUtcDate && rawStatus !== 'completed' && rawStatus !== 'closed') {
      return 'overdue';
    }

    return rawStatus;
  };

  const normalizedIssues = useMemo(() => issues.map((issue) => {
    const status = issue.status || 'open';
    return {
      ...issue,
      status,
      effectiveStatus: getEffectiveStatus({ ...issue, status }),
    };
  }), [issues]);

  const statusCounts = useMemo(() => {
    return normalizedIssues.reduce((acc, issue) => {
      const key = issue.effectiveStatus || issue.status;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [normalizedIssues]);

  const filteredIssues = useMemo(() => {
    let result = normalizedIssues;
    if (statusFilter !== 'all') {
      result = result.filter((issue) => (issue.effectiveStatus || issue.status) === statusFilter);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((issue) =>
        issue.title?.toLowerCase().includes(query)
        || issue.description?.toLowerCase().includes(query)
      );
    }
    return result;
  }, [normalizedIssues, statusFilter, searchQuery]);

  const isAssignedToMe = (issue) => {
    if (!currentUserId) return false;
    const assignees = Array.isArray(issue.assignees) && issue.assignees.length
      ? issue.assignees
      : (issue.assigned_to ? [issue.assigned_to] : []);
    return assignees.includes(currentUserId);
  };

  const todoSortedIssues = useMemo(() => {
    const assigned = filteredIssues.filter(isAssignedToMe);
    const completedStatuses = ['completed', 'closed'];
    const incomplete = assigned.filter(
      (issue) => !completedStatuses.includes(issue.effectiveStatus || issue.status)
    );
    const completed = assigned.filter(
      (issue) => completedStatuses.includes(issue.effectiveStatus || issue.status)
    );
    return [...incomplete, ...completed];
  }, [filteredIssues, currentUserId]);

  const kanbanColumns = useMemo(() => {
    return ISSUE_STATUS_ORDER.map((status) => ({
      status,
      label: status.replace('_', ' '),
      issues: filteredIssues.filter(
        (issue) => (issue.effectiveStatus || issue.status) === status
      ),
    }));
  }, [filteredIssues]);

  const resolvedWorkspaceId = useMemo(() => {
    const fromProp = Number(workspaceId);
    if (!Number.isNaN(fromProp) && Number.isFinite(fromProp)) return fromProp;
    const fromRoute = Number(id);
    if (!Number.isNaN(fromRoute) && Number.isFinite(fromRoute)) return fromRoute;
    return null;
  }, [workspaceId, id]);

  /**
   * Reminder extraction uses title, description, and due date (not arbitrary updated_at bumps).
   * `reminderDocEpoch` increments when workspace documents change (WebSocket).
   */
  const reminderRegenerationKey = useMemo(() => {
    if (!resolvedWorkspaceId || !selectedIssueId) return null;
    const issue = issues.find((i) => i.id === selectedIssueId);
    if (!issue) return null;
    const title = issue.title || '';
    const desc = issue.description || '';
    const due = issue.due_date != null ? String(issue.due_date) : '';
    return `${issue.id}|${title}|${desc}|${due}|doc${reminderDocEpoch}`;
  }, [resolvedWorkspaceId, selectedIssueId, issues, reminderDocEpoch]);

  useEffect(() => {
    setReminderDocEpoch(0);
  }, [resolvedWorkspaceId]);

  useEffect(() => {
    const onDocs = (e) => {
      const raw = e?.detail?.workspace_id;
      const wid = raw == null ? null : Number(raw);
      if (Number.isFinite(wid) && wid === Number(resolvedWorkspaceId)) {
        setReminderDocEpoch((n) => n + 1);
      }
    };
    window.addEventListener('documents-updated', onDocs);
    return () => window.removeEventListener('documents-updated', onDocs);
  }, [resolvedWorkspaceId]);

  useEffect(() => {
    if (!resolvedWorkspaceId) {
      setError('Invalid workspace id');
      setLoading(false);
      return;
    }
    fetchIssues();
    fetchMembers();
    fetchWorkspaces();
  }, [resolvedWorkspaceId, API_URL, token, assignmentScope, currentUserId]);

  useEffect(() => {
    if (!resolvedWorkspaceId) return;

    const handleWorkspaceUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      if (Number.isFinite(changedWorkspaceId) && changedWorkspaceId !== Number(resolvedWorkspaceId)) {
        return;
      }
      fetchIssues();
      fetchMembers();
      fetchWorkspaces();
    };

    window.addEventListener('workspaces-updated', handleWorkspaceUpdated);
    window.addEventListener('documents-updated', handleWorkspaceUpdated);
    window.addEventListener('containers-updated', handleWorkspaceUpdated);

    return () => {
      window.removeEventListener('workspaces-updated', handleWorkspaceUpdated);
      window.removeEventListener('documents-updated', handleWorkspaceUpdated);
      window.removeEventListener('containers-updated', handleWorkspaceUpdated);
    };
  }, [resolvedWorkspaceId, assignmentScope, currentUserId]);

  useEffect(() => {
    if (!normalizedIssues.length) {
      setSelectedIssueId(null);
      return;
    }

    const targetList = filteredIssues.length ? filteredIssues : normalizedIssues;

    if (selectedIssueId && targetList.some((issue) => issue.id === selectedIssueId)) {
      return;
    }

    if (issueIdFromQuery && targetList.some((issue) => issue.id === issueIdFromQuery)) {
      setSelectedIssueId(issueIdFromQuery);
      return;
    }

    setSelectedIssueId(targetList[0].id);
  }, [normalizedIssues, filteredIssues, issueIdFromQuery, selectedIssueId]);

  useEffect(() => {
    if (!selectedIssueId) return;
    const params = new URLSearchParams(location.search);
    const current = Number(params.get('issueId'));
    if (current === selectedIssueId) return;
    params.set('issueId', String(selectedIssueId));
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [selectedIssueId, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!currentUserId) return;
    setFormData((prev) => ({
      ...prev,
      assigned_to: prev.assigned_to ?? currentUserId,
      assignees: prev.assignees?.length ? prev.assignees : (currentUserId ? [currentUserId] : []),
    }));
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId && assignmentScope === 'assigned') {
      setAssignmentScope('all');
    }
  }, [currentUserId, assignmentScope]);

  useEffect(() => {
    if (viewMode === 'todo' && assignmentScope !== 'assigned') {
      setViewMode('list');
    }
  }, [assignmentScope, viewMode]);

  const fetchTaskHistory = useCallback(async (issueId) => {
    if (!resolvedWorkspaceId || !issueId) {
      setTaskHistory([]);
      return;
    }
    setTaskHistoryLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/v1/tasks/${resolvedWorkspaceId}/${issueId}/history`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        setTaskHistory([]);
        return;
      }
      const data = await response.json();
      setTaskHistory(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      console.error(err);
      setTaskHistory([]);
    } finally {
      setTaskHistoryLoading(false);
    }
  }, [resolvedWorkspaceId, API_URL, token]);

  useEffect(() => {
    setTaskHistoryOpen(false);
    if (!selectedIssueId) {
      setTaskHistory([]);
      return;
    }
    fetchTaskHistory(selectedIssueId);
  }, [selectedIssueId, fetchTaskHistory]);

  const loadTaskReminders = useCallback(async () => {
    if (!resolvedWorkspaceId || !selectedIssueId) {
      setIssueReminders([]);
      setIssueRemindersDegraded(null);
      setIssueRemindersFetchError(null);
      return;
    }
    setIssueRemindersLoading(true);
    setIssueRemindersFetchError(null);
    try {
      const data = await apiFetch(
        `/api/v1/tasks/${resolvedWorkspaceId}/${selectedIssueId}/reminders`
      );
      setIssueReminders(Array.isArray(data.reminders) ? data.reminders : []);
      setIssueRemindersDegraded(data.reminder_generation_error || null);
    } catch (err) {
      setIssueRemindersFetchError(err.message || 'Could not load reminders');
      setIssueReminders([]);
      setIssueRemindersDegraded(null);
    } finally {
      setIssueRemindersLoading(false);
    }
  }, [resolvedWorkspaceId, selectedIssueId]);

  const runRegenerateReminders = useCallback(async () => {
    if (!resolvedWorkspaceId || !selectedIssueId) return;
    setIssueRemindersBusy(true);
    setIssueRemindersFetchError(null);
    try {
      const data = await apiFetch(
        `/api/v1/tasks/${resolvedWorkspaceId}/${selectedIssueId}/reminders/generate`,
        { method: 'POST' },
      );
      if (data.reminder_generation_error) {
        setIssueRemindersDegraded(data.reminder_generation_error);
      } else {
        setIssueRemindersDegraded(null);
      }
      const list = await apiFetch(
        `/api/v1/tasks/${resolvedWorkspaceId}/${selectedIssueId}/reminders`,
      );
      setIssueReminders(Array.isArray(list.reminders) ? list.reminders : []);
      if (list.reminder_generation_error) {
        setIssueRemindersDegraded(list.reminder_generation_error);
      }
      if (!data.reminder_generation_error) {
        fetchTaskHistory(selectedIssueId);
      }
    } catch (err) {
      setIssueRemindersFetchError(err.message || 'Could not update reminders');
    } finally {
      setIssueRemindersBusy(false);
    }
  }, [resolvedWorkspaceId, selectedIssueId, fetchTaskHistory]);

  useEffect(() => {
    if (!reminderRegenerationKey) return undefined;
    const timer = setTimeout(() => {
      runRegenerateReminders();
    }, 450);
    return () => clearTimeout(timer);
  }, [reminderRegenerationKey, runRegenerateReminders]);

  useEffect(() => {
    if (!focusRemindersFromHash || !selectedIssueId) return undefined;
    const t = window.setTimeout(() => {
      document.getElementById('issue-reminders')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 200);
    return () => clearTimeout(t);
  }, [focusRemindersFromHash, selectedIssueId, issueRemindersLoading]);

  const formatReminderType = (t) =>
    String(t || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const handleIssueReminderAcknowledge = async (reminderId) => {
    if (!resolvedWorkspaceId || !selectedIssueId) return;
    setIssueReminderActionId(reminderId);
    try {
      await apiFetch(
        `/api/v1/tasks/${resolvedWorkspaceId}/${selectedIssueId}/reminders/${reminderId}/acknowledge`,
        { method: 'POST' },
      );
      await loadTaskReminders();
      fetchTaskHistory(selectedIssueId);
    } catch (err) {
      setIssueRemindersFetchError(err.message || 'Could not update reminder');
    } finally {
      setIssueReminderActionId(null);
    }
  };

  const handleIssueReminderDismiss = async (reminderId) => {
    if (!resolvedWorkspaceId || !selectedIssueId) return;
    setIssueReminderActionId(reminderId);
    try {
      await apiFetch(
        `/api/v1/tasks/${resolvedWorkspaceId}/${selectedIssueId}/reminders/${reminderId}/dismiss`,
        { method: 'POST' },
      );
      await loadTaskReminders();
      fetchTaskHistory(selectedIssueId);
    } catch (err) {
      setIssueRemindersFetchError(err.message || 'Could not update reminder');
    } finally {
      setIssueReminderActionId(null);
    }
  };

  const fetchIssues = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams({ task_type: 'issue', limit: '500' });
      if (assignmentScope === 'assigned' && currentUserId) {
        query.set('assigned_to', 'me');
      }
      const response = await fetch(
        `${API_URL}/api/v1/tasks/${resolvedWorkspaceId}?${query.toString()}`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to load issues');
        setError(message);
        return;
      }
      const data = await response.json();
      setIssues(data.items || []);
    } catch (err) {
      setError('Failed to load issues');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}/members`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to load members');
        setError(message);
        return;
      }
      const data = await response.json();
      setMembers(data.items || []);
    } catch (err) {
      console.error('Failed to load members', err);
    }
  };

  const fetchWorkspaces = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to load workspaces');
        setError(message);
        return;
      }
      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setWorkspaces(items);
    } catch (err) {
      console.error('Failed to load workspaces', err);
    }
  };

  const handleCreateIssue = async () => {
    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!formData.description.trim()) {
      setError(
        'Description is required. Reminder suggestions use this text (and related documents), so include goals, dates, and next steps.',
      );
      return;
    }

    try {
      const payload = {
        title: formData.title,
        description: formData.description,
        type: 'issue',
        status: 'open',
        priority: formData.priority,
        assigned_to: formData.assignees?.[0] || formData.assigned_to || null,
        assignees: formData.assignees,
        due_date: formData.due_date ? `${formData.due_date}T00:00:00Z` : null,
      };
      const response = await fetch(`${API_URL}/api/v1/tasks/${resolvedWorkspaceId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to create issue');
        setError(message);
        return;
      }
      const newIssue = await response.json();
      setIssues((prev) => [newIssue, ...prev]);
      setSelectedIssueId(newIssue.id);
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        assigned_to: currentUserId || null,
        assignees: currentUserId ? [currentUserId] : [],
        due_date: '',
      });
      setShowCreateModal(false);
      setError(null);
    } catch (err) {
      setError('Failed to create issue');
      console.error(err);
    }
  };

  const handleEditIssue = (issue) => {
    setError(null);
    const assignees = Array.isArray(issue.assignees) && issue.assignees.length
      ? issue.assignees
      : (issue.assigned_to ? [issue.assigned_to] : []);
    const dueDate = issue.due_date ? new Date(issue.due_date) : null;
    const dueDateValue = dueDate
      ? dueDate.toISOString().slice(0, 10)
      : '';
    setEditingIssue(issue);
    setFormData({
      title: issue.title || '',
      description: issue.description || '',
      priority: issue.priority || 'medium',
      assigned_to: assignees[0] || null,
      assignees,
      due_date: dueDateValue,
    });
    setShowCreateModal(true);
  };

  const handleUpdateIssue = async () => {
    if (!editingIssue) return;
    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!formData.description.trim()) {
      setError(
        'Description cannot be empty. Add context so assignees and reminder suggestions stay useful.',
      );
      return;
    }

    try {
      const payload = {
        title: formData.title,
        description: formData.description,
        priority: formData.priority,
        assigned_to: formData.assignees?.[0] || formData.assigned_to || null,
        assignees: formData.assignees,
        due_date: formData.due_date ? `${formData.due_date}T00:00:00Z` : null,
      };
      const response = await fetch(
        `${API_URL}/api/v1/tasks/${resolvedWorkspaceId}/${editingIssue.id}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to update issue');
        setError(message);
        return;
      }
      const updated = await response.json();
      setIssues(issues.map((i) => (i.id === updated.id ? updated : i)));
      setSelectedIssueId(updated.id);
      setShowCreateModal(false);
      setEditingIssue(null);
      setError(null);
      fetchTaskHistory(updated.id);
    } catch (err) {
      setError('Failed to update issue');
      console.error(err);
    }
  };

  const handleUpdateStatus = async (issueId, newStatus) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/tasks/${resolvedWorkspaceId}/${issueId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to update issue');
        setError(message);
        return;
      }
      const updated = await response.json();
      setIssues(issues.map((i) => (i.id === issueId ? updated : i)));
      fetchTaskHistory(issueId);
    } catch (err) {
      setError('Failed to update issue');
      console.error(err);
    }
  };

  const toggleAssignee = (assigneeId) => {
    setFormData((prev) => {
      const next = new Set(prev.assignees || []);
      if (next.has(assigneeId)) {
        next.delete(assigneeId);
      } else {
        next.add(assigneeId);
      }
      return {
        ...prev,
        assignees: Array.from(next),
      };
    });
  };

  const formatDate = (value) => {
    if (!value) return 'No due date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No due date';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const getStatusLabel = (status) =>
    (status || '')
      .split('_')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
      .join(' ');

  const formatAssigneeIdList = (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return 'None';
    return ids.map((uid) => memberLookup.get(uid) || `User ${uid}`).join(', ');
  };

  const formatHistoryChangeLine = (change) => {
    if (!change || !change.field) return '';
    switch (change.field) {
      case 'status':
        return `Status changed from "${getStatusLabel(change.old)}" to "${getStatusLabel(change.new)}"`;
      case 'title':
        return `Title updated`;
      case 'priority':
        return `Priority: ${change.old || '—'} → ${change.new || '—'}`;
      case 'due_date':
        return `Due date updated`;
      case 'assignees':
        return `Assignees: ${formatAssigneeIdList(change.old)} → ${formatAssigneeIdList(change.new)}`;
      case 'description':
        return 'Description updated';
      case 'reminders_regenerated': {
        const n = change.reminder_count;
        const suffix = n != null && Number.isFinite(Number(n)) ? `${n} active suggestion${Number(n) === 1 ? '' : 's'}` : 'suggestions refreshed';
        return `Reminder suggestions refreshed (${suffix})`;
      }
      case 'reminder_acknowledged':
        return `Acknowledged ${formatReminderType(change.hint_type)}: ${change.preview || '—'}`;
      case 'reminder_dismissed':
        return `Dismissed ${formatReminderType(change.hint_type)}: ${change.preview || '—'}`;
      default:
        return `${change.field} changed`;
    }
  };
  const getStatusClass = (status) => `status-${status}`;

  const handleDeleteIssue = async (issueId) => {
    if (!window.confirm('Delete this issue?')) return;

    try {
      const response = await fetch(`${API_URL}/api/v1/tasks/${resolvedWorkspaceId}/${issueId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to delete issue');
        setError(message);
        return;
      }
      setIssues((prev) => {
        const nextIssues = prev.filter((i) => i.id !== issueId);
        if (selectedIssueId === issueId) {
          setSelectedIssueId(nextIssues[0]?.id || null);
        }
        return nextIssues;
      });
    } catch (err) {
      setError('Failed to delete issue');
      console.error(err);
    }
  };

  const isPastDue = (issue) => {
    if (!issue?.due_date) return false;
    const s = issue.effectiveStatus || issue.status;
    if (s === 'completed' || s === 'closed') return false;
    const d = new Date(issue.due_date);
    if (Number.isNaN(d.getTime())) return false;
    const dueUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return dueUtc < todayUtc;
  };

  const handleDragStart = (e, issueId) => {
    setDraggingIssueId(issueId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(issueId));
  };

  const handleDragEnd = () => {
    setDraggingIssueId(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e, colStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colStatus);
  };

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverColumn(null);
    }
  };

  const handleDrop = async (e, colStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    const issueId = Number(e.dataTransfer.getData('text/plain'));
    if (!issueId || !colStatus) return;
    const issue = normalizedIssues.find((i) => i.id === issueId);
    if (!issue) return;
    const currentStatus = issue.effectiveStatus || issue.status;
    if (currentStatus === colStatus) return;
    await handleUpdateStatus(issueId, colStatus);
  };

  const getPriorityClass = (priority) => {
    if (!priority) return 'priority-neutral';
    return `priority-${priority}`;
  };

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const selectedIssue = useMemo(
    () => normalizedIssues.find((issue) => issue.id === selectedIssueId) || null,
    [normalizedIssues, selectedIssueId]
  );

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === resolvedWorkspaceId) || null,
    [workspaces, resolvedWorkspaceId]
  );

  if (loading) return <div className="issues-container"><LoadingState message="Loading issues..." size={36} /></div>;

  return (
    <div className="issues-container">
      <div className="issues-breadcrumb-row">
        <nav className="issues-breadcrumb" aria-label="Breadcrumb">
          <button
            type="button"
            className="issues-breadcrumb-link"
            onClick={() => navigate(`/workspace/${resolvedWorkspaceId}`)}
          >
            &larr; {currentWorkspace?.name || 'Workspace'}
          </button>
          <span className="issues-breadcrumb-sep">/</span>
          <span className="issues-breadcrumb-current">Issues</span>
        </nav>
      </div>

      {/* Page header: title left, New Issue right (reference layout) */}
      <div className="issues-page-header">
        <h1 className="issues-page-title">Issues</h1>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowCreateModal(true);
          }}
          className="btn-create-issue"
          title="Create new issue"
          aria-label="Create new issue"
        >
          <Plus size={16} /> New Issue
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Toolbar: one bar — [Project] | [Assignment pills] | [View toggle group] | [Search] */}
      <div className="issues-toolbar">
        <div className="toolbar-group">
          <select
            value={resolvedWorkspaceId || ''}
            onChange={(e) => navigate(`/workspace/${e.target.value}/issues`)}
            className="toolbar-project-select"
            aria-label="Project"
            title="Project"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-divider" aria-hidden />
        <div className="toolbar-group" role="group" aria-label="Assignment">
          <button
            type="button"
            className={`toolbar-filter-tab ${assignmentScope === 'assigned' ? 'active' : ''}`}
            onClick={() => setAssignmentScope('assigned')}
            title="Show issues assigned to you"
            aria-label="Show issues assigned to you"
          >
            Assigned to me
          </button>
          <button
            type="button"
            className={`toolbar-filter-tab ${assignmentScope === 'all' ? 'active' : ''}`}
            onClick={() => setAssignmentScope('all')}
            title="Show all issues"
            aria-label="Show all issues"
          >
            All issues
          </button>
        </div>
        <div className="toolbar-divider" aria-hidden />
        <div className="toolbar-view-toggle" role="group" aria-label="View">
          <button
            type="button"
            className={`toolbar-view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
            aria-label="List view"
          >
            <List size={12} /> List
          </button>
          <button
            type="button"
            className={`toolbar-view-btn ${viewMode === 'todo' ? 'active' : ''}`}
            onClick={() => setViewMode('todo')}
            disabled={assignmentScope !== 'assigned' || !currentUserId}
            title={assignmentScope !== 'assigned' ? 'Switch to "Assigned to me" for todo list' : 'Todo list view'}
            aria-label="Todo list view"
          >
            <ListTodo size={12} /> Todo
          </button>
          <button
            type="button"
            className={`toolbar-view-btn ${viewMode === 'kanban' ? 'active' : ''}`}
            onClick={() => setViewMode('kanban')}
            title="Kanban board view"
            aria-label="Kanban board view"
          >
            <Columns3 size={12} /> Kanban
          </button>
        </div>
        <div className="toolbar-search-wrap issue-search issue-search-text">
          <SearchIcon size={16} className="issue-search-icon" aria-hidden />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search issues..."
            aria-label="Search issues"
          />
        </div>
      </div>

      {/* Status summary: compact chips, "All · 2" style */}
      <div className="status-summary">
        <button
          type="button"
          className={`status-chip ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
          title="Show all issues"
          aria-label="Show all issues"
        >
          All · {normalizedIssues.length}
        </button>
        {ISSUE_STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            className={`status-chip ${statusFilter === status ? 'active' : ''}`}
            onClick={() => setStatusFilter(status)}
            title={`Show ${getStatusLabel(status)} issues`}
            aria-label={`Show ${getStatusLabel(status)} issues`}
          >
            {getStatusLabel(status)} · {statusCounts[status] || 0}
          </button>
        ))}
      </div>

      {/* Issues Layout */}
      <div className={`issues-layout ${viewMode === 'kanban' ? 'issues-layout-kanban' : ''}`}>
        <div className={`issues-list-panel ${viewMode === 'todo' ? 'todo-list-panel' : ''} ${viewMode === 'kanban' ? 'kanban-panel' : ''}`}>
          {viewMode === 'list' && (
            <>
              {filteredIssues.length === 0 ? (
                <div className="empty-state">
                  <AlertCircle size={32} />
                  <p>No issues {statusFilter !== 'all' ? `in "${statusFilter}" status` : 'yet'}</p>
                </div>
              ) : (
                filteredIssues.map((issue) => {
                  const assignees = Array.isArray(issue.assignees) && issue.assignees.length
                    ? issue.assignees
                    : (issue.assigned_to ? [issue.assigned_to] : []);
                  const assigneeNames = assignees.length
                    ? assignees.map((assigneeId) => memberLookup.get(assigneeId) || `User ${assigneeId}`)
                    : ['Unassigned'];
                  const assigneeLabel = assigneeNames.length > 1
                    ? `${assigneeNames[0]} +${assigneeNames.length - 1}`
                    : assigneeNames[0];
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      className={`issue-row ${selectedIssueId === issue.id ? 'active' : ''}`}
                      onClick={() => setSelectedIssueId(issue.id)}
                      aria-label={`Open issue ${issue.title}`}
                    >
                      <div className="issue-row-main">
                        <div className="issue-row-title">{issue.title}</div>
                        <div className="issue-row-meta">
                          <span className="issue-row-number">#{issue.id}</span>
                          <span className="issue-row-status">
                            <span className={`issue-row-status-dot ${getStatusClass(issue.effectiveStatus || issue.status)}`} />
                            {getStatusLabel(issue.effectiveStatus || issue.status)}
                          </span>
                          <span className="issue-row-assignee">
                            {assigneeLabel}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </>
          )}

          {viewMode === 'todo' && (
            <>
              {todoSortedIssues.length === 0 ? (
                <div className="empty-state">
                  <ListTodo size={32} />
                  <p>No issues assigned to you. Switch to &quot;Assigned to me&quot; or add some tasks.</p>
                </div>
              ) : (
                <ul className="todo-list" aria-label="Your todo list">
                  {todoSortedIssues.map((issue) => {
                    const isCompleted = ['completed', 'closed'].includes(issue.effectiveStatus || issue.status);
                    return (
                      <li key={issue.id} className={`todo-row ${isCompleted ? 'completed' : ''} ${selectedIssueId === issue.id ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          className="todo-checkbox"
                          checked={isCompleted}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleUpdateStatus(issue.id, isCompleted ? 'open' : 'completed');
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={isCompleted ? `Mark "${issue.title}" incomplete` : `Mark "${issue.title}" complete`}
                        />
                        <button
                          type="button"
                          className="todo-row-content"
                          onClick={() => setSelectedIssueId(issue.id)}
                          aria-label={`Open issue ${issue.title}`}
                        >
                          <span className="todo-row-title">{issue.title}</span>
                          <span className="todo-row-meta">#{issue.id} · Due {formatDate(issue.due_date)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {viewMode === 'kanban' && (
            <div className="kanban-board">
              {kanbanColumns.map((col) => (
                <div key={col.status} className="kanban-column">
                  <div className="kanban-column-header">
                    <span className={`kanban-column-dot ${getStatusClass(col.status)}`} aria-hidden />
                    <span className="kanban-column-title">{col.label}</span>
                    <span className="kanban-column-count">({col.issues.length})</span>
                  </div>
                  <div
                    className={`kanban-column-cards${dragOverColumn === col.status && draggingIssueId ? ' drag-over' : ''}`}
                    onDragOver={(e) => handleDragOver(e, col.status)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col.status)}
                  >
                    {col.issues.length === 0 ? (
                      <p className="kanban-column-empty">No issues</p>
                    ) : (
                      col.issues.map((issue) => {
                        const assignees = Array.isArray(issue.assignees) && issue.assignees.length
                          ? issue.assignees
                          : (issue.assigned_to ? [issue.assigned_to] : []);
                        const assigneeLabel = assignees.length
                          ? (assignees.length > 1
                            ? `${memberLookup.get(assignees[0]) || assignees[0]} +${assignees.length - 1}`
                            : (memberLookup.get(assignees[0]) || `User ${assignees[0]}`))
                          : 'Unassigned';
                        const pastDue = isPastDue(issue);
                        return (
                          <button
                            key={issue.id}
                            type="button"
                            draggable
                            onDragStart={(e) => handleDragStart(e, issue.id)}
                            onDragEnd={handleDragEnd}
                            className={`kanban-card ${selectedIssueId === issue.id ? 'active' : ''}${draggingIssueId === issue.id ? ' dragging' : ''}`}
                            onClick={() => setSelectedIssueId(issue.id)}
                            aria-label={`Open issue ${issue.title}`}
                          >
                            <div className="kanban-card-title">{issue.title}</div>
                            <div className="kanban-card-meta">
                              <span>#{issue.id}</span>
                              <span>{assigneeLabel}</span>
                              {issue.due_date && (
                                <span className={pastDue ? 'kanban-card-due-overdue' : ''}>
                                  Due {formatDate(issue.due_date)}
                                </span>
                              )}
                            </div>
                            {issue.priority && (
                              <span className={`kanban-card-priority priority-badge ${getPriorityClass(issue.priority)}`}>
                                {issue.priority}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="issue-detail-panel">
          {!selectedIssue ? (
            <div className="issue-detail-empty">
              <p>Select an issue to view details.</p>
            </div>
          ) : (
            <>
              <div className="issue-detail-header">
                <div>
                  <div className="issue-detail-number">#{selectedIssue.id}</div>
                  <h3 className="issue-detail-title">{selectedIssue.title}</h3>
                </div>
                <div className="issue-detail-actions">
                  <button
                    type="button"
                    onClick={() => handleEditIssue(selectedIssue)}
                    className="app-icon-action"
                    title="Edit issue"
                    aria-label="Edit issue"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteIssue(selectedIssue.id)}
                    className="app-icon-action app-icon-action--danger"
                    title="Delete issue"
                    aria-label="Delete issue"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="issue-detail-meta">
                <select 
                  id="issue-status-select"
                  value={selectedIssue.status || 'open'}
                  onChange={(e) => handleUpdateStatus(selectedIssue.id, e.target.value)}
                  className={`issue-status-select status-${selectedIssue.effectiveStatus || selectedIssue.status}`}
                  title="Change issue status"
                  aria-label="Change issue status"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="overdue">Overdue</option>
                  <option value="completed">Completed</option>
                  <option value="closed">Closed</option>
                </select>
                <span className="issue-detail-chip">
                  Due {formatDate(selectedIssue.due_date)}
                </span>
                {selectedIssue.priority && (
                  <span className={`priority-badge ${getPriorityClass(selectedIssue.priority)}`}>
                    {selectedIssue.priority}
                  </span>
                )}
              </div>

              {selectedIssue.description ? (
                <IssueDescriptionMarkdown
                  text={selectedIssue.description}
                  className="issue-detail-description-md"
                />
              ) : (
                <p className="issue-detail-description empty">No description provided.</p>
              )}

              <div className="issue-reminders" id="issue-reminders" aria-label="Issue reminders">
                <div className="issue-reminders-header">
                  <Bell size={16} strokeWidth={1.75} aria-hidden className="issue-reminders-icon" />
                  <span className="issue-reminders-heading">Reminders</span>
                  {(issueRemindersBusy || issueRemindersLoading) && (
                    <span className="issue-reminders-status" aria-live="polite">
                      Updating…
                    </span>
                  )}
                </div>
                <p className="issue-reminders-caption">
                  From this issue and related workspace documents. Refreshes when the issue text, due date,
                  or workspace files change. Acknowledged and dismissed lines stay cleared when suggestions
                  refresh.
                </p>
                {issueRemindersDegraded && (
                  <p className="issue-reminders-note issue-reminders-note--warn" role="status">
                    {issueRemindersDegraded}
                  </p>
                )}
                {issueRemindersFetchError && (
                  <p className="issue-reminders-note issue-reminders-note--error" role="alert">
                    {issueRemindersFetchError}
                  </p>
                )}
                {!issueRemindersBusy
                  && !issueRemindersLoading
                  && !issueRemindersFetchError
                  && issueReminders.length === 0
                  && !issueRemindersDegraded && (
                  <p className="issue-reminders-empty">No suggestions right now.</p>
                )}
                <ul className="issue-reminders-list">
                  {issueReminders.map((r) => (
                    <li key={r.id} className="issue-reminders-item">
                      <div className="issue-reminders-item-main">
                        <span className="issue-reminders-type">{formatReminderType(r.hint_type)}</span>
                        <span className="issue-reminders-content">{r.content}</span>
                        {r.ai_suggested && (
                          <span className="issue-reminders-badge">
                            {r.ai_model_used === 'reminder_classifier' ? 'ML' : 'Ada'}
                          </span>
                        )}
                      </div>
                      <div className="issue-reminders-actions">
                        <button
                          type="button"
                          className="issue-reminders-action"
                          disabled={issueReminderActionId === r.id}
                          onClick={() => handleIssueReminderAcknowledge(r.id)}
                        >
                          Acknowledge
                        </button>
                        <span className="issue-reminders-action-sep" aria-hidden>
                          ·
                        </span>
                        <button
                          type="button"
                          className="issue-reminders-action issue-reminders-action--muted"
                          disabled={issueReminderActionId === r.id}
                          onClick={() => handleIssueReminderDismiss(r.id)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="issue-detail-history">
                <button
                  type="button"
                  className="issue-detail-history-toggle"
                  onClick={() => setTaskHistoryOpen((o) => !o)}
                  aria-expanded={taskHistoryOpen}
                >
                  {taskHistoryOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <span>Activity history</span>
                  {taskHistory.length > 0 && (
                    <span className="issue-detail-history-count">{taskHistory.length}</span>
                  )}
                </button>
                {taskHistoryOpen && (
                  <div className="issue-detail-history-body">
                    {taskHistoryLoading ? (
                      <p className="issue-detail-history-empty">Loading history…</p>
                    ) : taskHistory.length === 0 ? (
                      <p className="issue-detail-history-empty">
                        No recorded changes yet. Updates to status, assignees, title, description,
                        reminder suggestions, and other activity will appear here.
                      </p>
                    ) : (
                      <ul className="issue-detail-history-list">
                        {taskHistory.map((entry) => (
                          <li key={entry.id} className="issue-detail-history-item">
                            <div className="issue-detail-history-meta">
                              <strong>
                                {memberLookup.get(entry.actor_user_id)
                                  || `User ${entry.actor_user_id}`}
                              </strong>
                              <span>{formatDateTime(entry.created_at)}</span>
                            </div>
                            <ul className="issue-detail-history-changes">
                              {(entry.changes || []).map((ch, idx) => (
                                <li key={idx}>{formatHistoryChangeLine(ch)}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="issue-detail-controls">
                <div className="issue-detail-control">
                  <label className="issue-detail-assignees-heading">
                    assigned (
                    {(selectedIssue.assignees && selectedIssue.assignees.length)
                      ? selectedIssue.assignees.length
                      : (selectedIssue.assigned_to ? 1 : 0)}
                    )
                  </label>
                  <div className="assignee-list">
                    {(!selectedIssue.assignees || selectedIssue.assignees.length === 0)
                      && <span className="assignee-pill">Unassigned</span>}
                    {(selectedIssue.assignees || (selectedIssue.assigned_to ? [selectedIssue.assigned_to] : [])).map((assigneeId) => (
                      <span key={assigneeId} className="assignee-pill active">
                        {memberLookup.get(assigneeId) || `User ${assigneeId}`}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="issue-detail-control">
                  <label>Details</label>
                  <div className="issue-detail-kv">
                    <div>
                      <span>Created</span>
                      <strong>{formatDateTime(selectedIssue.created_at)}</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{formatDateTime(selectedIssue.updated_at)}</strong>
                    </div>
                    <div>
                      <span>Created by</span>
                      <strong>{memberLookup.get(selectedIssue.created_by) || `User ${selectedIssue.created_by}`}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create Issue Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowCreateModal(false);
            setEditingIssue(null);
            setError(null);
          }}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>
              {editingIssue ? 'Edit Issue' : 'Create New Issue'}
            </h3>
            <div className="form-group">
              <label htmlFor="issue-title">Title</label>
              <input
                id="issue-title"
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="form-input"
                placeholder="Issue title"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="issue-description">Description (required)</label>
              <p className="form-helper" id="issue-description-hint">
                Smart reminders (follow-ups, deadlines, reviews) combine this text with related workspace
                documents—include what needs to happen, by when, owners or stakeholders, and useful links.
                Use Markdown: **bold**, *italic*, `code`, links, lists, headings, and fenced code blocks.
              </p>
              <textarea
                id="issue-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="form-textarea"
                required
                aria-required="true"
                aria-describedby="issue-description-hint"
                placeholder="What needs doing, key dates, blockers, and next steps? Reminders use this text. You can use **bold**, lists, and `code`."
                rows={5}
              />
            </div>

            <div className="form-group">
              <label htmlFor="issue-priority">Priority</label>
              <select
                id="issue-priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="form-input"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="issue-due-date">Due Date</label>
              <input
                id="issue-due-date"
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>Assignees</label>
              <p className="form-helper">Select one or more assignees.</p>
              <div className="assignee-picker">
                {members.map((member) => {
                  const label = member.user_id === currentUserId ? 'Me' : (member.username || member.email);
                  const isActive = formData.assignees?.includes(member.user_id);
                  return (
                    <button
                      type="button"
                      key={member.user_id}
                      className={`assignee-pill ${isActive ? 'active' : ''}`}
                      onClick={() => toggleAssignee(member.user_id)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="modal-actions">
              <button
                onClick={editingIssue ? handleUpdateIssue : handleCreateIssue}
                className="btn-primary"
              >
                {editingIssue ? 'Save Changes' : 'Create Issue'}
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingIssue(null);
                  setError(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkspaceIssues;
