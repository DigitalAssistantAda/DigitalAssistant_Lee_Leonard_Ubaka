import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Upload, Download, Trash2, Search, Grid3x3, List, X, Plus, Folder, ChevronDown, MoreVertical, Eye } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { getApiErrorMessage } from '../utils/apiError';
import './Documents.css';

function Documents() {
  const navigate = useNavigate();
  const { containerId: containerIdParam } = useParams();
  const [documents, setDocuments] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [dbContainers, setDbContainers] = useState([]);
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
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('lastOpened');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const [uploadFiles, setUploadFiles] = useState([]); // Changed from uploadFile to uploadFiles (array)
  const [uploadProgress, setUploadProgress] = useState({}); // Track progress per file
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewDocument, setPreviewDocument] = useState(null);
  const prevDocStatusesRef = useRef({});   // tracks last-known status per doc id
  const processingPollRef = useRef(null); // holds the polling interval id

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const currentUserId = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const id = parsed?.id ?? parsed?.user_id ?? null;
      return id == null ? null : Number(id);
    } catch {
      return null;
    }
  }, []);

// TXT Preview Component
function TxtPreview({ docId }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    const loadTxt = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          setError('Authentication required');
          setLoading(false);
          return;
        }
        
        const response = await fetch(
          `${API_URL}/api/v1/documents/${docId}/content`,
          {
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `Failed to load file (${response.status})`);
        }

        const text = await response.text();
        setContent(text);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadTxt();
  }, [docId]);

  if (loading) return <div className="preview-loading">Loading...</div>;
  if (error) return <div className="preview-error">{error}</div>;

  return (
    <pre className="txt-preview">
      {content}
    </pre>
  );
}

// DOCX Preview Component
function DocxPreview({ docId }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    const loadDocx = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          setError('Authentication required');
          setLoading(false);
          return;
        }
        
        const response = await fetch(
          `${API_URL}/api/v1/documents/${docId}/content`,
          {
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `Failed to load file (${response.status})`);
        }

        const text = await response.text();
        setContent(text);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadDocx();
  }, [docId]);

  if (loading) return <div className="preview-loading">Loading...</div>;
  if (error) return <div className="preview-error">{error}</div>;

  return (
    <div className="docx-preview">
      {content}
    </div>
  );
}

