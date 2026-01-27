import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function Documents() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const workspaceId = queryParams.get('workspace');

  const [documents, setDocuments] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(workspaceId || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      fetchDocuments();
    }
  }, [selectedWorkspace]);

  const fetchWorkspaces = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setWorkspaces(data);
        if (!selectedWorkspace && data.length > 0) {
          setSelectedWorkspace(data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
    }
  };

  const fetchDocuments = async () => {
    if (!selectedWorkspace) return;

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents?workspace_id=${selectedWorkspace}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile || !selectedWorkspace) return;

    setUploading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('workspace_id', selectedWorkspace);

      const response = await fetch(`${API_URL}/api/v1/documents/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload document');
      }

      setUploadFile(null);
      fetchDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (documentId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      fetchDocuments();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadDocument = async (documentId, filename) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents/${documentId}/download`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to download document');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Documents</h1>

      {error && (
        <div style={{ color: 'red', padding: '10px', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Upload Document</h2>
        <form onSubmit={handleFileUpload}>
          <div style={{ marginBottom: '15px' }}>
            <label>Workspace:</label>
            <select
              value={selectedWorkspace}
              onChange={(e) => setSelectedWorkspace(e.target.value)}
              required
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="">Select a workspace</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label>File:</label>
            <input
              type="file"
              onChange={(e) => setUploadFile(e.target.files[0])}
              required
              style={{ width: '100%', padding: '8px' }}
            />
          </div>
          <button 
            type="submit" 
            disabled={uploading || !selectedWorkspace}
            style={{ padding: '10px 20px', cursor: 'pointer' }}
          >
            {uploading ? 'Uploading...' : 'Upload Document'}
          </button>
        </form>
      </div>

      {selectedWorkspace && (
        <div>
          <h2>Documents in Workspace</h2>
          {loading ? (
            <p>Loading documents...</p>
          ) : (
            <div style={{ display: 'grid', gap: '15px' }}>
              {documents.length === 0 ? (
                <p>No documents found in this workspace.</p>
              ) : (
                documents.map((doc) => (
                  <div 
                    key={doc.id} 
                    style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <h3 style={{ margin: 0 }}>{doc.filename}</h3>
                      <p style={{ margin: '5px 0', color: '#666', fontSize: '14px' }}>
                        Uploaded: {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        onClick={() => handleDownloadDocument(doc.id, doc.filename)}
                        style={{ padding: '8px 16px', cursor: 'pointer' }}
                      >
                        Download
                      </button>
                      <button 
                        onClick={() => handleDeleteDocument(doc.id)}
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
      )}
    </div>
  );
}

export default Documents;
