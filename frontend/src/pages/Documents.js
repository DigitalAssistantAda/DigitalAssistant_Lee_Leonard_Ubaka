import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Upload, Download, Trash2, Search, Grid3x3, List, X, Plus, Folder, ChevronDown, MoreVertical } from 'lucide-react';
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
  const [showCreateContainer, setShowCreateContainer] = useState(false);
  const [containerName, setContainerName] = useState('');
  const [containerColor, setContainerColor] = useState('#f59e0b');
  const [createdContainers, setCreatedContainers] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list');
  const [selectedDocuments, setSelectedDocuments] = useState(new Set());
  const [openedFolder, setOpenedFolder] = useState(null);
  const [folderDocuments, setFolderDocuments] = useState([]);
  const [sortBy, setSortBy] = useState('lastOpened');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      fetchDocuments();
    }
  }, [selectedWorkspace]);

    // Add this useEffect after your other useEffect hooks
  useEffect(() => {
    // Load created containers from localStorage
    const savedContainers = localStorage.getItem('createdContainers');
    if (savedContainers) {
      try {
        setCreatedContainers(JSON.parse(savedContainers));
      } catch (err) {
        console.error('Error loading saved containers:', err);
      }
    }
  }, []);

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

    const handleCreateContainer = async (e) => {
    e.preventDefault();
    if (!containerName) {
      setError('Please enter a container name');
      return;
    }

    // Build the endpoint URL
    const createUrl = selectedWorkspace
      ? `${API_URL}/api/v1/workspaces/${selectedWorkspace}/containers`
      : `${API_URL}/api/v1/containers`;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: containerName, color: containerColor }),
      });

      let created = null;
      let serverErr = null;
      if (response.ok) {
        try {
          const data = await response.json().catch(() => null);
          created = data?.item || data?.container || data || null;
        } catch (err) {
          created = null;
        }
      } else {
        const text = await response.text().catch(() => null);
        serverErr = text || `Server returned ${response.status}`;
        created = null;
        if (response.status === 401 || (typeof serverErr === 'string' && serverErr.toLowerCase().includes('could not validate'))) {
          serverErr = 'Authentication required — please sign in to persist containers. Container created locally.';
        }
      }

      if (created && created.id) {
        const newContainer = { id: created.id, name: created.name || containerName, color: created.color || containerColor };
        setCreatedContainers(prev => [...prev, newContainer]);
        // Save to localStorage
        localStorage.setItem('createdContainers', JSON.stringify([...createdContainers, newContainer]));
      } else {
        const placeholder = { id: `local-${Date.now()}`, name: containerName, color: containerColor };
        setCreatedContainers(prev => [...prev, placeholder]);
        // Save to localStorage
        localStorage.setItem('createdContainers', JSON.stringify([...createdContainers, placeholder]));
        if (serverErr) {
          setError(serverErr);
        }
      }

      setContainerName('');
      setContainerColor('#f59e0b');
      setShowCreateContainer(false);

      setSuccessMessage('Container created');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message || 'Failed to create container');
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

    // double-clicking a folder in the UI will "open" it and show mock documents inside (since we don't have a real folder structure in the backend yet)
  const handleFolderDoubleClick = (folder) => {
    setOpenedFolder(folder);
    // Generate mock documents for the folder
    const mockDocs = [
      { id: 1, filename: 'Project Plan.pdf', size: '1.2 MB', lastModified: '20 minutes ago', opened: '5 minutes ago', type: 'pdf' },
      { id: 2, filename: 'Meeting Notes.docx', size: '520 KB', lastModified: '32 minutes ago', opened: '5 minutes ago', type: 'doc' },
      { id: 3, filename: 'Design Mockups.pptx', size: '850 KB', lastModified: '23 minutes ago', opened: '3 days ago', type: 'pptx' },
      { id: 4, filename: 'Client Feedback.md', size: '12 KB', lastModified: '1 month ago', opened: '3 days ago', type: 'md' },
      { id: 5, filename: 'Architecture Diagram.svg', size: '83 KB', lastModified: '1 ed. 2 k ago', opened: '3 days ago', type: 'svg' },
      { id: 6, filename: 'Task List.xlsx', size: '83 KB', lastModified: '1 week ago', opened: '2 months ago', type: 'xlsx' },
    ];
    setFolderDocuments(mockDocs);
  };

  const handleBackFromFolder = () => {
    setOpenedFolder(null);
    setFolderDocuments([]);
    setSortBy('lastOpened');
  };

  const handleFolderColorChange = (nextColor) => {
    if (!openedFolder) return;
    setOpenedFolder((prev) => (prev ? { ...prev, color: nextColor } : prev));

    if (isUserCreatedContainer(openedFolder.id)) {
      setCreatedContainers((prev) => {
        const updated = prev.map((container) =>
          container.id === openedFolder.id ? { ...container, color: nextColor } : container
        );
        localStorage.setItem('createdContainers', JSON.stringify(updated));
        return updated;
      });
    } else {
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === openedFolder.id ? { ...ws, color: nextColor } : ws))
      );
    }
  };

  const sortedFolderDocuments = useMemo(() => {
    let sorted = [...folderDocuments];
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case 'size':
        sorted.sort((a, b) => {
          const sizeA = parseInt(a.size);
          const sizeB = parseInt(b.size);
          return sizeB - sizeA;
        });
        break;
      case 'lastModified':
        break;
      case 'lastOpened':
      default:
        break;
    }
    return sorted;
  }, [folderDocuments, sortBy]);


    // Otherwise call backend delete endpoint. Use workspace-scoped path if selectedWorkspace is set
      const handleDeleteContainer = async (containerId) => {
    if (!window.confirm('Delete this container?')) return;

    // If this is a local-only placeholder, just remove it
    if (typeof containerId === 'string' && containerId.startsWith('local-')) {
      setCreatedContainers(prev => prev.filter(c => c.id !== containerId));
      setSuccessMessage('Container deleted');
      setTimeout(() => setSuccessMessage(null), 2500);
      return;
    }

    // Check if this container is in createdContainers (personal container)
    const isPersonalContainer = createdContainers.some(c => c.id === containerId);

    const token = localStorage.getItem('token');
    
    // Build delete URL based on container type
    let deleteUrl;
    if (isPersonalContainer) {
      // Personal container - delete from general endpoint
      deleteUrl = `${API_URL}/api/v1/containers/${containerId}`;
    } else {
      // Workspace container - delete from workspace-scoped endpoint
      deleteUrl = selectedWorkspace
        ? `${API_URL}/api/v1/workspaces/${selectedWorkspace}/containers/${containerId}`
        : `${API_URL}/api/v1/containers/${containerId}`;
    }

    try {
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        setError('Authentication required — please sign in to delete containers.');
        return;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => null);
        setError(text || `Failed to delete container (${response.status})`);
        return;
      }

      // Remove from local created containers if present
      setCreatedContainers(prev => prev.filter(c => c.id !== containerId));
      setSuccessMessage('Container deleted');
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err) {
      setError(err.message || 'Failed to delete container');
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setOwnerFilter('all');
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

  const blockedNames = new Set([
    'component library v2.3.fig',
    'design tokens spec.pdf',
    'accessibility guidelines.docx'
  ]);

  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      const filename = (doc.filename || '').toLowerCase();
      if (blockedNames.has(filename)) return false;
      const matchSearch = filename.includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [documents, searchQuery]);


  const containers = useMemo(() => {
    const palette = ['#93c5fd','#fda4af','#f59e0b','#a78bfa','#f472b6','#60a5fa','#34d399','#fbd38d'];

    let all = [];
    
    // Add workspace containers from API
    if (Array.isArray(workspaces) && workspaces.length > 0) {
      all = workspaces.map((ws, idx) => ({
        id: ws.id,
        name: ws.name || 'Workspace',
        color: ws.color || palette[idx % palette.length],
        type: 'workspace'
      }));
    }

    return all;
  }, [workspaces]);

  const hexToRgba = (hex, alpha) => {
    const h = hex.replace('#','');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const displayedContainers = useMemo(() => {
    // show existing workspace containers first, then user-created containers
    return [...containers, ...createdContainers];
  }, [containers, createdContainers]);

  // Helper function to check if a container is user-created
  const isUserCreatedContainer = (containerId) => {
    return createdContainers.some(c => c.id === containerId);
  };

  // Preset colors used in the pick list
  const presetColors = ['#34d399','#60a5fa','#f472b6','#f59e0b','#a78bfa','#fda4af','#93c5fd','#fb7185'];

  const colorInputRef = useRef(null);

    // RENDER FOLDER VIEW - ADD THIS BEFORE THE MAIN VIEW
  if (openedFolder) {
    return (
      <div className="folder-view-container">
        {/* Folder Header */}
        <div className="folder-header">
          <div className="folder-header-left">
            <button
              className="folder-back"
              onClick={handleBackFromFolder}
              aria-label="Back to documents"
              title="Back to documents"
            >
              Back
            </button>
            <div className="folder-header-icon" style={{ background: openedFolder.color }}>
              <Folder size={28} />
            </div>
            <h1 className="folder-title">{openedFolder.name}</h1>
          </div>
          <div className="folder-header-actions">
            <label className="folder-color-control">
              <span>Color</span>
              <input
                ref={colorInputRef}
                type="color"
                value={openedFolder.color}
                onChange={(e) => handleFolderColorChange(e.target.value)}
                className="folder-color-input"
                aria-label="Pick folder color"
              />
            </label>
            {isUserCreatedContainer(openedFolder.id) && (
              <button
                type="button"
                className="folder-delete-btn"
                onClick={() => {
                  if (window.confirm(`Delete ${openedFolder.name}?`)) {
                    handleDeleteContainer(openedFolder.id);
                    handleBackFromFolder();
                  }
                }}
                aria-label={`Delete ${openedFolder.name}`}
                title="Delete folder"
              >
                <Trash2 size={16} />
                Delete
              </button>
            )}
          </div>
        </div>

        <div className="folder-meta">
          <div className="meta-pill">
            {isUserCreatedContainer(openedFolder.id) ? 'Personal folder' : 'Workspace folder'}
          </div>
          <div className="meta-pill">Items: {folderDocuments.length}</div>
          <div className="meta-pill">Access: Private</div>
        </div>

        {/* Folder Content */}
        <div className="folder-content">
          <div className="folder-top-toolbar">
            <button className="new-document-btn">
              <Plus size={18} />
              New Document
            </button>
            <div className="search-box">
              <Search size={18} />
              <input type="text" placeholder="Search documents..." />
            </div>
            <div className="sort-dropdown-wrapper">
              <button className="sort-button" onClick={() => setShowSortMenu(!showSortMenu)}>
                Sort by
                <ChevronDown size={16} />
              </button>

              {showSortMenu && (
                <div className="sort-menu">
                  <button 
                    className={`sort-option ${sortBy === 'lastOpened' ? 'active' : ''}`}
                    onClick={() => { setSortBy('lastOpened'); setShowSortMenu(false); }}
                  >
                    ✓ Last opened
                  </button>
                  <button 
                    className={`sort-option ${sortBy === 'name' ? 'active' : ''}`}
                    onClick={() => { setSortBy('name'); setShowSortMenu(false); }}
                  >
                    {sortBy === 'name' && '✓ '}Name
                  </button>
                  <button 
                    className={`sort-option ${sortBy === 'size' ? 'active' : ''}`}
                    onClick={() => { setSortBy('size'); setShowSortMenu(false); }}
                  >
                    {sortBy === 'size' && '✓ '}Size
                  </button>
                  <button 
                    className={`sort-option ${sortBy === 'lastModified' ? 'active' : ''}`}
                    onClick={() => { setSortBy('lastModified'); setShowSortMenu(false); }}
                  >
                    {sortBy === 'lastModified' && '✓ '}Date modified
                  </button>
                  {isUserCreatedContainer(openedFolder.id) && (
                    <button 
                      className="sort-option delete-option"
                      onClick={() => {
                        if (window.confirm(`Delete ${openedFolder.name}?`)) {
                          handleDeleteContainer(openedFolder.id);
                          handleBackFromFolder();
                        }
                      }}
                    >
                      <Trash2 size={16} /> Delete Folder
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="folder-main-content">
          {/* Folder Documents List */}
          <main className="folder-main">
            <div className="documents-table">
              <div className="table-header">
                <div className="col-icon"></div>
                <div className="col-name">Name</div>
                <div className="col-size">Size</div>
                <div className="col-modified">Last Modified</div>
                <div className="col-opened">Opened</div>
                <div className="col-actions"></div>
              </div>
              {sortedFolderDocuments.map((doc) => {
                return (
                  <div key={doc.id} className="table-row">
                    <div className="col-icon">
                      <span style={{ fontSize: '1.25rem' }}>📄</span>
                    </div>
                    <div className="col-name">{doc.filename}</div>
                    <div className="col-size">{doc.size}</div>
                    <div className="col-modified">{doc.lastModified}</div>
                    <div className="col-opened">{doc.opened}</div>
                    <div className="col-actions">
                      <button className="action-menu" aria-label="More options">
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pagination">
              <span>1 – 5 of 25</span>
              <div className="pagination-buttons">
                <button disabled>‹</button>
                <button className="active">1</button>
                <button>›</button>
                <button>»</button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
    );
  }

  return (
    <div className="documents-page">
      <div className="documents-shell">
        <aside className="documents-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-card-header">Filter & search</div>
            <div className="documents-controls">
              <div className="controls-left">
                <label className="control-label" htmlFor="owner-filter">
                  Owner Type
                  <select 
                    id="owner-filter"
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value)}
                    aria-label="Filter by owner type"
                  >
                    <option value="all">All Folders</option>
                    <option value="workspace">Workspace-Owned</option>
                    <option value="user">User-Created</option>
                    <option value="ai">AI-Created</option>
                  </select>
                </label>
              </div>

              <div className="search-box">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Search folders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search folders"
                />
              </div>
            </div>
            {(searchQuery || ownerFilter !== 'all') && (
              <div className="filters-actions">
                <button 
                  className="clear-filters-btn"
                  onClick={handleClearFilters}
                  title="Clear all filters"
                  aria-label="Clear all filters"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="sidebar-card sidebar-actions">
            <button
              className="btn btn-secondary create-container-inline"
              onClick={() => setShowCreateContainer(true)}
              title="Create New Container"
              aria-label="Create new container"
            >
              <Plus size={14} />
              <span className="create-inline-text">Create New Container</span>
            </button>

            {showCreateContainer && (
              <div className="create-container-panel" role="region" aria-label="Create container panel">
                <div className="panel-header">
                  <strong>Create New Container</strong>
                  <button className="panel-close" onClick={() => setShowCreateContainer(false)} aria-label="Close">×</button>
                </div>
                {successMessage && (
                  <div className="create-success" role="status" aria-live="polite">{successMessage}</div>
                )}

                <form onSubmit={handleCreateContainer}>
                  <div className="form-group">
                    <label htmlFor="container-name">name...</label>
                    <input
                      id="container-name"
                      type="text"
                      value={containerName}
                      onChange={(e) => setContainerName(e.target.value)}
                      placeholder="Container name"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Pick color</label>
                    <div className="color-swatches">
                      {presetColors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`swatch ${containerColor === color ? 'selected' : ''}`}
                          style={{ background: color }}
                          onClick={() => setContainerColor(color)}
                          aria-label={`Select color ${color}`}
                        />
                      ))}
                      <input
                        type="color"
                        value={containerColor}
                        onChange={(e) => setContainerColor(e.target.value)}
                        className="swatch wheel-input"
                        aria-label="Choose custom color from wheel"
                        title="Click to open color picker"
                      />
                    </div>
                  </div>

                  <div className="panel-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowCreateContainer(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Create</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </aside>

        <main className="documents-main">
          <div className="documents-hero">
            <div className="hero-content">
              <h1>Documents</h1>
              <p>Browse, organize, and manage documents across your workspace.</p>
            </div>
            <div className="hero-actions">
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

      {/* Create Container Dropdown Panel is rendered inline in the sidebar (see sidebar area) */}

      

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

            {/* Containers / Cards Grid (design) */}
      <div className={`container-grid container-grid-${viewMode}`}>
        {displayedContainers.map((c) => {
          const isUserCreated = isUserCreatedContainer(c.id);
          return (
            <div
              key={c.id}
              className={`container-card ${isUserCreated ? 'user-created' : 'default-workspace'}`}
              onClick={() => handleFolderDoubleClick(c)}
              style={{ 
                background: `linear-gradient(90deg, ${hexToRgba(c.color, 0.12)}, ${hexToRgba(c.color, 0.06)})`, 
                borderColor: hexToRgba(c.color, 0.18),
                cursor: 'pointer'
              }}
            >
              <div className="container-left">
                <div className="container-icon" style={{ background: hexToRgba(c.color, 0.18), borderColor: hexToRgba(c.color, 0.28) }}>
                  <Folder size={18} />
                </div>
                <div className="container-wrapper">
                  <div className="container-name">{c.name}</div>
                  {isUserCreated && (
                    <span className="container-badge">Created by you</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

        </main>
      </div>
    </div>
  );
}

export default Documents;