// PDF Preview Component
// PDF Preview Component
function PdfPreview({ docId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    const loadPdf = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          setError('Authentication required');
          setLoading(false);
          return;
        }

        const response = await fetch(
          `${API_URL}/api/v1/documents/${docId}/preview`,
          {
            headers: { 
              'Authorization': `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to load PDF (${response.status})`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [docId]);

  if (loading) return <div className="preview-loading">Loading PDF...</div>;
  if (error) return <div className="preview-error">{error}</div>;

  return (
    <iframe
      src={pdfUrl}
      className="preview-iframe"
      title="PDF Preview"
      style={{ width: '100%', height: '100%' }}
    />
  );
}

  useEffect(() => {
    fetchWorkspaces();
    fetchContainers();
  }, []);

  // Clean up processing poll on unmount
  useEffect(() => {
    return () => {
      if (processingPollRef.current) clearInterval(processingPollRef.current);
    };
  }, []);

    // Add this useEffect after your other useEffect hooks
  useEffect(() => {
    // Load created containers from localStorage
    const savedContainers = localStorage.getItem('createdContainers');
    if (savedContainers) {
      try {
        const parsed = JSON.parse(savedContainers);
        const normalized = Array.isArray(parsed)
          ? parsed.map((container) => ({
              ...container,
              type: container?.type || 'user',
            }))
          : [];
    setCreatedContainers(normalized);
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
        if (!containerIdParam && items.length > 0 && !selectedWorkspace) {
          setSelectedWorkspace(items[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
      setError('Failed to load workspaces');
    }
  };

  const fetchContainers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/containers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to load containers');
        throw new Error(message);
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      const normalized = items.map((container) => ({
        ...container,
        type: container?.type || null,
      }));
      setDbContainers(normalized);
    } catch (err) {
      setError(err.message || 'Failed to load containers');
    }
  };

  // Compares incoming docs against previously seen statuses.
  // Fires a petal burst near the notification bell for every doc that
  // just transitioned from any non-ready state to 'ready'.
  // Returns true if any doc is still processing/pending (poll should continue).
  const checkAndFireBursts = (newDocs) => {
    let burst = false;
    newDocs.forEach(doc => {
      const prev = prevDocStatusesRef.current[doc.id];
      if (prev && prev !== 'ready' && doc.status === 'ready' && !burst) {
        window.dispatchEvent(
          new CustomEvent('ada:petalburst', {
            detail: { x: window.innerWidth - 80, y: 60, count: 22 },
          })
        );
        burst = true; // one burst per poll tick is enough
      }
      prevDocStatusesRef.current[doc.id] = doc.status;
    });
    return newDocs.some(d => d.status === 'processing' || d.status === 'pending');
  };

  // Polls the workspace document list every 3 s while any doc is processing.
  // Stops automatically once all docs have settled.
  const startProcessingPoll = (workspaceId) => {
    if (processingPollRef.current) clearInterval(processingPollRef.current);
    processingPollRef.current = setInterval(async () => {
      try {
        const items = await fetchDocumentsForWorkspace(workspaceId);
        setDocuments(items);
        const stillProcessing = checkAndFireBursts(items);
        if (!stillProcessing) {
          clearInterval(processingPollRef.current);
          processingPollRef.current = null;
        }
      } catch {
        clearInterval(processingPollRef.current);
        processingPollRef.current = null;
      }
    }, 3000);
  };

  const fetchDocuments = async () => {
    if (!selectedWorkspace) return;
    setLoading(true);
    setError(null);

    try {
      const items = await fetchDocumentsForWorkspace(selectedWorkspace);
      setDocuments(items);
      checkAndFireBursts(items);
      setSelectedDocuments(new Set());
    } catch (err) {
      setError(err.message);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDocumentsForWorkspace = async (workspaceId) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const message = await getApiErrorMessage(response, 'Failed to fetch documents');
      throw new Error(message);
    }

    const data = await response.json();
    return Array.isArray(data?.documents)
      ? data.documents
      : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data)
      ? data
      : [];
  };

  const fetchDocumentsForContainer = async (containerId) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/v1/containers/${containerId}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const message = await getApiErrorMessage(response, 'Failed to fetch container documents');
      throw new Error(message);
    }

    const data = await response.json();
    return Array.isArray(data?.documents)
      ? data.documents
      : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data)
      ? data
      : [];
  };

  const handleFileUpload = async (e) => {
  e.preventDefault();
  const targetWorkspaceId = openedFolder?.workspace_id || selectedWorkspace;
  if (uploadFiles.length === 0 || !targetWorkspaceId) return;

  setUploading(true);
  setError(null);

  try {
    const token = localStorage.getItem('token');
    const uploadPromises = uploadFiles.map(async (file, index) => {
      try {
        const formData = new FormData();
        formData.append('file', file);
        if (openedFolder?.id) {
          formData.append('container_id', String(openedFolder.id));
        }

        const response = await fetch(
          `${API_URL}/api/v1/workspaces/${targetWorkspaceId}/documents`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          }
        );

        if (!response.ok) {
          const message = await getApiErrorMessage(response, `Failed to upload ${file.name}`);
          throw new Error(message);
        }

        // Update progress for this file
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: 100
        }));

        return response.json();
      } catch (err) {
        setError(`Error uploading ${file.name}: ${err.message}`);
        return null;
      }
    });

        await Promise.all(uploadPromises);
    setUploadFiles([]);
    setUploadProgress({});
    setShowUploadModal(false);
    setSuccessMessage('Files uploaded successfully to workspace folder');
    setTimeout(() => setSuccessMessage(null), 3000);
    // Celebrate upload completion with a petal burst near the notification bell
    window.dispatchEvent(
      new CustomEvent('ada:petalburst', {
        detail: {
          x: window.innerWidth - 80,
          y: 60,
          count: 22,
        },
      })
    );

    // Poll until all just-uploaded docs finish processing, then burst again
    const wsId = openedFolder?.workspace_id || selectedWorkspace;
    if (wsId) startProcessingPoll(wsId);

    // Only refresh the folder view if the user has it open
    if (openedFolder?.id) {
      try {
        const items = await fetchDocumentsForContainer(openedFolder.id);
        setFolderDocuments(items);
      } catch (err) {
        console.error('Error refreshing folder:', err);
      }
    }
    // DO NOT call fetchDocuments() - this prevents files from appearing in main list
  } catch (err) {
    setError(err.message);
  } finally {
    setUploading(false);
  }
};


  // Drag and drop handlers - UPDATED
