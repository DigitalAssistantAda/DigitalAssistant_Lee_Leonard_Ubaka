import React, { useState, useEffect } from 'react';

function Summaries() {
  const [documents, setDocuments] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [selectedDocument, setSelectedDocument] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);

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
        if (data.length > 0) {
          setSelectedWorkspace(data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
    }
  };

  const fetchDocuments = async () => {
    if (!selectedWorkspace) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents?workspace_id=${selectedWorkspace}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    }
  };

  const handleGenerateSummary = async (e) => {
    e.preventDefault();
    if (!selectedDocument) return;

    setGeneratingSummary(true);
    setError(null);
    setSummary(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/summaries/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document_id: selectedDocument,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate summary');
      }

      const data = await response.json();
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleLoadSummary = async (documentId) => {
    setLoading(true);
    setError(null);
    setSummary(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/summaries/${documentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('No summary found for this document');
      }

      const data = await response.json();
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Document Summaries</h1>

      {error && (
        <div style={{ color: 'red', padding: '10px', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Generate Summary</h2>
        <form onSubmit={handleGenerateSummary}>
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
            <label>Document:</label>
            <select
              value={selectedDocument}
              onChange={(e) => setSelectedDocument(e.target.value)}
              required
              disabled={!selectedWorkspace || documents.length === 0}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="">Select a document</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>{doc.filename}</option>
              ))}
            </select>
          </div>
          <button 
            type="submit" 
            disabled={generatingSummary || !selectedDocument}
            style={{ padding: '10px 20px', cursor: 'pointer', marginRight: '10px' }}
          >
            {generatingSummary ? 'Generating...' : 'Generate Summary'}
          </button>
          {selectedDocument && (
            <button 
              type="button"
              onClick={() => handleLoadSummary(selectedDocument)}
              disabled={loading}
              style={{ padding: '10px 20px', cursor: 'pointer' }}
            >
              {loading ? 'Loading...' : 'Load Existing Summary'}
            </button>
          )}
        </form>
      </div>

      {summary && (
        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', background: '#f9f9f9' }}>
          <h2>Summary</h2>
          <div style={{ marginBottom: '10px' }}>
            <strong>Document:</strong> {summary.document_name || 'Unknown'}
          </div>
          {summary.created_at && (
            <div style={{ marginBottom: '10px', color: '#666', fontSize: '14px' }}>
              Generated: {new Date(summary.created_at).toLocaleString()}
            </div>
          )}
          <div style={{ marginTop: '15px', padding: '15px', background: 'white', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
            {summary.summary_text || summary.content || 'No summary text available'}
          </div>
        </div>
      )}
    </div>
  );
}

export default Summaries;
