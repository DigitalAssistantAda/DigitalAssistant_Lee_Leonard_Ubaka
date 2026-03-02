import React, { useState, useEffect } from 'react';
import './Summaries.css';
import { apiFetch } from '../utils/apiClient';

function Summaries() {
  const [documents, setDocuments] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [selectedDocument, setSelectedDocument] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);

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
      const data = await apiFetch('/api/v1/workspaces');
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setWorkspaces(items);
      if (items.length > 0) {
        setSelectedWorkspace(items[0].id);
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
    }
  };

  const fetchDocuments = async () => {
    if (!selectedWorkspace) return;

    try {
      const data = await apiFetch(`/api/v1/workspaces/${selectedWorkspace}/documents`);
      const items = Array.isArray(data?.documents)
        ? data.documents
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
            ? data
            : [];
      setDocuments(items);
    } catch (err) {
      console.error('Error fetching documents:', err);
    }
  };

  const generateSummary = async (documentId) => {
    const data = await apiFetch('/api/v1/summaries', {
      method: 'POST',
      body: {
        document_id: Number(documentId),
      },
    });
    setSummary(data);
  };

  const handleGenerateSummary = async (e) => {
    e.preventDefault();
    if (!selectedDocument) return;

    setGeneratingSummary(true);
    setError(null);
    setSummary(null);

    try {
      await generateSummary(selectedDocument);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleLoadSummary = async (documentId) => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      await generateSummary(documentId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="summaries-page">
      <h1>Document Summaries</h1>

      {error && (
        <div className="summaries-error">
          Error: {error}
        </div>
      )}

      <div className="summaries-card">
        <h2>Generate Summary</h2>
        <form onSubmit={handleGenerateSummary}>
          <div className="summaries-field">
            <label>Workspace:</label>
            <select
              value={selectedWorkspace}
              onChange={(e) => setSelectedWorkspace(e.target.value)}
              required
              className="summaries-select"
            >
              <option value="">Select a workspace</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          </div>
          <div className="summaries-field">
            <label>Document:</label>
            <select
              value={selectedDocument}
              onChange={(e) => setSelectedDocument(e.target.value)}
              required
              disabled={!selectedWorkspace || documents.length === 0}
              className="summaries-select"
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
            className="summaries-button"
          >
            {generatingSummary ? 'Generating...' : 'Generate Summary'}
          </button>
          {selectedDocument && (
            <button 
              type="button"
              onClick={() => handleLoadSummary(selectedDocument)}
              disabled={loading}
              className="summaries-button"
            >
              {loading ? 'Loading...' : 'Regenerate Summary'}
            </button>
          )}
        </form>
      </div>

      {summary && (
        <div className="summary-panel">
          <h2>Summary</h2>
          <div className="summary-meta">
            <strong>Document:</strong> {summary.document_name || 'Unknown'}
          </div>
          <div className="summary-meta">
            <strong>Source:</strong> {summary.summary_source || 'unknown'}
          </div>
          {summary.created_at && (
            <div className="summary-generated">
              Generated: {new Date(summary.created_at).toLocaleString()}
            </div>
          )}
          <div className="summary-content">
            {summary.summary_text || summary.content || 'No summary text available'}
          </div>
        </div>
      )}
    </div>
  );
}

export default Summaries;