const handleDragEnter = (e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragging(true);
  // Float a few petals upward from the drop zone
  window.dispatchEvent(
    new CustomEvent('ada:petalfloat', {
      detail: { x: e.clientX, y: e.clientY, count: 8 },
    })
  );
};

const handleDragLeave = (e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragging(false);
};

const handleDragOver = (e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragging(true);
};

const handleDrop = (e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragging(false);
  // Celebrate the drop with a petal burst
  window.dispatchEvent(
    new CustomEvent('ada:petalburst', {
      detail: { x: e.clientX, y: e.clientY, count: 28 },
    })
  );

  const items = e.dataTransfer.items;
  const files = [];

  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
  } else {
    const fileList = e.dataTransfer.files;
    for (let i = 0; i < fileList.length; i++) {
      files.push(fileList[i]);
    }
  }

  const combined = [...uploadFiles, ...files];
  if (combined.length > 5) {
    setError('You can only upload a maximum of 5 documents at once');
    setUploadFiles(combined.slice(0, 5));
  } else {
    setError(null);
    setUploadFiles(combined);
  }
};

const handleFileInputClick = () => {
  fileInputRef.current?.click();
};

const handleCreateContainer = async (e) => {
  e.preventDefault();
  if (!containerName) {
    setError('Please enter a container name');
    return;
  }

  const createUrl = `${API_URL}/api/v1/containers`;
  const scopedWorkspaceId = openedFolder?.workspace_id || null;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: containerName,
        color: containerColor,
        workspace_id: scopedWorkspaceId ? Number(scopedWorkspaceId) : null,
      }),
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
      const rawType = String(created?.type || created?.owner_type || created?.created_by_type || 'user').toLowerCase();
      const normalizedType = rawType.includes('ai') ? 'ai' : rawType.includes('workspace') ? 'workspace' : 'user';
      const newContainer = {
        id: created.id,
        name: created.name || containerName,
        color: created.color || containerColor,
        workspace_id: created.workspace_id ?? (scopedWorkspaceId ? Number(scopedWorkspaceId) : null),
        created_by: created.created_by,
        created_at: created.created_at,
        type: normalizedType,
      };
      setDbContainers(prev => [...prev, newContainer]);
      setCreatedContainers(prev => [...prev, newContainer]);
      // Save to localStorage
      localStorage.setItem('createdContainers', JSON.stringify([...createdContainers, newContainer]));
    } else {
      const placeholder = { id: `local-${Date.now()}`, name: containerName, color: containerColor, type: 'user' };
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

  const handleRequestDeletion = async (docId, docFilename) => {
  const reason = prompt(`Request deletion of "${docFilename}"?\n\nOptional: Add a reason for the request:`, '');
  
  if (reason === null) return; // User cancelled
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(
      `${API_URL}/api/v1/documents/${docId}/deletion-request?reason=${encodeURIComponent(reason || '')}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to request deletion');
    }

    setSuccessMessage(`Deletion request sent to document owner`);
    setTimeout(() => setSuccessMessage(null), 3000);
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

  // Open folder and load actual documents for this workspace
  const handleFolderDoubleClick = (folder) => {
    navigate(`/documents/${folder.id}`);
  };

  const handleBackFromFolder = () => {
    setOpenedFolder(null);
    setFolderDocuments([]);
    setFolderSearchQuery('');
    setSelectedDocuments(new Set());
    setSortBy('lastOpened');
    navigate('/documents');
  };

  const handleWorkspaceSelect = (value) => {
    const nextWorkspaceId = Number(value);
    if (!Number.isFinite(nextWorkspaceId) || nextWorkspaceId <= 0) {
      setSelectedWorkspace('');
      return;
    }

    setSelectedWorkspace(nextWorkspaceId);
  };

  // ADD THESE TWO FUNCTIONS HERE:
  const handleDeleteFolderDocument = async (docId) => {
    if (!window.confirm('Delete this document?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        setError('Authentication required — please sign in to delete documents.');
        return;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Delete failed');
        throw new Error(errorText || `Failed to delete (${response.status})`);
      }

      // Remove from folder documents list
      setFolderDocuments(prev => prev.filter(doc => doc.id !== docId));
      setError(null);
      setSuccessMessage('Document deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Delete error:', err);
      setError(`Failed to delete document: ${err.message}`);
    }
  };

  const handleBulkDeleteFolderDocuments = async () => {
    if (selectedDocuments.size === 0) return;
    const count = selectedDocuments.size;
    if (!window.confirm(`Delete ${count} document${count > 1 ? 's' : ''}?`)) return;

    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const deletionResults = await Promise.allSettled(
        Array.from(selectedDocuments).map(docId =>
          fetch(`${API_URL}/api/v1/documents/${docId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).then(response => {
            if (!response.ok) throw new Error(`Failed to delete document ${docId}`);
            return response;
          })
        )
      );

      const failed = deletionResults.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        setError(`Failed to delete ${failed.length} document${failed.length > 1 ? 's' : ''}`);
        return;
      }

      setFolderDocuments(prev => 
        prev.filter(doc => !selectedDocuments.has(doc.id))
      );
      setSelectedDocuments(new Set());
      setSuccessMessage(`${count} document${count > 1 ? 's' : ''} deleted successfully`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Bulk delete error:', err);
      setError(`Failed to delete documents: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFolderColorChange = (nextColor) => {
    if (!openedFolder) return;
    setOpenedFolder((prev) => (prev ? { ...prev, color: nextColor } : prev));

    setDbContainers((prev) =>
      prev.map((container) =>
        Number(container.id) === Number(openedFolder.id)
          ? { ...container, color: nextColor }
          : container
      )
    );

    setCreatedContainers((prev) => {
      const updated = prev.map((container) =>
        Number(container.id) === Number(openedFolder.id)
          ? { ...container, color: nextColor }
          : container
      );
      localStorage.setItem('createdContainers', JSON.stringify(updated));
      return updated;
    });
  };

  const sortedFolderDocuments = useMemo(() => {
    const normalizedQuery = folderSearchQuery.trim().toLowerCase();
    let sorted = folderDocuments.filter((document) => {
      const filename = String(document?.filename || '').toLowerCase();
      return !normalizedQuery || filename.includes(normalizedQuery);
    });
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
  }, [folderDocuments, sortBy, folderSearchQuery]);


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

    const container = dbContainers.find((entry) => Number(entry.id) === Number(containerId));

    const token = localStorage.getItem('token');
    
    // Build delete URL based on container type
    let deleteUrl;
    if (!container?.workspace_id) {
      // Personal container - delete from general endpoint
      deleteUrl = `${API_URL}/api/v1/containers/${containerId}`;
    } else {
      // Workspace container - delete from workspace-scoped endpoint
      deleteUrl = container.workspace_id
        ? `${API_URL}/api/v1/workspaces/${container.workspace_id}/containers/${containerId}`
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
      setDbContainers(prev => prev.filter(c => Number(c.id) !== Number(containerId)));
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

  const handleClearUploadForm = () => {
    setUploadFiles([]);
    setUploadProgress({});
    setError(null);
  };

  const handleDocumentDoubleClick = (doc) => {
    setPreviewDocument(doc);
    setShowPreviewModal(true);
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

    return (Array.isArray(dbContainers) ? dbContainers : []).map((container, idx) => ({
      ...container,
      color: container.color || palette[idx % palette.length],
      type: container.type || (container.workspace_id ? 'workspace' : 'user'),
    }));
  }, [dbContainers]);

  const hexToRgba = (hex, alpha) => {
    const h = hex.replace('#','');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const displayedContainers = useMemo(() => {
    const localOnly = createdContainers.filter((container) => typeof container.id === 'string' && container.id.startsWith('local-'));
    return [...containers, ...localOnly];
  }, [containers, createdContainers]);

  const filteredDisplayedContainers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const isWorkspaceDefaultContainer = (container) => {
      if (!container?.workspace_id) return false;
      const workspace = workspaces.find((item) => Number(item.id) === Number(container.workspace_id));
      if (!workspace) return false;
      return String(container?.name || '').trim().toLowerCase() === String(workspace?.name || '').trim().toLowerCase();
    };

    const getOwnershipType = (container) => {
      const rawType = String(container?.type || '').toLowerCase();
      if (rawType.includes('ai')) return 'ai';
      if (isWorkspaceDefaultContainer(container)) return 'workspace';
      if (currentUserId != null && Number(container?.created_by) === Number(currentUserId)) return 'user';
      return 'workspace';
    };

    return displayedContainers.filter((container) => {
      const type = getOwnershipType(container);
      const name = String(container?.name || '').toLowerCase();

      const matchesOwner =
        ownerFilter === 'all' ||
        (ownerFilter === 'workspace' && type === 'workspace') ||
        (ownerFilter === 'user' && type === 'user') ||
        (ownerFilter === 'ai' && type === 'ai');

      const matchesSearch = !normalizedQuery || name.includes(normalizedQuery);

      return matchesOwner && matchesSearch;
    });
  }, [displayedContainers, ownerFilter, searchQuery, currentUserId, workspaces]);

  useEffect(() => {
    if (!containerIdParam) {
      setOpenedFolder(null);
      setFolderDocuments([]);
      return;
    }

    const parsedContainerId = Number(containerIdParam);
    if (!Number.isFinite(parsedContainerId) || parsedContainerId <= 0) {
      return;
    }

    const routeContainer = displayedContainers.find(
      (container) => Number(container.id) === parsedContainerId
    );

    if (!routeContainer) {
      return;
    }

    setOpenedFolder(routeContainer);
    setSelectedWorkspace(routeContainer.workspace_id || '');
    setSelectedDocuments(new Set());
    setError(null);

    let isMounted = true;
    fetchDocumentsForContainer(parsedContainerId)
      .then((containerDocs) => {
        if (isMounted) {
          setFolderDocuments(containerDocs);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Failed to load folder documents');
          setFolderDocuments([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [containerIdParam, displayedContainers]);

  // Helper function to check if a container is user-created
  const isUserCreatedContainer = (containerId) => {
    return displayedContainers.some((container) => {
      const sameId = String(container.id) === String(containerId);
      const workspace = workspaces.find((item) => Number(item.id) === Number(container.workspace_id));
      const isWorkspaceDefault =
        container?.workspace_id &&
        workspace &&
        String(container?.name || '').trim().toLowerCase() === String(workspace?.name || '').trim().toLowerCase();
      const isOwnedByCurrentUser =
        currentUserId != null && Number(container?.created_by) === Number(currentUserId);
      return sameId && isOwnedByCurrentUser && !isWorkspaceDefault;
    });
  };

  const getContainerCreatorLabel = (container) => {
    const rawType = String(container?.type || '').toLowerCase();
    const workspace = workspaces.find((item) => Number(item.id) === Number(container.workspace_id));
    const isWorkspaceDefault =
      container?.workspace_id &&
      workspace &&
      String(container?.name || '').trim().toLowerCase() === String(workspace?.name || '').trim().toLowerCase();
    if (rawType.includes('ai')) return 'Created by AI';
    if (isWorkspaceDefault) return 'Belongs to workspace';
    if (currentUserId != null && Number(container?.created_by) === Number(currentUserId)) {
      return 'Created by you';
    }
    return 'Belongs to workspace';
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
            <div
              className="folder-header-icon folder-color-trigger"
              style={{ background: openedFolder.color }}
              role="button"
              tabIndex={0}
              title="Change folder color"
              aria-label="Change folder color"
              onClick={() => colorInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  colorInputRef.current?.click();
                }
              }}
            >
              <Folder size={28} />
              <input
                ref={colorInputRef}
                type="color"
                value={openedFolder.color}
                onChange={(e) => handleFolderColorChange(e.target.value)}
                className="folder-color-input-hidden"
                aria-label="Pick folder color"
              />
            </div>
            <h1 className="folder-title">{openedFolder.name}</h1>
          </div>
          <div className="folder-header-actions">
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
          {selectedDocuments.size > 0 && (
            <div className="bulk-actions-bar folder-bulk-actions">
                <span>{selectedDocuments.size} selected</span>
                <button 
                  className="action-btn delete-btn"
                  onClick={handleBulkDeleteFolderDocuments}
                  title={`Delete ${selectedDocuments.size} document${selectedDocuments.size > 1 ? 's' : ''}`}
                >
                  <Trash2 size={18} />
                  Delete
                </button>
            </div>
          )}

          <div className="folder-top-toolbar">
            <button
              className="new-document-btn"
              onClick={() => {
                setSelectedWorkspace(Number(openedFolder.workspace_id || ''));
                setShowUploadModal(true);
              }}
            >
              <Plus size={18} />
              New Document
            </button>
            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                placeholder="Search documents..."
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
              />
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
                  <div
                    key={doc.id}
                    className={`table-row ${selectedDocuments.has(doc.id) ? 'is-selected' : ''}`}
                    onClick={() => handleCheckboxChange(doc.id)}
                  >
                    <div className="col-icon">
                      <input 
                        type="checkbox"
                        checked={selectedDocuments.has(doc.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => handleCheckboxChange(doc.id)}
                        title="Select document"
                        aria-label={`Select ${doc.filename}`}
                      />
                    </div>
                    <div className="col-name">{doc.filename}</div>
                    <div className="col-size">{doc.size_bytes ? `${(doc.size_bytes / 1024 / 1024).toFixed(2)} MB` : doc.size || '-'}</div>
                    <div className="col-modified">{new Date(doc.created_at).toLocaleDateString()}</div>
                    <div className="col-opened">{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '-'}</div>
                                        <div className="col-actions">
                      <button
                        className="action-menu"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDocumentDoubleClick(doc);
                        }}
                        title="Preview document"
                        aria-label={`Preview ${doc.filename}`}
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        className="action-menu"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownloadDocument(doc.id, doc.filename);
                        }}
                        title="Download document"
                        aria-label={`Download ${doc.filename}`}
                      >
                        <Download size={18} />
                      </button>
                      {doc.uploaded_by === currentUserId ? (
                        <button 
                          className="action-menu delete-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteFolderDocument(doc.id);
                          }}
                          title="Delete document"
                          aria-label={`Delete ${doc.filename}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      ) : (
                        <button 
                          className="action-menu request-deletion-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRequestDeletion(doc.id, doc.filename);
                          }}
                          title="Request deletion from owner"
                          aria-label={`Request deletion of ${doc.filename}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pagination">
              <span>
                {sortedFolderDocuments.length > 0
                  ? `1 - ${sortedFolderDocuments.length} of ${sortedFolderDocuments.length}`
                  : '0 of 0'}
              </span>
              <div className="pagination-buttons">
                <button disabled>‹</button>
                <button className="active">1</button>
                <button>›</button>
                <button>»</button>
              </div>
            </div>
          </main>
        </div>

        {showUploadModal && (
          <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Upload Document</h2>
                <button
                  className="modal-close"
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadFiles([]);
                    setUploadProgress({});
                    setError(null);
                  }}
                  title="Close dialog"
                  aria-label="Close dialog"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleFileUpload}>
                <div className="form-group">
                  <label htmlFor="workspace-name-locked">Workspace</label>
                  <input
                    id="workspace-name-locked"
                    type="text"
                    value={openedFolder?.name || ''}
                    disabled
                  />
                </div>

                {error && (
                  <div className="error-message" style={{ marginBottom: '1rem' }}>
                    <span>{error}</span>
                    <button 
                      type="button"
                      className="close-error"
                      onClick={(e) => {
                        e.preventDefault();
                        setError(null);
                      }}
                      aria-label="Close error message"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="folder-file-input">File</label>
                  <div
                    className={`file-upload-area ${isDragging ? 'dragging' : ''}`}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={handleFileInputClick}
                  >
                    <Upload size={24} />
                    <p className="upload-text">
                      {isDragging ? 'Drop file here' : 'Click to browse or drag and drop'}
                    </p>
                    <p className="upload-hint">PDF, TXT, DOCX, DOC (max 50MB)</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      id="folder-file-input"
                      onChange={(e) => {
                        const newFiles = Array.from(e.target.files);
                        const combined = [...uploadFiles, ...newFiles];
                        if (combined.length > 5) {
                          setError('You can only upload a maximum of 5 documents at once');
                          setUploadFiles(combined.slice(0, 5));
                        } else {
                          setError(null);
                          setUploadFiles(combined);
                        }
                      }}
                      accept=".pdf,.txt,.docx,.doc"
                      multiple
                      style={{ display: 'none' }}
                      required={uploadFiles.length === 0}
                  />
                </div>
                  {uploadFiles.length > 0 && (
                    <div className="selected-files">
                      <div className="selected-files-header">
                        <h4>Selected Files ({uploadFiles.length}/5):</h4>
                        {uploadFiles.length === 5 && (
                          <span className="limit-reached-badge">Limit reached</span>
                        )}
                      </div>
                      <ul>
                        {uploadFiles.map((file, idx) => (
                          <li key={idx} className="file-item">
                            <span>{file.name}</span>
                            <span className="file-size">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                            <button
                              type="button"
                              className="remove-file-btn"
                              onClick={() => {
                                const newFiles = uploadFiles.filter((_, i) => i !== idx);
                                setUploadFiles(newFiles);
                              }}
                              title="Remove file"
                              aria-label={`Remove ${file.name}`}
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="folder-tags-input">Tags (coming soon)</label>
                  <input
                    id="folder-tags-input"
                    type="text"
                    placeholder="Tag persistence is not enabled yet"
                    disabled
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
                    disabled={uploadFiles.length === 0 || !selectedWorkspace || uploading}
                  >
                    {uploading ? `Uploading ${Object.values(uploadProgress).filter(p => p === 100).length}/${uploadFiles.length}...` : `Upload (${uploadFiles.length}/5)`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* Document Preview Modal */}
        {showPreviewModal && previewDocument && (
          <div className="modal-overlay" onClick={() => setShowPreviewModal(false)}>
            <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
              <div className="preview-header">
                <h2>{previewDocument.filename}</h2>
                <button
                  className="modal-close"
                  onClick={() => setShowPreviewModal(false)}
                  aria-label="Close preview"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="preview-content">
                {previewDocument.filename.toLowerCase().endsWith('.pdf') ? (
                  <PdfPreview docId={previewDocument.id} />
                ) : previewDocument.filename.toLowerCase().endsWith('.txt') ? (
                  <TxtPreview docId={previewDocument.id} />
                ) : previewDocument.filename.toLowerCase().endsWith('.docx') ? (
                  <DocxPreview docId={previewDocument.id} />
                ) : (
                  <div className="preview-text-wrapper">
                    <p className="preview-placeholder">
                      Preview not available for this file type
                    </p>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleDownloadDocument(previewDocument.id, previewDocument.filename)}
                    >
                      <Download size={18} />
                      Download to view
                    </button>
                  </div>
                )}
              </div>

              <div className="preview-footer">
                <span>{(previewDocument.size_bytes / 1024 / 1024).toFixed(2)} MB</span>
                <span>{new Date(previewDocument.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        )}
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
                <p className="create-container-note">
                  New containers are personal by default. They become workspace-scoped only when created inside a workspace folder.
                </p>
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
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadFiles([]);
                  setUploadProgress({});
                  setError(null);
                }}
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
                  onChange={(e) => handleWorkspaceSelect(e.target.value)}
                  required
                >
                  <option value="">Select workspace</option>
                  {workspaces.map(ws => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="error-message" style={{ marginBottom: '1rem' }}>
                  <span>{error}</span>
                  <button 
                    type="button"
                    className="close-error"
                    onClick={(e) => {
                      e.preventDefault();
                      setError(null);
                    }}
                    aria-label="Close error message"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="file-input">File</label>
                <div 
                  className={`file-upload-area ${isDragging ? 'dragging' : ''}`}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={handleFileInputClick}
                >
                  <Upload size={24} />
                  <p className="upload-text">
                    {isDragging ? 'Drop file here' : 'Click to browse or drag and drop'}
                  </p>
                  <p className="upload-hint">PDF, TXT, DOCX, DOC (max 50MB)</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="file-input"
                    onChange={(e) => {
                      const newFiles = Array.from(e.target.files);
                      const combined = [...uploadFiles, ...newFiles];
                      if (combined.length > 5) {
                        setError('You can only upload a maximum of 5 documents at once');
                        setUploadFiles(combined.slice(0, 5));
                      } else {
                        setError(null);
                        setUploadFiles(combined);
                      }
                    }}
                    accept=".pdf,.txt,.docx,.doc"
                    multiple
                    style={{ display: 'none' }}
                    required={uploadFiles.length === 0}
                                      />
                  </div>

                  {uploadFiles.length > 0 && (
                    <div className="selected-files">
                      <div className="selected-files-header">
                        <h4>Selected Files ({uploadFiles.length}/5):</h4>
                        {uploadFiles.length === 5 && (
                          <span className="limit-reached-badge">Limit reached</span>
                        )}
                      </div>
                      <ul>
                        {uploadFiles.map((file, idx) => (
                          <li key={idx} className="file-item">
                            <span>{file.name}</span>
                            <span className="file-size">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                            <button
                              type="button"
                              className="remove-file-btn"
                              onClick={() => {
                                const newFiles = uploadFiles.filter((_, i) => i !== idx);
                                setUploadFiles(newFiles);
                              }}
                              title="Remove file"
                              aria-label={`Remove ${file.name}`}
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="folder-tags-input">Tags (coming soon)</label>
                <input 
                  id="tags-input"
                  type="text" 
                  placeholder="Tag persistence is not enabled yet"
                  disabled
                />
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowUploadModal(false);
                  }}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={uploadFiles.length === 0 || !selectedWorkspace || uploading}
                >
                  {uploading ? `Uploading ${Object.values(uploadProgress).filter(p => p === 100).length}/${uploadFiles.length}...` : `Upload (${uploadFiles.length}/5)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Container Dropdown Panel is rendered inline in the sidebar (see sidebar area) */}

      
            {/* Containers / Cards Grid (design) */}
      <div className={`container-grid container-grid-${viewMode}`}>
              {filteredDisplayedContainers.map((c) => {
          const isUserCreated = isUserCreatedContainer(c.id);
          return (
            <div
              key={c.id}
              className={`container-card ${isUserCreated ? 'user-created' : 'default-workspace'}`}
              onClick={() => handleFolderDoubleClick(c)}
              style={{ 
                background: `linear-gradient(90deg, ${hexToRgba(c.color, 0.06)}, ${hexToRgba(c.color, 0.03)})`, 
                borderColor: hexToRgba(c.color, 0.12),
                cursor: 'pointer'
              }}
            >
              <div className="container-left">
                <div className="container-icon" style={{ background: hexToRgba(c.color, 0.18), borderColor: hexToRgba(c.color, 0.28) }}>
                  <Folder size={18} />
                </div>
                <div className="container-wrapper">
                  <div className="container-name">{c.name}</div>
                  <span className="container-origin">{getContainerCreatorLabel(c)}</span>
                </div>
              </div>
              {isUserCreated && (
                <button
                  type="button"
                  className="container-delete-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeleteContainer(c.id);
                  }}
                  aria-label={`Delete ${c.name}`}
                  title="Delete folder"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
        {filteredDisplayedContainers.length === 0 && (
          <p className="empty-state-text">No folders match your current filters.</p>
        )}
      </div>

        </main>
      </div>
    </div>
  );
}

export default Documents;
