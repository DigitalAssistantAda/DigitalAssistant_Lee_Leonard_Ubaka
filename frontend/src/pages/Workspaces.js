import React, { useState, useEffect } from 'react';

function Workspaces() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState({
    name: '',
    description: ''
  });

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch workspaces');
      }

      const data = await response.json();
      setWorkspaces(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newWorkspace),
      });

      if (!response.ok) {
        throw new Error('Failed to create workspace');
      }

      setNewWorkspace({ name: '', description: '' });
      setShowCreateForm(false);
      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteWorkspace = async (workspaceId) => {
    if (!window.confirm('Are you sure you want to delete this workspace?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete workspace');
      }

      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Workspaces</h1>
        <button 
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{ padding: '10px 20px', cursor: 'pointer' }}
        >
          {showCreateForm ? 'Cancel' : 'Create New Workspace'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'red', padding: '10px', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      {showCreateForm && (
        <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h2>Create New Workspace</h2>
          <form onSubmit={handleCreateWorkspace}>
            <div style={{ marginBottom: '15px' }}>
              <label>Name:</label>
              <input
                type="text"
                value={newWorkspace.name}
                onChange={(e) => setNewWorkspace({ ...newWorkspace, name: e.target.value })}
                required
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label>Description:</label>
              <textarea
                value={newWorkspace.description}
                onChange={(e) => setNewWorkspace({ ...newWorkspace, description: e.target.value })}
                style={{ width: '100%', padding: '8px', minHeight: '80px' }}
              />
            </div>
            <button type="submit" style={{ padding: '10px 20px', cursor: 'pointer' }}>
              Create Workspace
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <p>Loading workspaces...</p>
      ) : (
        <div style={{ display: 'grid', gap: '20px' }}>
          {workspaces.length === 0 ? (
            <p>No workspaces found. Create your first workspace to get started.</p>
          ) : (
            workspaces.map((workspace) => (
              <div 
                key={workspace.id} 
                style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}
              >
                <h3>{workspace.name}</h3>
                {workspace.description && <p>{workspace.description}</p>}
                <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                  <button 
                    onClick={() => window.location.href = `/documents?workspace=${workspace.id}`}
                    style={{ padding: '8px 16px', cursor: 'pointer' }}
                  >
                    View Documents
                  </button>
                  <button 
                    onClick={() => handleDeleteWorkspace(workspace.id)}
                    style={{ padding: '8px 16px', cursor: 'pointer', background: '#dc3545', color: 'white' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default Workspaces;
