import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Plus, Trash2, AlertCircle, Pencil, Search as SearchIcon, List, ListTodo, Columns3 } from 'lucide-react';
import { getApiErrorMessage } from '../utils/apiError';
import LoadingState from '../components/LoadingState';
import './WorkspaceIssues.css';

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

    if (dueUtcDate < todayUtcDate) return 'overdue';
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

  const statusOrder = ['open', 'in_progress', 'overdue', 'completed', 'closed'];
  const kanbanColumns = useMemo(() => {
    return statusOrder.map((status) => ({
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

  const fetchIssues = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams({ task_type: 'issue' });
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

  const getStatusLabel = (status) => status.replace('_', ' ');
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
      {/* Breadcrumb: left = ← Workspace / Issues, right = Back to Dashboard only */}
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
        <button
          type="button"
          className="issues-back-link"
          onClick={() => navigate('/dashboard')}
        >
          Back to Dashboard
        </button>
      </div>

      {/* Page header: title left, New Issue right (reference layout) */}
      <div className="issues-page-header">
        <h1 className="issues-page-title">Issues</h1>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
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
        {statusOrder.map((status) => (
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
                  <div className="kanban-column-cards">
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
                        return (
                          <button
                            key={issue.id}
                            type="button"
                            className={`kanban-card ${selectedIssueId === issue.id ? 'active' : ''}`}
                            onClick={() => setSelectedIssueId(issue.id)}
                            aria-label={`Open issue ${issue.title}`}
                          >
                            <div className="kanban-card-title">{issue.title}</div>
                            <div className="kanban-card-meta">
                              <span>#{issue.id}</span>
                              <span>{assigneeLabel}</span>
                              {issue.due_date && <span>Due {formatDate(issue.due_date)}</span>}
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
                    onClick={() => handleEditIssue(selectedIssue)}
                    className="btn-edit-issue"
                    title="Edit issue"
                    aria-label="Edit issue"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteIssue(selectedIssue.id)}
                    className="btn-delete-issue"
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
                  className={`issue-status-select status-${selectedIssue.status}`}
                  title="Change issue status"
                  aria-label="Change issue status"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="overdue">Overdue</option>
                  <option value="closed">Closed</option>
                </select>
                <span className="issue-detail-chip">
                  Assigned to {(selectedIssue.assignees && selectedIssue.assignees.length)
                    ? `${selectedIssue.assignees.length} people`
                    : (selectedIssue.assigned_to ? '1 person' : 'Unassigned')}
                </span>
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
                <p className="issue-detail-description">{selectedIssue.description}</p>
              ) : (
                <p className="issue-detail-description empty">No description provided.</p>
              )}

              <div className="issue-detail-controls">
                <div className="issue-detail-control">
                  <label>Assignees</label>
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
              <label htmlFor="issue-description">Description</label>
              <textarea
                id="issue-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="form-textarea"
                placeholder="Describe the issue (optional)"
                rows="4"
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
