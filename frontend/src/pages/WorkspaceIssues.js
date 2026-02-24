import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Plus, Trash2, AlertCircle, CheckCircle, Clock, Pencil, Search as SearchIcon } from 'lucide-react';
import { getApiErrorMessage } from '../utils/apiError';
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
  const [taskType, setTaskType] = useState('issue');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState(null);
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

  const normalizedIssues = useMemo(() => issues.map((issue) => ({
    ...issue,
    status: issue.status || 'open',
  })), [issues]);

  const statusCounts = useMemo(() => {
    return normalizedIssues.reduce((acc, issue) => {
      acc[issue.status] = (acc[issue.status] || 0) + 1;
      return acc;
    }, {});
  }, [normalizedIssues]);

  const filteredIssues = useMemo(() => {
    let result = normalizedIssues;
    if (statusFilter !== 'all') {
      result = result.filter((issue) => issue.status === statusFilter);
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
  }, [resolvedWorkspaceId, API_URL, token, assignmentScope, currentUserId, taskType]);

  useEffect(() => {
    setSelectedIssueId(null);
    setStatusFilter('all');
    const params = new URLSearchParams(location.search);
    if (params.has('issueId')) {
      params.delete('issueId');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [taskType]);

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

  const fetchIssues = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams({ task_type: taskType });
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
        type: taskType,
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

  const statusOrder = ['open', 'in_progress', 'overdue', 'completed', 'closed'];
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

  const getStatusIcon = (status) => {
    switch (status) {
      case 'open':
        return <AlertCircle size={16} className="status-icon open" />;
      case 'in_progress':
        return <Clock size={16} className="status-icon in-progress" />;
      case 'completed':
        return <CheckCircle size={16} className="status-icon completed" />;
      default:
        return <AlertCircle size={16} className="status-icon" />;
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

  if (loading) return <div className="issues-container"><p>Loading issues...</p></div>;

  return (
    <div className="issues-container">
      <div className="issues-header">
        <h2>{taskType === 'issue' ? 'Issues' : 'Deadlines'}</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-create-issue"
          title={`Create new ${taskType}`}
          aria-label={`Create new ${taskType}`}
        >
          <Plus size={16} /> {taskType === 'issue' ? 'New Issue' : 'New Deadline'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Status Filter */}
      <div className="filter-controls">
        <div className="issue-search">
          <select
            value={resolvedWorkspaceId || ''}
            onChange={(e) => navigate(`/workspace/${e.target.value}/issues`)}
            aria-label="Filter by workspace"
            title="Filter by workspace"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
        <div className="scope-controls">
          <button
            className={`filter-btn ${taskType === 'issue' ? 'active' : ''}`}
            onClick={() => setTaskType('issue')}
            title="Show issues"
            aria-label="Show issues"
          >
            Issues
          </button>
          <button
            className={`filter-btn ${taskType === 'deadline' ? 'active' : ''}`}
            onClick={() => setTaskType('deadline')}
            title="Show deadlines"
            aria-label="Show deadlines"
          >
            Deadlines
          </button>
        </div>
        <div className="scope-controls">
          <button
            className={`filter-btn ${assignmentScope === 'assigned' ? 'active' : ''}`}
            onClick={() => setAssignmentScope('assigned')}
            title="Show issues assigned to you"
            aria-label="Show issues assigned to you"
          >
            Assigned to me
          </button>
          <button
            className={`filter-btn ${assignmentScope === 'all' ? 'active' : ''}`}
            onClick={() => setAssignmentScope('all')}
            title="Show all issues"
            aria-label="Show all issues"
          >
            All issues
          </button>
        </div>
        <div className="issue-search issue-search-text">
          <SearchIcon size={16} className="issue-search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={taskType === 'issue' ? 'Search issues...' : 'Search deadlines...'}
            aria-label={taskType === 'issue' ? 'Search issues' : 'Search deadlines'}
          />
        </div>
        <button
          className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
          title="Show all issues"
          aria-label="Show all issues"
        >
          All ({normalizedIssues.length})
        </button>
        {statusOrder.map((status) => (
          <button
            key={status}
            className={`filter-btn ${statusFilter === status ? 'active' : ''}`}
            onClick={() => setStatusFilter(status)}
            title={`Show ${getStatusLabel(status)} issues`}
            aria-label={`Show ${getStatusLabel(status)} issues`}
          >
            {getStatusLabel(status)} ({statusCounts[status] || 0})
          </button>
        ))}
      </div>

      {/* Issues Layout */}
      <div className="issues-layout">
        <div className="issues-list-panel">
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
                        <span className={`issue-row-status-dot ${getStatusClass(issue.status)}`} />
                        {getStatusLabel(issue.status)}
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
                <span className="issue-detail-chip">
                  {getStatusIcon(selectedIssue.status)}
                  {getStatusLabel(selectedIssue.status)}
                </span>
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
              {editingIssue
                ? (taskType === 'issue' ? 'Edit Issue' : 'Edit Deadline')
                : (taskType === 'issue' ? 'Create New Issue' : 'Create New Deadline')}
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

            {taskType === 'issue' && (
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
            )}

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
                {editingIssue ? 'Save Changes' : (taskType === 'issue' ? 'Create Issue' : 'Create Deadline')}
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
