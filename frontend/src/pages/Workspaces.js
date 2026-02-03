import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, X, Search, Settings, AlertCircle } from 'lucide-react';
import './Workspaces.css';

function Workspaces() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState({ name: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('recent');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const [selectedWorkspaces, setSelectedWorkspaces] = useState(new Set());

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch workspaces');
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setWorkspaces(items);
    } catch (err) {
      setError(err.message || 'Unable to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    if (!newWorkspace.name.trim()) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newWorkspace),
      });

      if (!response.ok) {
        throw new Error('Failed to create workspace');
      }

      setNewWorkspace({ name: '' });
      setShowCreateForm(false);
      fetchWorkspaces();
    } catch (err) {
      setError(err.message || 'Failed to create workspace');
    }
  };

  const handleDeleteWorkspace = async (id) => {
    if (!window.confirm('Are you sure you want to delete this workspace?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete workspace');
      }

      setSelectedWorkspaces(prev => {
        const updated = new Set(prev);
        updated.delete(id);
        return updated;
      });
      fetchWorkspaces();
    } catch (err) {
      setError(err.message || 'Failed to delete workspace');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedWorkspaces.size === 0) return;
    const count = selectedWorkspaces.size;
    if (!window.confirm(`Delete ${count} workspace${count > 1 ? 's' : ''}?`)) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const deletionPromises = Array.from(selectedWorkspaces).map(id =>
        fetch(`${API_URL}/api/v1/workspaces/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      );

      await Promise.all(deletionPromises);
      setSelectedWorkspaces(new Set());
      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckboxChange = (id) => {
    const newSelected = new Set(selectedWorkspaces);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedWorkspaces(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedWorkspaces.size === filteredWorkspaces.length) {
      setSelectedWorkspaces(new Set());
    } else {
      setSelectedWorkspaces(new Set(filteredWorkspaces.map(ws => ws.id)));
    }
  };

  const filteredWorkspaces = useMemo(() => {
    let filtered = workspaces;

    if (workspaceFilter === 'mine') {
      // TODO: filter by user's workspaces
    }

    if (searchTerm) {
      filtered = filtered.filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    return filtered.sort((a, b) => {
      if (sortOrder === 'name') {
        return a.name.localeCompare(b.name);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [workspaces, searchTerm, sortOrder, workspaceFilter]);

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const navigateToWorkspace = (id) => {
    navigate(`/workspace/${id}`);
  };

  return (
    <div className="workspaces-page">
      <header className="workspaces-header">
        <div className="header-content">
          <h1>Workspaces</h1>
          <p>Manage your workspaces and documents</p>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={() => setShowCreateForm(true)}
          title="Create new workspace"
          aria-label="Create new workspace"
        >
          <Plus size={18} />
          New Workspace
        </button>
      </header>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button 
            className="close-error"
            onClick={() => setError(null)}
            aria-label="Close error message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create Workspace</h2>
              <button 
                className="modal-close" 
                onClick={() => setShowCreateForm(false)}
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateWorkspace}>
              <div className="form-group">
                <label htmlFor="workspace-name">Workspace Name</label>
                <input
                  id="workspace-name"
                  type="text"
                  placeholder="Workspace name"
                  value={newWorkspace.name}
                  onChange={(e) => setNewWorkspace({ name: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="workspaces-controls">
        <div className="controls-left">
          <select value={workspaceFilter} onChange={(e) => setWorkspaceFilter(e.target.value)}>
            <option value="all">All Workspaces</option>
            <option value="mine">My Workspaces</option>
          </select>
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <option value="recent">Most Recent</option>
            <option value="name">Name (A-Z)</option>
          </select>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search workspaces..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search workspaces"
          />
        </div>
      </div>

      {selectedWorkspaces.size > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-info">
            <input 
              type="checkbox"
              checked={selectedWorkspaces.size === filteredWorkspaces.length}
              onChange={handleSelectAll}
              title={selectedWorkspaces.size === filteredWorkspaces.length ? 'Deselect all' : 'Select all'}
              aria-label={selectedWorkspaces.size === filteredWorkspaces.length ? 'Deselect all workspaces' : 'Select all workspaces'}
            />
            <span>{selectedWorkspaces.size} selected</span>
          </div>
          <button 
            className="action-btn delete-btn"
            onClick={handleBulkDelete}
            title="Delete selected workspaces"
            aria-label={`Delete ${selectedWorkspaces.size} workspace${selectedWorkspaces.size > 1 ? 's' : ''}`}
          >
            <Trash2 size={18} />
            Delete
          </button>
        </div>
      )}

      <div className="workspaces-list">
        {loading ? (
          <div className="loading">Loading workspaces...</div>
        ) : filteredWorkspaces.length === 0 ? (
          <div className="empty-state">
            <p>No workspaces found</p>
            <button className="btn btn-primary" onClick={() => setShowCreateForm(true)}>
              Create your first workspace
            </button>
          </div>
        ) : (
          <div className="workspace-grid">
            {filteredWorkspaces.map((workspace) => (
              <div key={workspace.id} className="workspace-row">
                <div className="workspace-checkbox">
                  <input 
                    type="checkbox"
                    checked={selectedWorkspaces.has(workspace.id)}
                    onChange={() => handleCheckboxChange(workspace.id)}
                    title="Select workspace"
                    aria-label={`Select ${workspace.name}`}
                  />
                </div>
                <div className="workspace-info" onClick={() => navigateToWorkspace(workspace.id)}>
                  <h3>{workspace.name}</h3>
                  <div className="workspace-meta">
                    <span>{workspace.document_count ?? 0} Documents</span>
                    <span>{workspace.member_count ?? 0} Members</span>
                    <span>Created {formatDate(workspace.created_at)}</span>
                  </div>
                </div>
                <div className="workspace-actions">
                  <button 
                    className="btn btn-secondary"
                    onClick={() => navigate(`/workspace/${workspace.id}/issues`)}
                    title="View issues"
                    aria-label={`View issues in ${workspace.name}`}
                  >
                    <AlertCircle size={16} /> Issues
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => navigate(`/workspace/${workspace.id}/settings`)}
                    title="Workspace settings"
                    aria-label={`Settings for ${workspace.name}`}
                  >
                    <Settings size={16} /> Settings
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => navigateToWorkspace(workspace.id)}
                    title="Open workspace"
                    aria-label={`Open ${workspace.name}`}
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Workspaces;
