import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Download, Trash2, Filter, Search, Grid3x3, List, X } from 'lucide-react';
import './Documents.css';

function Documents() {
  const [documents, setDocuments] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [viewMode, setViewMode] = useState('list');
  const [selectedDocuments, setSelectedDocuments] = useState(new Set());
  const [showFilters, setShowFilters] = useState(false);

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
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        setWorkspaces(items);
        if (items.length > 0 && !selectedWorkspace) {
          setSelectedWorkspace(items[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
      setError('Failed to load workspaces');
    }
  };

  const fetchDocuments = async () => {
    if (!selectedWorkspace) return;
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces/${selectedWorkspace}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to fetch documents');

      const data = await response.json();
      const items = Array.isArray(data?.documents) ? data.documents : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setDocuments(items);
      setSelectedDocuments(new Set());
    } catch (err) {
      setError(err.message);
      setDocuments([]);
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

      const response = await fetch(`${API_URL}/api/v1/workspaces/${selectedWorkspace}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to upload document');

      setUploadFile(null);
      setShowUploadModal(false);
      fetchDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (docId) => {
    if (!window.confirm('Delete this document?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Delete failed');
      fetchDocuments();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDocuments.size === 0) return;
    const count = selectedDocuments.size;
    if (!window.confirm(`Delete ${count} document${count > 1 ? 's' : ''}?`)) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const deletionPromises = Array.from(selectedDocuments).map(docId =>
        fetch(`${API_URL}/api/v1/documents/${docId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      );

      await Promise.all(deletionPromises);
      setSelectedDocuments(new Set());
      fetchDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadDocument = async (docId, filename) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Download failed');

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

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilterStatus('all');
    setFilterType('all');
    setDateFrom('');
    setDateTo('');
    setOwnerFilter('');
  };

  const handleCheckboxChange = (docId) => {
    const newSelected = new Set(selectedDocuments);
    if (newSelected.has(docId)) {
      newSelected.delete(docId);
    } else {
      newSelected.add(docId);
    }
    setSelectedDocuments(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedDocuments.size === filteredDocuments.length) {
      setSelectedDocuments(new Set());
    } else {
      setSelectedDocuments(new Set(filteredDocuments.map(doc => doc.id)));
    }
  };

  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      const matchSearch = doc.filename.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = filterStatus === 'all' || doc.status === filterStatus;
      const matchType = filterType === 'all' || (doc.mime_type && doc.mime_type.includes(filterType));
      return matchSearch && matchStatus && matchType;
    });
  }, [documents, searchQuery, filterStatus, filterType]);

  return (
    <div className="documents-container">
      <div className="documents-header">
        <h1>Documents</h1>
        <div className="header-actions">
          <div className="view-toggle">
            <button 
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              aria-label="Switch to list view"
            >
              <List size={18} />
            </button>
            <button 
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
              aria-label="Switch to grid view"
            >
              <Grid3x3 size={18} />
            </button>
          </div>
          <button 
            className="btn btn-primary upload-btn"
            onClick={() => setShowUploadModal(true)}
            title="Upload new document"
            aria-label="Upload new document"
          >
            <Upload size={18} />
            Upload
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
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

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Upload Document</h2>
              <button 
                className="modal-close" 
                onClick={() => setShowUploadModal(false)}
                title="Close dialog"
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleFileUpload}>
              <div className="form-group">
                <label htmlFor="workspace-select">Workspace</label>
                <select 
                  id="workspace-select"
                  value={selectedWorkspace} 
                  onChange={(e) => setSelectedWorkspace(e.target.value)}
                  required
                >
                  <option value="">Select workspace</option>
                  {workspaces.map(ws => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="file-input">File</label>
                <div className="file-upload-area">
                  <Upload size={24} />
                  <p className="upload-text">Click to browse or drag and drop</p>
                  <input
                    type="file"
                    id="file-input"
                    onChange={(e) => setUploadFile(e.target.files[0])}
                    required
                  />
                </div>
                {uploadFile && <div className="selected-file">{uploadFile.name}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="tags-input">Tags (optional)</label>
                <input 
                  id="tags-input"
                  type="text" 
                  placeholder="Add tags separated by commas" 
                />
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={!uploadFile || !selectedWorkspace || uploading}
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filters Section */}
      <div className="filters-section">
        <div className="filters-header">
          <button 
            className="filter-toggle"
            onClick={() => setShowFilters(!showFilters)}
            title="Toggle filters"
            aria-label="Toggle filters"
          >
            <Filter size={18} />
            Filters
          </button>
          {(searchQuery || filterStatus !== 'all' || filterType !== 'all' || dateFrom || dateTo || ownerFilter) && (
            <button 
              className="clear-filters-btn"
              onClick={handleClearFilters}
              title="Clear all filters"
              aria-label="Clear all filters"
            >
              Clear
            </button>
          )}
        </div>

        {showFilters && (
          <>
            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search documents"
              />
            </div>

            <div className="filter-row">
              <div className="filter-group">
                <label htmlFor="workspace-filter">Workspace</label>
                <select 
                  id="workspace-filter"
                  value={selectedWorkspace} 
                  onChange={(e) => setSelectedWorkspace(e.target.value)}
                >
                  {workspaces.map(ws => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label htmlFor="status-filter">Status</label>
                <select 
                  id="status-filter"
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="ready">Ready</option>
                  <option value="processing">Processing</option>
                  <option value="failed">Failed</option>
                </select>
              </div>

              <div className="filter-group">
                <label htmlFor="type-filter">Type</label>
                <select 
                  id="type-filter"
                  value={filterType} 
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">All Types</option>
                  <option value="pdf">PDF</option>
                  <option value="text">Text</option>
                  <option value="word">Word</option>
                </select>
              </div>
            </div>

            <div className="filter-row">
              <div className="filter-group">
                <label htmlFor="date-from">Date From</label>
                <input 
                  id="date-from"
                  type="date" 
                  value={dateFrom} 
                  onChange={(e) => setDateFrom(e.target.value)} 
                />
              </div>

              <div className="filter-group">
                <label htmlFor="date-to">Date To</label>
                <input 
                  id="date-to"
                  type="date" 
                  value={dateTo} 
                  onChange={(e) => setDateTo(e.target.value)} 
                />
              </div>

              <div className="filter-group">
                <label htmlFor="owner-filter">Owner</label>
                <input 
                  id="owner-filter"
                  type="text" 
                  placeholder="Filter by owner"
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  aria-label="Filter by owner"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {selectedDocuments.size > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-info">
            <input 
              type="checkbox"
              checked={selectedDocuments.size === filteredDocuments.length}
              onChange={handleSelectAll}
              title={selectedDocuments.size === filteredDocuments.length ? 'Deselect all' : 'Select all'}
              aria-label={selectedDocuments.size === filteredDocuments.length ? 'Deselect all documents' : 'Select all documents'}
            />
            <span>{selectedDocuments.size} selected</span>
          </div>
          <div className="bulk-action-buttons">
            <button 
              className="action-btn download-btn"
              onClick={() => {
                Array.from(selectedDocuments).forEach(docId => {
                  const doc = documents.find(d => d.id === docId);
                  if (doc) handleDownloadDocument(docId, doc.filename);
                });
              }}
              title="Download selected documents"
              aria-label={`Download ${selectedDocuments.size} document${selectedDocuments.size > 1 ? 's' : ''}`}
            >
              <Download size={18} />
              Download
            </button>
            <button 
              className="action-btn delete-btn"
              onClick={handleBulkDelete}
              title="Delete selected documents"
              aria-label={`Delete ${selectedDocuments.size} document${selectedDocuments.size > 1 ? 's' : ''}`}
            >
              <Trash2 size={18} />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Documents List/Grid */}
      <div className={`documents-${viewMode}`}>
        {loading ? (
          <p className="loading-text">Loading documents...</p>
        ) : filteredDocuments.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-text">No documents found</p>
          </div>
        ) : (
          filteredDocuments.map(doc => (
            <div key={doc.id} className={`document-item document-item-${viewMode}`}>
              <div className="document-checkbox">
                <input 
                  type="checkbox"
                  checked={selectedDocuments.has(doc.id)}
                  onChange={() => handleCheckboxChange(doc.id)}
                  title="Select document"
                  aria-label={`Select ${doc.filename}`}
                />
              </div>
              <div className="document-info">
                <div className="document-name">{doc.filename}</div>
                <div className="document-meta">Uploaded: {new Date(doc.created_at).toLocaleDateString()}</div>
              </div>
              <div className="document-date">{new Date(doc.created_at).toLocaleDateString()}</div>
              <div className="document-status">{doc.status || 'ready'}</div>
              <div className="document-size">{doc.mime_type?.split('/')[1] || 'file'}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Documents;
