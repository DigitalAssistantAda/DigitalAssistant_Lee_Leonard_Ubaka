import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Download, Trash2, Search, Grid3x3, List, X, Plus, Folder, FolderPlus, ChevronDown, ChevronRight, GripVertical, MoreVertical, Eye, RotateCcw, Check, Sparkles } from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import AccessState from '../components/AccessState';
import ColorSwatchPicker from '../components/ColorSwatchPicker';
import LoadingState from '../components/LoadingState';
import TxtPreview from '../components/document-previews/TxtPreview';
import DocxPreview from '../components/document-previews/DocxPreview';
import PdfPreview from '../components/document-previews/PdfPreview';
import { getApiErrorMessage, isWorkspaceAccessErrorMessage } from '../utils/apiError';
import { CONTAINER_SWATCH_PRESETS } from '../utils/colorPresets';
import { normalizeItems } from '../utils/listUtils';
import { apiFetch } from '../utils/apiClient';
import './Documents.css';

function Documents({ currentUser }) {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [createContainerParentId, setCreateContainerParentId] = useState(null);
  const [containerName, setContainerName] = useState('');
  const [containerColor, setContainerColor] = useState('#f59e0b');
  const [createdContainers, setCreatedContainers] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list');
  const [selectedDocuments, setSelectedDocuments] = useState(new Set());
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  const [openedFolder, setOpenedFolder] = useState(null);
  const [folderDocuments, setFolderDocuments] = useState([]);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('lastOpened');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const workspaceContainerFetchRef = useRef(new Set());
  const [uploadFiles, setUploadFiles] = useState([]); // Changed from uploadFile to uploadFiles (array)
  const [uploadProgress, setUploadProgress] = useState({}); // Track progress per file
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewDocument, setPreviewDocument] = useState(null);
  const processingPollRef = useRef(null); // holds the polling interval id
  const [suggestionsByDoc, setSuggestionsByDoc] = useState({});
  const [suggestingDocIds, setSuggestingDocIds] = useState(new Set());
  const [applyingSuggestionIds, setApplyingSuggestionIds] = useState(new Set());
  const [autoOrganizing, setAutoOrganizing] = useState(false);
  const [autoOrganizeReport, setAutoOrganizeReport] = useState(null);
  const [draggedContainerId, setDraggedContainerId] = useState(null);
  const [dropTargetContainerId, setDropTargetContainerId] = useState(null);
  const [collapsedContainerIds, setCollapsedContainerIds] = useState(new Set());
  const [retryingDocIds, setRetryingDocIds] = useState(new Set());
  const [moveTargetSubfolderId, setMoveTargetSubfolderId] = useState('');
  const [movingDocuments, setMovingDocuments] = useState(false);

  const FOLDER_COLUMNS_KEY = 'documentsFolderVisibleColumns';
  const defaultVisibleColumns = { name: true, size: true, status: true, lastModified: true, dateCreated: true, owner: true };
  const [openDocMenuId, setOpenDocMenuId] = useState(null);
  const [docMenuPosition, setDocMenuPosition] = useState(null);
  const docMenuRef = useRef(null);
  const docMenuPortalRef = useRef(null);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem(FOLDER_COLUMNS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultVisibleColumns, ...parsed };
      }
    } catch (_) {}
    return { ...defaultVisibleColumns };
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [showFolderOptionsMenu, setShowFolderOptionsMenu] = useState(false);
  const folderOptionsMenuRef = useRef(null);

  const toggleColumn = (key) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(FOLDER_COLUMNS_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  const folderTableColumnConfig = useMemo(() => {
    const config = [
      { key: 'icon', width: '40px', always: true },
      { key: 'name', width: '1.5fr', label: 'Name', always: false },
      { key: 'size', width: '100px', label: 'Size', always: false },
      { key: 'status', width: '140px', label: 'Status', always: false },
      { key: 'lastModified', width: '120px', label: 'Last modified', always: false },
      { key: 'dateCreated', width: '120px', label: 'Date created', always: false },
      { key: 'owner', width: '100px', label: 'Owner', always: false },
      { key: 'actions', width: '44px', always: true },
    ];
    return config.filter((c) => c.always || visibleColumns[c.key]);
  }, [visibleColumns]);

  const folderTableGridStyle = useMemo(
    () => ({ gridTemplateColumns: folderTableColumnConfig.map((c) => c.width).join(' ') }),
    [folderTableColumnConfig]
  );

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const workspaceIdFromQuery = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    const value = Number(params.get('workspaceId'));
    return Number.isFinite(value) && value > 0 ? String(value) : '';
  }, [location.search]);

  const currentUserId = useMemo(() => {
    const value = Number(currentUser?.id ?? currentUser?.user_id ?? NaN);
    return Number.isFinite(value) ? value : null;
  }, [currentUser]);

  const normalizeHexColor = (value, fallback = '#93c5fd') => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    const raw = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
      const expanded = raw.split('').map((ch) => `${ch}${ch}`).join('');
      return `#${expanded.toLowerCase()}`;
    }

    if (/^[0-9a-fA-F]{6}$/.test(raw)) {
      return `#${raw.toLowerCase()}`;
    }

    return fallback;
  };

  const getDocumentSizeBytes = (doc) => {
    const fromBytes = Number(doc?.size_bytes);
    if (Number.isFinite(fromBytes) && fromBytes >= 0) {
      return fromBytes;
    }

    const rawSize = String(doc?.size || '').trim();
    if (!rawSize) return null;

    const plainNumber = Number(rawSize);
    if (Number.isFinite(plainNumber) && plainNumber >= 0) {
      return plainNumber;
    }

    const match = rawSize.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
    if (!match) return null;

    const value = Number(match[1]);
    const unit = String(match[2] || 'B').toUpperCase();
    if (!Number.isFinite(value) || value < 0) return null;

    const multipliers = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };

    return Math.round(value * (multipliers[unit] || 1));
  };

  const formatBytes = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '-';
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

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

  useEffect(() => {
    if (!showFolderOptionsMenu) return;
    const handleClickOutside = (e) => {
      if (folderOptionsMenuRef.current && !folderOptionsMenuRef.current.contains(e.target)) {
        setShowFolderOptionsMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  }, [showFolderOptionsMenu]);

  useLayoutEffect(() => {
    if (openDocMenuId == null) {
      setDocMenuPosition(null);
      return;
    }
    const el = docMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDocMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [openDocMenuId]);

  useEffect(() => {
    if (openDocMenuId == null) return;
    const handleClickOutside = (e) => {
      const inTrigger = docMenuRef.current?.contains(e.target);
      const inMenu = docMenuPortalRef.current?.contains(e.target);
      if (!inTrigger && !inMenu) setOpenDocMenuId(null);
    };
    const handleScroll = () => setOpenDocMenuId(null);
    document.addEventListener('click', handleClickOutside, true);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [openDocMenuId]);

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
      const data = await apiFetch('/api/v1/workspaces');
      const items = normalizeItems(data);
      setWorkspaces(items);
      const queryWorkspaceExists = workspaceIdFromQuery && items.some((item) => Number(item.id) === Number(workspaceIdFromQuery));
      if (!containerIdParam && workspaceIdFromQuery && !queryWorkspaceExists) {
        setSelectedWorkspace('');
        setError('Workspace not found or you do not have access.');
        return;
      }
      if (!containerIdParam && queryWorkspaceExists) {
        setSelectedWorkspace(workspaceIdFromQuery);
        return;
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
      setError('Failed to load workspaces');
    }
  };

  useEffect(() => {
    if (!workspaceIdFromQuery || !workspaces.length || containerIdParam) return;
    const exists = workspaces.some((item) => Number(item.id) === Number(workspaceIdFromQuery));
    if (!exists) return;
    if (Number(selectedWorkspace) === Number(workspaceIdFromQuery)) return;
    setSelectedWorkspace(workspaceIdFromQuery);
  }, [workspaceIdFromQuery, workspaces, selectedWorkspace, containerIdParam]);

  const fetchContainers = async () => {
    try {
      const data = await apiFetch('/api/v1/containers');
      const items = normalizeItems(data);
      const normalized = items.map((container) => ({
        ...container,
        type: container?.type || null,
      }));
      setDbContainers(normalized);
    } catch (err) {
      setError(err?.message || 'Failed to load containers');
    }
  };

  // Returns true if any doc is still processing/pending (poll should continue).
  const hasProcessingDocuments = (newDocs) => {
    return newDocs.some((doc) => doc.status === 'processing' || doc.status === 'pending');
  };

  const getDocumentStatusDisplay = (doc) => {
    const rawStatus = String(doc?.status || 'uploaded').toLowerCase();
    const statusDetail = String(doc?.status_detail || '').trim();

    if (rawStatus === 'ready') {
      return {
        label: doc?.status_label || 'Ready',
        statusKey: 'ready',
        detail: statusDetail || '',
      };
    }

    if (rawStatus === 'processing' || rawStatus === 'pending') {
      return {
        label: doc?.status_label || 'Processing',
        statusKey: 'processing',
        detail: statusDetail || '',
      };
    }

    if (rawStatus === 'failed') {
      return {
        label: doc?.status_label || 'Failed',
        statusKey: 'failed',
        detail: statusDetail || 'Document processing failed.',
      };
    }

    return {
      label: doc?.status_label || 'Uploaded',
      statusKey: 'uploaded',
      detail: statusDetail || '',
    };
  };

  // Polls the workspace document list every 3 s while any doc is processing.
  // Stops automatically once all docs have settled.
  const startProcessingPoll = (workspaceId) => {
    if (processingPollRef.current) clearInterval(processingPollRef.current);
    processingPollRef.current = setInterval(async () => {
      try {
        const items = await fetchDocumentsForWorkspace(workspaceId);
        setDocuments(items);
        const stillProcessing = hasProcessingDocuments(items);
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
      hasProcessingDocuments(items);
      setSelectedDocuments(new Set());
    } catch (err) {
      setError(err.message);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDocumentsForWorkspace = async (workspaceId) => {
    const data = await apiFetch(`/api/v1/workspaces/${workspaceId}/documents`);
    const raw = data?.documents ?? data?.items ?? data;
    return Array.isArray(raw) ? raw : [];
  };

  const fetchDocumentsForContainer = async (containerId) => {
    const data = await apiFetch(`/api/v1/containers/${containerId}/documents`);
    const raw = data?.documents ?? data?.items ?? data;
    return Array.isArray(raw) ? raw : [];
  };

  useEffect(() => {
    const refreshVisibleDocuments = () => {
      if (openedFolder?.id) {
        fetchDocumentsForContainer(openedFolder.id)
          .then((items) => {
            setFolderDocuments(items);
          })
          .catch((err) => {
            setError(err.message || 'Failed to refresh folder documents');
          });
        return;
      }

      if (selectedWorkspace || workspaceIdFromQuery) {
        fetchDocuments();
      }
    };

    const handleWorkspaceUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      const activeWorkspaceId = Number(openedFolder?.workspace_id || selectedWorkspace || workspaceIdFromQuery);
      if (Number.isFinite(changedWorkspaceId) && Number.isFinite(activeWorkspaceId) && changedWorkspaceId !== activeWorkspaceId) {
        return;
      }

      fetchWorkspaces();
      fetchContainers();
      refreshVisibleDocuments();
    };

    const handleContainersUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      const activeWorkspaceId = Number(openedFolder?.workspace_id || selectedWorkspace || workspaceIdFromQuery);
      if (Number.isFinite(changedWorkspaceId) && Number.isFinite(activeWorkspaceId) && changedWorkspaceId !== activeWorkspaceId) {
        return;
      }

      fetchContainers();
      refreshVisibleDocuments();
    };

    const handleDocumentsUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      const activeWorkspaceId = Number(openedFolder?.workspace_id || selectedWorkspace || workspaceIdFromQuery);
      if (Number.isFinite(changedWorkspaceId) && Number.isFinite(activeWorkspaceId) && changedWorkspaceId !== activeWorkspaceId) {
        return;
      }

      refreshVisibleDocuments();
    };

    window.addEventListener('workspaces-updated', handleWorkspaceUpdated);
    window.addEventListener('containers-updated', handleContainersUpdated);
    window.addEventListener('documents-updated', handleDocumentsUpdated);

    return () => {
      window.removeEventListener('workspaces-updated', handleWorkspaceUpdated);
      window.removeEventListener('containers-updated', handleContainersUpdated);
      window.removeEventListener('documents-updated', handleDocumentsUpdated);
    };
  }, [openedFolder, selectedWorkspace, workspaceIdFromQuery, containerIdParam]);

  const checkDuplicateUploadInContainer = async (containerId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch(`/api/v1/containers/${containerId}/documents/duplicate-check`, {
      method: 'POST',
      body: formData,
    });
  };

  const resolveWorkspaceUploadContainerId = (workspaceId) => {
    const numericWorkspaceId = Number(workspaceId);
    if (!Number.isFinite(numericWorkspaceId) || numericWorkspaceId <= 0) return null;

    const workspaceContainers = (Array.isArray(dbContainers) ? dbContainers : []).filter(
      (container) => Number(container?.workspace_id) === numericWorkspaceId
    );
    if (!workspaceContainers.length) return null;

    const defaultContainer = workspaceContainers.find((container) => Boolean(container?.is_workspace_default));
    if (defaultContainer?.id != null) {
      const id = Number(defaultContainer.id);
      if (Number.isFinite(id) && id > 0) return id;
    }

    const topLevelContainer = workspaceContainers.find((container) => container?.parent_container_id == null);
    if (topLevelContainer?.id != null) {
      const id = Number(topLevelContainer.id);
      if (Number.isFinite(id) && id > 0) return id;
    }

    return null;
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    const targetWorkspaceId = openedFolder?.workspace_id || selectedWorkspace;
    const uploadToPersonalContainer = Boolean(openedFolder?.id && !openedFolder?.workspace_id);
    const targetContainerId = Number(openedFolder?.id || NaN);
    const hasTargetContainer = Number.isFinite(targetContainerId) && targetContainerId > 0;
    const workspaceUploadContainerId = uploadToPersonalContainer
      ? null
      : (openedFolder?.workspace_id && hasTargetContainer
        ? targetContainerId
        : resolveWorkspaceUploadContainerId(targetWorkspaceId));

    if (uploadFiles.length === 0) {
      setError('Please select at least one file to upload.');
      return;
    }

    if (!uploadToPersonalContainer && !targetWorkspaceId) {
      setError('Please select a workspace before uploading.');
      return;
    }

    if (!uploadToPersonalContainer && !workspaceUploadContainerId) {
      setError('Could not find a destination folder for this workspace. Refresh and try again.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const uploadResults = await Promise.all(
        uploadFiles.map(async (file) => {
          try {
            let allowDuplicate = false;
            if (workspaceUploadContainerId) {
              const duplicateCheck = await checkDuplicateUploadInContainer(workspaceUploadContainerId, file);
              if (duplicateCheck?.is_duplicate) {
                const existingLabel = duplicateCheck.duplicate_filename || `Document #${duplicateCheck.duplicate_document_id}`;
                const shouldUploadDuplicate = window.confirm(
                  `"${file.name}" looks identical to "${existingLabel}" in this folder. Upload anyway?`
                );
                if (!shouldUploadDuplicate) {
                  return { status: 'skipped-duplicate' };
                }
                allowDuplicate = true;
              }
            }

            const formData = new FormData();
            formData.append('file', file);
            if (!uploadToPersonalContainer && workspaceUploadContainerId) {
              formData.append('container_id', String(workspaceUploadContainerId));
            }
            if (allowDuplicate) {
              formData.append('allow_duplicate', 'true');
            }

            const uploadUrl = uploadToPersonalContainer
              ? `${API_URL}/api/v1/containers/${openedFolder.id}/documents`
              : `${API_URL}/api/v1/workspaces/${targetWorkspaceId}/documents`;

            const response = await fetch(uploadUrl, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: formData,
            });

            if (!response.ok) {
              const message = await getApiErrorMessage(response, `Failed to upload ${file.name}`);
              throw new Error(message);
            }

            setUploadProgress((prev) => ({
              ...prev,
              [file.name]: 100,
            }));

            await response.json();
            return { status: 'uploaded' };
          } catch (err) {
            return {
              status: 'failed',
              error: err.message || `Failed to upload ${file.name}`,
            };
          }
        })
      );

      const uploadedCount = uploadResults.filter((item) => item.status === 'uploaded').length;
      const duplicateSkippedCount = uploadResults.filter((item) => item.status === 'skipped-duplicate').length;
      const failedUploads = uploadResults.filter((item) => item.status === 'failed');

      if (uploadedCount > 0) {
        setUploadFiles([]);
        setUploadProgress({});
        setShowUploadModal(false);

        const messageParts = [`Uploaded ${uploadedCount} file${uploadedCount !== 1 ? 's' : ''}.`];
        if (duplicateSkippedCount > 0) {
          messageParts.push(`${duplicateSkippedCount} duplicate${duplicateSkippedCount !== 1 ? 's were' : ' was'} skipped.`);
        }
        if (failedUploads.length > 0) {
          messageParts.push(`${failedUploads.length} failed.`);
        }
        setSuccessMessage(messageParts.join(' '));
        setTimeout(() => setSuccessMessage(null), 4000);

        const wsId = openedFolder?.workspace_id || selectedWorkspace;
        if (wsId) startProcessingPoll(wsId);

        if (openedFolder?.id) {
          try {
            const items = await fetchDocumentsForContainer(openedFolder.id);
            setFolderDocuments(items);
          } catch (err) {
            console.error('Error refreshing folder:', err);
          }
        }
      }

      if (uploadedCount === 0 && failedUploads.length > 0) {
        setError(failedUploads[0].error || 'Upload failed');
      } else if (uploadedCount === 0 && duplicateSkippedCount > 0) {
        setError('Upload canceled for duplicate files.');
      } else if (failedUploads.length > 0) {
        setError(failedUploads[0].error || 'Some files failed to upload');
      }
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
  const maxFilesPerUpload = 50;
  if (combined.length > maxFilesPerUpload) {
    setError(`You can select up to ${maxFilesPerUpload} documents per upload`);
    setUploadFiles(combined.slice(0, maxFilesPerUpload));
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
  const trimmedName = String(containerName || '').trim();
  if (!trimmedName) {
    setError('Please enter a container name');
    return;
  }

  const scopedWorkspaceId = openedFolder?.workspace_id || null;
  const numericParentId = Number(createContainerParentId);
  const hasValidParentId =
    createContainerParentId !== null &&
    createContainerParentId !== '' &&
    Number.isFinite(numericParentId) &&
    numericParentId > 0;
  const isNestedCreation = hasValidParentId;
  const createUrl = scopedWorkspaceId
    ? `${API_URL}/api/v1/workspaces/${Number(scopedWorkspaceId)}/containers`
    : `${API_URL}/api/v1/containers`;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: trimmedName,
        color: containerColor,
        workspace_id: scopedWorkspaceId ? Number(scopedWorkspaceId) : null,
        parent_container_id: hasValidParentId ? numericParentId : null,
      }),
    });

    if (!response.ok) {
      const message = await getApiErrorMessage(
        response,
        isNestedCreation ? 'Failed to create subfolder' : 'Failed to create folder'
      );
      throw new Error(message);
    }

    const data = await response.json().catch(() => null);
    const created = data?.item || data?.container || data || null;
    if (!created?.id) {
      throw new Error(isNestedCreation ? 'Subfolder was created but the server returned an invalid response.' : 'Folder was created but the server returned an invalid response.');
    }

    const rawType = String(created?.type || created?.owner_type || created?.created_by_type || 'user').toLowerCase();
    const normalizedType = rawType.includes('ai') ? 'ai' : rawType.includes('workspace') ? 'workspace' : 'user';
    const newContainer = {
      id: created.id,
      name: created.name || trimmedName,
      color: created.color || containerColor,
      workspace_id: created.workspace_id ?? (scopedWorkspaceId ? Number(scopedWorkspaceId) : null),
      parent_container_id: created.parent_container_id ?? (hasValidParentId ? numericParentId : null),
      created_by: created.created_by,
      created_at: created.created_at,
      type: normalizedType,
      is_workspace_default: Boolean(created.is_workspace_default),
    };

    setDbContainers((prev) => [...prev, newContainer]);
    setCreatedContainers((prev) => {
      const next = [...prev, newContainer];
      localStorage.setItem('createdContainers', JSON.stringify(next));
      return next;
    });

    await fetchContainers();

    setContainerName('');
    setContainerColor('#f59e0b');
    setShowCreateContainer(false);
    setCreateContainerParentId(null);

    setSuccessMessage(isNestedCreation ? 'Subfolder created' : 'Folder created');
    setTimeout(() => setSuccessMessage(null), 3000);
    setError(null);
  } catch (err) {
    setError(err.message || 'Failed to create container');
  }
};

  const handleDeleteDocument = async (docId) => {
    if (!window.confirm('Delete this document?')) return;

    try {
      await apiFetch(`/api/v1/documents/${docId}`, { method: 'DELETE' });
      setError(null);
      fetchDocuments();
    } catch (err) {
      setError(err?.message || 'Failed to delete document');
    }
  };

  const [requestingDeletionId, setRequestingDeletionId] = useState(null);

  const handleRequestDeletion = async (docId, docFilename) => {
    const reason = prompt(`Request deletion of "${docFilename}"?\n\nOptional: Add a reason for the request:`, '');
    if (reason === null) return;

    setError(null);
    setRequestingDeletionId(docId);
    try {
      await apiFetch(
        `/api/v1/documents/${docId}/deletion-request?reason=${encodeURIComponent(reason || '')}`,
        { method: 'POST' }
      );
      setSuccessMessage('Deletion request sent to document owner');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(err?.message || 'Failed to send deletion request');
    } finally {
      setRequestingDeletionId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDocuments.size === 0) return;
    const count = selectedDocuments.size;
    if (!window.confirm(`Delete ${count} document${count > 1 ? 's' : ''}?`)) return;

    setLoading(true);
    setError(null);
    try {
      const docIds = Array.from(selectedDocuments);
      const results = await Promise.allSettled(
        docIds.map((docId) => apiFetch(`/api/v1/documents/${docId}`, { method: 'DELETE' }))
      );
      const succeededIds = new Set(docIds.filter((_, i) => results[i].status === 'fulfilled'));
      const failed = results.filter((r) => r.status === 'rejected');
      if (succeededIds.size > 0) {
        setSelectedDocuments((prev) => new Set([...prev].filter((id) => !succeededIds.has(id))));
        fetchDocuments();
      }
      if (failed.length > 0) {
        const firstReason = failed[0].reason?.message || 'Delete failed';
        setError(failed.length === 1 ? firstReason : `${firstReason} (and ${failed.length - 1} other failure${failed.length > 2 ? 's' : ''})`);
      }
    } catch (err) {
      setError(err?.message || 'Failed to delete documents');
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

      const payload = await response.json();
      if (!payload?.url) throw new Error('Download link unavailable');

      const a = document.createElement('a');
      a.href = payload.url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchSuggestContainer = async (doc) => {
    const docId = Number(doc?.id);
    if (!Number.isFinite(docId)) return null;
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/v1/documents/${docId}/suggest-container`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const message = await getApiErrorMessage(response, 'Failed to generate suggestion');
      throw new Error(message);
    }
    return response.json();
  };

  const handleSuggestContainer = async (doc) => {
    const docId = Number(doc?.id);
    if (!Number.isFinite(docId)) return;

    setSuggestingDocIds((prev) => new Set(prev).add(docId));
    try {
      const payload = await fetchSuggestContainer(doc);
      if (payload) {
        setSuggestionsByDoc((prev) => ({ ...prev, [docId]: payload }));
        setError(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate suggestion');
    } finally {
      setSuggestingDocIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleApplySuggestion = async (doc, suggestion) => {
    const docId = Number(doc?.id);
    const targetContainerId = Number(suggestion?.suggested_container_id);
    if (!Number.isFinite(docId) || !Number.isFinite(targetContainerId)) return;

    setApplyingSuggestionIds((prev) => {
      const next = new Set(prev);
      next.add(docId);
      return next;
    });

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ container_id: targetContainerId }),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to move document');
        throw new Error(message);
      }

      const updatedDoc = await response.json();
      setFolderDocuments((prev) => prev.filter((item) => item.id !== docId));
      setDocuments((prev) => prev.map((item) => (item.id === docId ? updatedDoc : item)));
      setSuggestionsByDoc((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
      setSuccessMessage(`Moved "${doc.filename}" to ${suggestion.suggested_container_name}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to move document');
    } finally {
      setApplyingSuggestionIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleCorrectSuggestion = async (doc, suggestion, targetContainerId) => {
    const docId = Number(doc?.id);
    const targetId = Number(targetContainerId);
    const suggestedId = Number(suggestion?.suggested_container_id);
    if (!Number.isFinite(docId) || !Number.isFinite(targetId)) return;

    setApplyingSuggestionIds((prev) => {
      const next = new Set(prev);
      next.add(docId);
      return next;
    });

    try {
      const token = localStorage.getItem('token');
      const body = { container_id: targetId };
      if (Number.isFinite(suggestedId) && suggestedId !== targetId) {
        body.suggested_container_id = suggestedId;
      }
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to move document');
        throw new Error(message);
      }

      const updatedDoc = await response.json();
      setFolderDocuments((prev) => prev.filter((item) => item.id !== docId));
      setDocuments((prev) => prev.map((item) => (item.id === docId ? updatedDoc : item)));
      setSuggestionsByDoc((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
      const targetName = openedFolderSubfolders.find((f) => Number(f.id) === targetId)?.name || 'folder';
      setSuccessMessage(`Moved "${doc.filename}" to ${targetName}. Ada will learn from this correction.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to move document');
    } finally {
      setApplyingSuggestionIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleDismissSuggestion = (docId) => {
    setSuggestionsByDoc((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  const handleCreateSubfolderForDocument = async (doc) => {
    const docId = Number(doc?.id);
    const workspaceId = Number(openedFolder?.workspace_id);
    const parentId = Number(openedFolder?.id);
    if (!Number.isFinite(docId) || !Number.isFinite(workspaceId) || !Number.isFinite(parentId)) {
      setError('Open a folder first to create a subfolder inside it.');
      return;
    }
    let suggestion = suggestionsByDoc[docId];
    if (!suggestion) {
      setSuggestingDocIds((prev) => new Set(prev).add(docId));
      try {
        suggestion = await fetchSuggestContainer(doc);
        if (suggestion) setSuggestionsByDoc((prev) => ({ ...prev, [docId]: suggestion }));
      } catch (err) {
        setError(err.message || 'Failed to get suggestion');
        return;
      } finally {
        setSuggestingDocIds((prev) => {
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
      }
    }
    const name = (suggestion?.suggested_new_container_name || '').trim();
    if (!name) {
      setError('Could not suggest a name from document content. Ensure the document is indexed and try again.');
      return;
    }
    await handleCreateSuggestedSubfolderAndMove(doc, { ...suggestion, suggested_new_container_name: name });
  };

  const handleCreateSuggestedSubfolderAndMove = async (doc, suggestion) => {
    const newName = (suggestion?.suggested_new_container_name || '').trim();
    const docId = Number(doc?.id);
    const workspaceId = Number(openedFolder?.workspace_id);
    const parentId = Number(openedFolder?.id);
    if (!newName || !Number.isFinite(docId)) {
      setError('No folder name from document content. Use Suggest (folder icon) first or try again after the document is indexed.');
      return;
    }
    if (!Number.isFinite(workspaceId) || !Number.isFinite(parentId)) {
      setError('Open a folder first to create a subfolder inside it.');
      return;
    }

    setApplyingSuggestionIds((prev) => new Set(prev).add(docId));
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const createRes = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/containers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newName,
          color: '#6f93ff',
          workspace_id: workspaceId,
          parent_container_id: parentId,
        }),
      });

      if (!createRes.ok) {
        const msg = await getApiErrorMessage(createRes, 'Failed to create subfolder');
        throw new Error(msg);
      }

      const createData = await createRes.json().catch(() => ({}));
      const created = createData?.item || createData?.container || createData;
      const newContainerId = created?.id;
      if (!Number.isFinite(newContainerId)) {
        throw new Error('Subfolder was created but the server returned an invalid response.');
      }

      setDbContainers((prev) => [...prev, { ...created, name: created?.name || newName }]);
      setCreatedContainers((prev) => {
        const next = [...prev, { id: created.id, name: created?.name || newName, ...created }];
        localStorage.setItem('createdContainers', JSON.stringify(next));
        return next;
      });
      await fetchContainers();

      const moveRes = await fetch(`${API_URL}/api/v1/documents/${docId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ container_id: newContainerId }),
      });

      if (!moveRes.ok) {
        const msg = await getApiErrorMessage(moveRes, 'Failed to move document');
        throw new Error(msg);
      }

      setFolderDocuments((prev) => prev.filter((item) => item.id !== docId));
      setDocuments((prev) => prev.map((item) => (item.id === docId ? { ...item, container_id: newContainerId } : item)));
      setSuggestionsByDoc((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
      setSuccessMessage(`Created subfolder "${newName}" and moved "${doc.filename}" into it.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err.message || 'Failed to create subfolder or move document');
    } finally {
      setApplyingSuggestionIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleRetryIndexing = async (doc, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const docId = Number(doc?.id);
    if (!Number.isFinite(docId)) return;

    setRetryingDocIds((prev) => {
      const next = new Set(prev);
      next.add(docId);
      return next;
    });

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}/retry-indexing`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to retry indexing');
        throw new Error(message);
      }

      const updatedDoc = await response.json();
      setFolderDocuments((prev) => prev.map((item) => (Number(item.id) === docId ? { ...item, ...updatedDoc } : item)));
      setDocuments((prev) => prev.map((item) => (Number(item.id) === docId ? { ...item, ...updatedDoc } : item)));
      setSuccessMessage(`Retrying indexing for "${doc.filename}".`);
      setTimeout(() => setSuccessMessage(null), 3000);
      setError(null);

      const workspaceId = Number(updatedDoc?.workspace_id || openedFolder?.workspace_id || selectedWorkspace || workspaceIdFromQuery);
      if (Number.isFinite(workspaceId) && workspaceId > 0) {
        startProcessingPoll(workspaceId);
      }
    } catch (err) {
      setError(err.message || 'Could not retry indexing');
    } finally {
      setRetryingDocIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const buildAutoOrganizeReport = ({ result, beforeCount, afterCount, mode }) => {
    const containerNameById = new Map(
      displayedContainers.map((container) => [Number(container.id), container.name])
    );
    const movedDocuments = Array.isArray(result?.moved_documents)
      ? result.moved_documents.map((item) => {
          const fromId = item?.from_container_id == null ? null : Number(item.from_container_id);
          const rawToId = item?.to_container_id;
          const toId = rawToId == null ? null : Number(rawToId);
          const fromName =
            fromId == null
              ? 'Unassigned'
              : containerNameById.get(fromId) || `Folder #${fromId}`;
          const toName =
            item?.to_container_name
            || (toId == null ? 'Ada Suggested Folder' : containerNameById.get(toId) || `Folder #${toId}`);
          return {
            document_id: Number(item?.document_id),
            filename: item?.filename || `Document #${item?.document_id}`,
            confidence: String(item?.confidence || '').toLowerCase(),
            confidence_score: Number.isFinite(Number(item?.confidence_score))
              ? Number(Number(item?.confidence_score).toFixed(3))
              : null,
            boost_applied: Boolean(item?.boost_applied),
            from_container_name: fromName,
            to_container_name: toName,
          };
        })
      : [];

    const scoredMoves = movedDocuments.filter((item) => Number.isFinite(item.confidence_score));
    const averageConfidenceScore = scoredMoves.length
      ? Number((scoredMoves.reduce((sum, item) => sum + item.confidence_score, 0) / scoredMoves.length).toFixed(3))
      : null;
    const boostedMoves = movedDocuments.filter((item) => item.boost_applied).length;

    let trendFromPreviousRun = null;
    try {
      const previousRaw = localStorage.getItem('ada:auto-organize-last-report');
      if (previousRaw) {
        const previous = JSON.parse(previousRaw);
        const previousAverage = Number(previous?.average_confidence_score);
        if (Number.isFinite(previousAverage) && Number.isFinite(averageConfidenceScore)) {
          trendFromPreviousRun = Number((averageConfidenceScore - previousAverage).toFixed(3));
        }
      }
    } catch {
      trendFromPreviousRun = null;
    }

    const report = {
      ranAt: new Date().toISOString(),
      mode,
      considered: Number(result?.considered || 0),
      moved: Number(result?.moved || 0),
      skipped_low_confidence: Number(result?.skipped_low_confidence || 0),
      skipped_no_suggestion: Number(result?.skipped_no_suggestion || 0),
      skipped_already_organized: Number(result?.skipped_already_organized || 0),
      folder_before_count: beforeCount,
      folder_after_count: afterCount,
      moved_documents: movedDocuments,
      average_confidence_score: averageConfidenceScore,
      boosted_moves: boostedMoves,
      trend_from_previous_run: trendFromPreviousRun,
    };

    try {
      localStorage.setItem(
        'ada:auto-organize-last-report',
        JSON.stringify({ average_confidence_score: averageConfidenceScore, ran_at: report.ranAt })
      );
    } catch {}

    return report;
  };

  const handleAutoOrganizeWorkspace = async () => {
    const workspaceId = Number(openedFolder?.workspace_id);
    if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
      setError('Auto-organize is available only for workspace folders.');
      return;
    }

    const beforeFolderCount = folderDocuments.length;

    setAutoOrganizing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_URL}/api/v1/workspaces/${workspaceId}/documents/auto-organize?min_confidence=high&dry_run=true`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Auto-organize failed');
        throw new Error(message);
      }

      const result = await response.json();
      const movedCount = Number(result?.moved || 0);
      const skippedCount = Number(result?.skipped_low_confidence || 0) + Number(result?.skipped_no_suggestion || 0);
      setSuccessMessage(
        movedCount > 0
          ? `Ada suggested ${movedCount} move${movedCount !== 1 ? 's' : ''}. Review and accept to apply.`
          : `No suggestions generated. ${skippedCount} document${skippedCount !== 1 ? 's were' : ' was'} skipped.`
      );
      setTimeout(() => setSuccessMessage(null), 4000);

      setAutoOrganizeReport(
        buildAutoOrganizeReport({
          result,
          beforeCount: beforeFolderCount,
          afterCount: beforeFolderCount,
          mode: 'preview',
        })
      );
      setError(null);
    } catch (err) {
      setError(err.message || 'Auto-organize failed');
    } finally {
      setAutoOrganizing(false);
    }
  };

  const handleApplyAutoOrganizeSuggestions = async () => {
    const workspaceId = Number(openedFolder?.workspace_id);
    if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
      setError('Auto-organize is available only for workspace folders.');
      return;
    }

    const shouldApply = window.confirm('Apply the suggested moves from Ada?');
    if (!shouldApply) return;

    const beforeFolderCount = folderDocuments.length;
    setAutoOrganizing(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_URL}/api/v1/workspaces/${workspaceId}/documents/auto-organize?min_confidence=high&dry_run=false`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to apply suggestions');
        throw new Error(message);
      }

      const result = await response.json();
      let afterFolderCount = beforeFolderCount;
      if (openedFolder?.id) {
        const refreshed = await fetchDocumentsForContainer(openedFolder.id);
        setFolderDocuments(refreshed);
        afterFolderCount = refreshed.length;
      }

      setAutoOrganizeReport(
        buildAutoOrganizeReport({
          result,
          beforeCount: beforeFolderCount,
          afterCount: afterFolderCount,
          mode: 'applied',
        })
      );

      const movedCount = Number(result?.moved || 0);
      setSuccessMessage(
        movedCount > 0
          ? `Applied ${movedCount} Ada suggestion${movedCount !== 1 ? 's' : ''}.`
          : 'No suggestions were applied.'
      );
      setTimeout(() => setSuccessMessage(null), 4000);

      fetchDocuments();
      setSuggestionsByDoc({});
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to apply suggestions');
    } finally {
      setAutoOrganizing(false);
    }
  };

  // Open folder and load actual documents for this workspace
  const handleFolderDoubleClick = (folder) => {
    navigate(`/documents/${folder.id}`);
  };

  const handleBackFromFolder = () => {
    if (parentFolder?.id) {
      setSelectedDocuments(new Set());
      setSelectedFolders(new Set());
      setAutoOrganizeReport(null);
      setFolderSearchQuery('');
      setSortBy('lastOpened');
      setShowCreateContainer(false);
      setCreateContainerParentId(null);
      navigate(`/documents/${parentFolder.id}`);
      return;
    }

    const backTarget = '/documents';

    setOpenedFolder(null);
    setFolderDocuments([]);
    setAutoOrganizeReport(null);
    setFolderSearchQuery('');
    setSelectedDocuments(new Set());
    setSelectedFolders(new Set());
    setSortBy('lastOpened');
    setShowCreateContainer(false);
    setCreateContainerParentId(null);
    navigate(backTarget);
  };

  const handleWorkspaceSelect = (value) => {
    const nextWorkspaceId = Number(value);
    if (!Number.isFinite(nextWorkspaceId) || nextWorkspaceId <= 0) {
      setSelectedWorkspace('');
      return;
    }

    setSelectedWorkspace(nextWorkspaceId);
  };

  const handleDeleteFolderDocument = async (docId) => {
    if (!window.confirm('Delete this document?')) return;

    try {
      await apiFetch(`/api/v1/documents/${docId}`, { method: 'DELETE' });
      setFolderDocuments((prev) => prev.filter((doc) => Number(doc.id) !== Number(docId)));
      setError(null);
      setSuccessMessage('Document deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err?.message || 'Failed to delete document');
    }
  };

  const deleteContainerById = async (containerId, { suppressSuccessMessage = false } = {}) => {
    if (typeof containerId === 'string' && containerId.startsWith('local-')) {
      setCreatedContainers((prev) => {
        const next = prev.filter((container) => container.id !== containerId);
        localStorage.setItem('createdContainers', JSON.stringify(next));
        return next;
      });
      setSelectedFolders((prev) => new Set([...prev].filter((id) => String(id) !== String(containerId))));
      if (!suppressSuccessMessage) {
        setSuccessMessage('Container deleted');
        setTimeout(() => setSuccessMessage(null), 2500);
      }
      return;
    }

    const container =
      dbContainers.find((entry) => Number(entry.id) === Number(containerId)) ||
      displayedContainers.find((entry) => Number(entry.id) === Number(containerId));
    const path = container?.workspace_id
      ? `/api/v1/workspaces/${container.workspace_id}/containers/${containerId}`
      : `/api/v1/containers/${containerId}`;

    await apiFetch(path, { method: 'DELETE' });

    setCreatedContainers((prev) => {
      const next = prev.filter((entry) => entry.id !== containerId);
      localStorage.setItem('createdContainers', JSON.stringify(next));
      return next;
    });
    setDbContainers((prev) => prev.filter((entry) => Number(entry.id) !== Number(containerId)));
    setSelectedFolders((prev) => new Set([...prev].filter((id) => Number(id) !== Number(containerId))));

    if (!suppressSuccessMessage) {
      setSuccessMessage('Container deleted');
      setTimeout(() => setSuccessMessage(null), 2500);
    }
  };

  const handleBulkDeleteFolderDocuments = async () => {
    const selectedDocIds = Array.from(selectedDocuments).map((id) => Number(id));
    const selectedFolderIds = Array.from(selectedFolders).map((id) => Number(id));
    const deletableFolderIds = selectedFolderIds.filter((id) => canDeleteContainer(id));
    const undeletableFolderCount = selectedFolderIds.length - deletableFolderIds.length;
    const totalSelectedCount = selectedDocIds.length + selectedFolderIds.length;

    if (totalSelectedCount === 0) return;

    const summaryParts = [];
    if (selectedDocIds.length > 0) {
      summaryParts.push(`${selectedDocIds.length} document${selectedDocIds.length > 1 ? 's' : ''}`);
    }
    if (selectedFolderIds.length > 0) {
      summaryParts.push(`${selectedFolderIds.length} subfolder${selectedFolderIds.length > 1 ? 's' : ''}`);
    }
    if (!window.confirm(`Delete ${summaryParts.join(' and ')}?`)) return;

    setLoading(true);
    setError(null);

    try {
      const documentDeletionResults = await Promise.allSettled(
        selectedDocIds.map((docId) => apiFetch(`/api/v1/documents/${docId}`, { method: 'DELETE' }))
      );

      const folderDeletionResults = await Promise.allSettled(
        deletableFolderIds.map((folderId) => deleteContainerById(folderId, { suppressSuccessMessage: true }))
      );

      const successfulDocIds = documentDeletionResults
        .map((result, index) => (result.status === 'fulfilled' ? selectedDocIds[index] : null))
        .filter((id) => id != null);
      const successfulFolderIds = folderDeletionResults
        .map((result, index) => (result.status === 'fulfilled' ? deletableFolderIds[index] : null))
        .filter((id) => id != null);
      const failedDocCount = documentDeletionResults.length - successfulDocIds.length;
      const failedFolderCount = folderDeletionResults.length - successfulFolderIds.length;

      if (successfulDocIds.length > 0) {
        setFolderDocuments((prev) => prev.filter((doc) => !successfulDocIds.includes(Number(doc.id))));
      }

      setSelectedDocuments((prev) => new Set([...prev].filter((id) => !successfulDocIds.includes(Number(id)))));
      setSelectedFolders((prev) => new Set([...prev].filter((id) => !successfulFolderIds.includes(Number(id)))));

      const successParts = [];
      if (successfulDocIds.length > 0) {
        successParts.push(`${successfulDocIds.length} document${successfulDocIds.length > 1 ? 's' : ''}`);
      }
      if (successfulFolderIds.length > 0) {
        successParts.push(`${successfulFolderIds.length} subfolder${successfulFolderIds.length > 1 ? 's' : ''}`);
      }
      if (successParts.length > 0) {
        setSuccessMessage(`Deleted ${successParts.join(' and ')}.`);
        setTimeout(() => setSuccessMessage(null), 3000);
      }

      const failureParts = [];
      let firstDocError = null;
      if (failedDocCount > 0) {
        failureParts.push(`${failedDocCount} document${failedDocCount > 1 ? 's' : ''}`);
        const rejected = documentDeletionResults.find((r) => r.status === 'rejected');
        if (rejected?.reason?.message) firstDocError = rejected.reason.message;
      }
      if (failedFolderCount > 0) {
        failureParts.push(`${failedFolderCount} subfolder${failedFolderCount > 1 ? 's' : ''}`);
      }
      if (undeletableFolderCount > 0) {
        failureParts.push(`${undeletableFolderCount} locked subfolder${undeletableFolderCount > 1 ? 's' : ''}`);
      }
      if (failureParts.length > 0) {
        setError(firstDocError || `Could not delete ${failureParts.join(' and ')}.`);
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
      setError(`Failed to delete selected items: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMoveSelectedToSubfolder = async () => {
    const targetContainerId = Number(moveTargetSubfolderId);
    const selectedDocIds = Array.from(selectedDocuments).map((id) => Number(id));
    if (!selectedDocIds.length) return;
    if (!Number.isFinite(targetContainerId) || targetContainerId <= 0) {
      setError('Select a subfolder to move documents into.');
      return;
    }

    const targetFolder = openedFolderSubfolders.find(
      (folder) => Number(folder.id) === targetContainerId
    );
    if (!targetFolder) {
      setError('Selected subfolder is no longer available.');
      return;
    }

    const count = selectedDocIds.length;
    const shouldMove = window.confirm(
      `Move ${count} document${count > 1 ? 's' : ''} to "${targetFolder.name}"?`
    );
    if (!shouldMove) return;

    setMovingDocuments(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const moveResults = await Promise.allSettled(
        selectedDocIds.map((docId) =>
          fetch(`${API_URL}/api/v1/documents/${docId}`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ container_id: targetContainerId }),
          }).then(async (response) => {
            if (!response.ok) {
              const message = await getApiErrorMessage(response, `Failed to move document ${docId}`);
              throw new Error(message);
            }
            return response.json();
          })
        )
      );

      const successfulDocIds = moveResults
        .map((result, index) => (result.status === 'fulfilled' ? selectedDocIds[index] : null))
        .filter((id) => id != null);
      const failedCount = moveResults.length - successfulDocIds.length;

      if (successfulDocIds.length > 0) {
        setFolderDocuments((prev) => prev.filter((doc) => !successfulDocIds.includes(Number(doc.id))));
        setSelectedDocuments(new Set());
        setMoveTargetSubfolderId('');
        setSuccessMessage(
          `Moved ${successfulDocIds.length} document${successfulDocIds.length > 1 ? 's' : ''} to ${targetFolder.name}.`
        );
        setTimeout(() => setSuccessMessage(null), 3500);

        if (openedFolder?.id) {
          const refreshed = await fetchDocumentsForContainer(openedFolder.id);
          setFolderDocuments(refreshed);
        }
      }

      if (failedCount > 0) {
        setError(`Could not move ${failedCount} document${failedCount > 1 ? 's' : ''}.`);
      }
    } catch (err) {
      setError(err.message || 'Failed to move selected documents.');
    } finally {
      setMovingDocuments(false);
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

    // Otherwise call backend delete endpoint. Use workspace-scoped path if selectedWorkspace is set
    const handleDeleteContainer = async (containerId) => {
    try {
      if (!window.confirm('Delete this container?')) return;
      await deleteContainerById(containerId);
    } catch (err) {
      const msg = err?.message || '';
      if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
        setError('Could not reach the server. Check your connection and that the app URL is correct. If the folder was created by Ada, only the owner or a workspace admin can delete it.');
      } else {
        setError(msg || 'Failed to delete container');
      }
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setOwnerFilter('all');
  };

  const handleToggleContainerCollapse = (containerId) => {
    setCollapsedContainerIds((prev) => {
      const next = new Set(prev);
      if (next.has(containerId)) {
        next.delete(containerId);
      } else {
        next.add(containerId);
      }
      return next;
    });
  };

  const isMoveCreatingCycle = (movingContainerId, nextParentContainerId) => {
    if (!nextParentContainerId) return false;
    if (Number(movingContainerId) === Number(nextParentContainerId)) return true;

    const byId = new Map(displayedContainers.map((container) => [Number(container.id), container]));
    let cursor = byId.get(Number(nextParentContainerId));
    let safety = 0;
    while (cursor && safety < 200) {
      if (Number(cursor.id) === Number(movingContainerId)) {
        return true;
      }
      const parentId = cursor.parent_container_id;
      if (parentId == null) {
        return false;
      }
      cursor = byId.get(Number(parentId));
      safety += 1;
    }
    return false;
  };

  const handleMoveContainer = async (containerId, parentContainerId) => {
    const numericContainerId = Number(containerId);
    if (!Number.isFinite(numericContainerId)) return;

    const targetParentId = parentContainerId == null ? null : Number(parentContainerId);
    const container = displayedContainers.find((entry) => Number(entry.id) === numericContainerId);
    if (!container) return;
    if (Number(container.parent_container_id ?? -1) === Number(targetParentId ?? -1)) return;

    if (isMoveCreatingCycle(numericContainerId, targetParentId)) {
      setError('Cannot move a folder into itself or one of its descendants.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const endpoint = container.workspace_id
        ? `${API_URL}/api/v1/workspaces/${container.workspace_id}/containers/${numericContainerId}/move`
        : `${API_URL}/api/v1/containers/${numericContainerId}/move`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent_container_id: targetParentId }),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to move folder');
        throw new Error(message);
      }

      const data = await response.json();
      const updated = data?.item ?? data?.container ?? data;
      const newParentId = (updated ?? data)?.parent_container_id ?? null;
      setDbContainers((prev) =>
        prev.map((entry) =>
          Number(entry.id) === numericContainerId
            ? { ...entry, parent_container_id: newParentId }
            : entry
        )
      );
      setSuccessMessage('Folder moved');
      setTimeout(() => setSuccessMessage(null), 2200);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to move folder');
    }
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

  const handleFolderCheckboxChange = (folderId) => {
    const nextSelected = new Set(selectedFolders);
    if (nextSelected.has(folderId)) {
      nextSelected.delete(folderId);
    } else {
      nextSelected.add(folderId);
    }
    setSelectedFolders(nextSelected);
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
      color: normalizeHexColor(container?.color, palette[idx % palette.length]),
      type: container.type || (container.workspace_id ? 'workspace' : 'user'),
    }));
  }, [dbContainers]);

  const hexToRgba = (hex, alpha) => {
    const h = normalizeHexColor(hex).replace('#','');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const displayedContainers = useMemo(() => {
    const localOnly = createdContainers.filter((container) => typeof container.id === 'string' && container.id.startsWith('local-'));
    return [...containers, ...localOnly].map((container) => ({
      ...container,
      color: normalizeHexColor(container?.color),
    }));
  }, [containers, createdContainers]);

  const openedFolderSubfolders = useMemo(() => {
    if (!openedFolder?.id) return [];
    return displayedContainers
      .filter((container) => Number(container?.parent_container_id ?? -1) === Number(openedFolder.id))
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [displayedContainers, openedFolder?.id]);

  const openedFolderPath = useMemo(() => {
    if (!openedFolder?.id) return [];

    const byId = new Map(displayedContainers.map((container) => [Number(container.id), container]));
    const path = [];
    let cursor = openedFolder;
    let safety = 0;

    while (cursor && safety < 200) {
      path.unshift(cursor);
      const parentId = cursor.parent_container_id;
      cursor = parentId == null ? null : byId.get(Number(parentId));
      safety += 1;
    }

    return path;
  }, [displayedContainers, openedFolder]);

  const parentFolder = openedFolderPath.length > 1
    ? openedFolderPath[openedFolderPath.length - 2]
    : null;

  const folderTableEntries = useMemo(() => {
    const normalizedQuery = folderSearchQuery.trim().toLowerCase();
    const visibleSubfolders = openedFolderSubfolders
      .filter((folder) => {
        const name = String(folder?.name || '').toLowerCase();
        return !normalizedQuery || name.includes(normalizedQuery);
      })
      .map((folder) => ({ kind: 'folder', item: folder }));

    const visibleDocuments = folderDocuments.filter((document) => {
      const filename = String(document?.filename || '').toLowerCase();
      return !normalizedQuery || filename.includes(normalizedQuery);
    });

    let sortedDocuments = [...visibleDocuments];
    switch (sortBy) {
      case 'name':
        visibleSubfolders.sort((a, b) => String(a.item?.name || '').localeCompare(String(b.item?.name || '')));
        sortedDocuments.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case 'size':
        sortedDocuments.sort((a, b) => {
          const sizeA = getDocumentSizeBytes(a) ?? 0;
          const sizeB = getDocumentSizeBytes(b) ?? 0;
          return sizeB - sizeA;
        });
        break;
      case 'lastModified':
        visibleSubfolders.sort(
          (a, b) => new Date(b.item?.updated_at || b.item?.created_at || 0).getTime() - new Date(a.item?.updated_at || a.item?.created_at || 0).getTime()
        );
        sortedDocuments.sort(
          (a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
        );
        break;
      case 'lastOpened':
      default:
        visibleSubfolders.sort(
          (a, b) => new Date(b.item?.created_at || 0).getTime() - new Date(a.item?.created_at || 0).getTime()
        );
        sortedDocuments.sort(
          (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        break;
    }
    const mappedDocuments = sortedDocuments.map((document) => ({ kind: 'document', item: document }));
    return [...visibleSubfolders, ...mappedDocuments];
  }, [folderDocuments, openedFolderSubfolders, sortBy, folderSearchQuery]);

  const workspaceScopedContainers = useMemo(() => {
    return displayedContainers;
  }, [displayedContainers]);

  useEffect(() => {
    const numericWorkspaceId = Number(selectedWorkspace || workspaceIdFromQuery);
    if (!Number.isFinite(numericWorkspaceId) || numericWorkspaceId <= 0) return;
    if (containerIdParam) return;
    if (workspaceScopedContainers.length > 0) return;
    if (workspaceContainerFetchRef.current.has(numericWorkspaceId)) return;

    workspaceContainerFetchRef.current.add(numericWorkspaceId);

    const fetchWorkspaceContainersFallback = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/v1/workspaces/${numericWorkspaceId}/containers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;

        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        if (!items.length) return;

        setDbContainers((prev) => {
          const byId = new Map((Array.isArray(prev) ? prev : []).map((container) => [Number(container.id), container]));
          items.forEach((container) => {
            byId.set(Number(container.id), {
              ...container,
              type: container?.type || null,
            });
          });
          return Array.from(byId.values());
        });
      } catch (err) {
        console.error('Failed workspace-scoped container fallback fetch:', err);
      }
    };

    fetchWorkspaceContainersFallback();
  }, [selectedWorkspace, workspaceIdFromQuery, containerIdParam, workspaceScopedContainers.length, API_URL]);

  const filteredDisplayedContainers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const isWorkspaceDefaultContainer = (container) => {
      return Boolean(container?.is_workspace_default);
    };

    const getOwnershipType = (container) => {
      const name = String(container?.name ?? '').trim();
      if (name.startsWith('Ada -')) return 'ai';
      const rawType = String(container?.type || '').toLowerCase();
      if (rawType.includes('ai')) return 'ai';
      if (isWorkspaceDefaultContainer(container)) return 'workspace';
      if (currentUserId != null && Number(container?.created_by) === Number(currentUserId)) return 'user';
      return 'workspace';
    };

    return workspaceScopedContainers.filter((container) => {
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
  }, [workspaceScopedContainers, ownerFilter, searchQuery, currentUserId]);

  const containerTreeChildren = useMemo(() => {
    const idSet = new Set(filteredDisplayedContainers.map((container) => String(container.id)));
    const childrenByParent = new Map();

    const pushChild = (parentKey, child) => {
      const existing = childrenByParent.get(parentKey) || [];
      existing.push(child);
      childrenByParent.set(parentKey, existing);
    };

    filteredDisplayedContainers.forEach((container) => {
      const parentId = container.parent_container_id;
      const parentKey =
        parentId != null && idSet.has(String(parentId))
          ? String(parentId)
          : '__ROOT__';
      pushChild(parentKey, container);
    });

    for (const [key, list] of childrenByParent.entries()) {
      childrenByParent.set(
        key,
        [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      );
    }

    return childrenByParent;
  }, [filteredDisplayedContainers]);

  const rootTreeContainers = useMemo(() => {
    return containerTreeChildren.get('__ROOT__') || [];
  }, [containerTreeChildren]);

  const emptyStateMessage = useMemo(() => {
    if (filteredDisplayedContainers.length > 0) {
      return '';
    }

    const hasActiveFilters = Boolean(searchQuery.trim()) || ownerFilter !== 'all';
    if (hasActiveFilters) {
      return 'No folders match your current filters.';
    }

    return 'No folders available yet.';
  }, [filteredDisplayedContainers, searchQuery, ownerFilter]);

  const getContainerParentName = (container) => {
    if (!container.parent_container_id) return null;
    const parent = filteredDisplayedContainers.find((c) => String(c.id) === String(container.parent_container_id));
    return parent?.name || null;
  };

  const renderContainerCard = (container, { depth = 0, showToggle = true } = {}) => {
    const childContainers = containerTreeChildren.get(String(container.id)) || [];
    const hasChildren = childContainers.length > 0;
    const isCollapsed = collapsedContainerIds.has(container.id);
    const isDropTarget = dropTargetContainerId === String(container.id);
    const canDelete = canDeleteContainer(container.id);
    const isUserCreated = canDelete;
    const parentName = viewMode === 'grid' && container.parent_container_id ? getContainerParentName(container) : null;

    return (
      <div
        className={`container-card ${depth > 0 ? 'container-card-child' : ''} ${isUserCreated ? 'user-created' : 'default-workspace'} ${isDropTarget ? 'is-drop-target' : ''}`}
        onClick={() => handleFolderDoubleClick(container)}
        draggable={Number.isFinite(Number(container.id))}
        onDragStart={(event) => {
          setDraggedContainerId(Number(container.id));
          event.dataTransfer.setData('text/plain', String(container.id));
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          setDropTargetContainerId(null);
          setDraggedContainerId(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (Number(container.id) !== Number(draggedContainerId)) {
            setDropTargetContainerId(String(container.id));
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          const movingId = Number(event.dataTransfer.getData('text/plain') || draggedContainerId);
          if (Number.isFinite(movingId)) {
            handleMoveContainer(movingId, Number(container.id));
          }
          setDropTargetContainerId(null);
          setDraggedContainerId(null);
        }}
        style={{
          background: `linear-gradient(90deg, ${hexToRgba(container.color, depth > 0 ? 0.05 : 0.06)}, ${hexToRgba(container.color, depth > 0 ? 0.02 : 0.03)})`,
          borderColor: hexToRgba(container.color, 0.12),
          cursor: 'pointer'
        }}
      >
        <div className="container-left">
          <span className="container-drag-handle" title="Drag to move folder" aria-hidden="true">
            <GripVertical size={14} />
          </span>
          {showToggle && hasChildren ? (
            <button
              type="button"
              className="container-tree-toggle"
              onClick={(event) => {
                event.stopPropagation();
                handleToggleContainerCollapse(container.id);
              }}
              title={isCollapsed ? 'Expand subfolders' : 'Collapse subfolders'}
              aria-label={isCollapsed ? 'Expand subfolders' : 'Collapse subfolders'}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : showToggle ? (
            <span className="container-tree-toggle-spacer" aria-hidden="true" />
          ) : null}
          <div className="container-icon" style={{ background: hexToRgba(container.color, 0.18), borderColor: hexToRgba(container.color, 0.28) }}>
            <Folder size={18} />
          </div>
          <div className="container-wrapper">
            <div className="container-name">{container.name}</div>
            <span className={`container-origin ${parentName ? 'container-origin-subfolder' : ''}`}>
              {parentName ? `Subfolder of ${parentName}` : getContainerCreatorLabel(container)}
            </span>
          </div>
        </div>
        {isUserCreated && (
          <button
            type="button"
            className="container-delete-btn"
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteContainer(container.id);
            }}
            aria-label={`Delete ${container.name}`}
            title="Delete folder"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  const renderContainerTreeNode = (container, depth = 0) => {
    const childContainers = containerTreeChildren.get(String(container.id)) || [];
    const hasChildren = childContainers.length > 0;
    const isCollapsed = collapsedContainerIds.has(container.id);

    return (
      <div key={container.id} className="container-tree-node" style={{ paddingLeft: depth > 0 ? `${depth * 18}px` : undefined }}>
        {renderContainerCard(container, { depth, showToggle: true })}
        {!isCollapsed && hasChildren && (
          <div className="container-tree-children">
            {childContainers.map((child) => renderContainerTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const flattenContainerTree = (containers) => {
    const result = [];
    const walk = (list, depth) => {
      for (const container of list) {
        result.push({ container, depth });
        const children = containerTreeChildren.get(String(container.id)) || [];
        if (children.length > 0) walk(children, depth + 1);
      }
    };
    walk(containers, 0);
    return result;
  };

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
    setSelectedFolders(new Set());
    setAutoOrganizeReport(null);
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

  const isAdaCreatedContainer = (container) => {
    const name = String(container?.name ?? '').trim();
    return name.startsWith('Ada -');
  };

  const isUserCreatedContainer = (containerId) => {
    return displayedContainers.some((container) => {
      const sameId = String(container.id) === String(containerId);
      const isWorkspaceDefault = Boolean(container?.is_workspace_default);
      const isOwnedByCurrentUser =
        currentUserId != null && Number(container?.created_by) === Number(currentUserId);
      return sameId && isOwnedByCurrentUser && !isWorkspaceDefault;
    });
  };

  const canDeleteContainer = (containerId) => {
    const container = displayedContainers.find((c) => String(c.id) === String(containerId));
    if (!container) return false;
    if (Boolean(container?.is_workspace_default)) return false;
    return isUserCreatedContainer(containerId);
  };

  const getContainerCreatorLabel = (container) => {
    if (isAdaCreatedContainer(container)) return 'Created by Ada';
    const rawType = String(container?.type || '').toLowerCase();
    const isWorkspaceDefault = Boolean(container?.is_workspace_default);
    if (rawType.includes('ai')) return 'Created by Ada';
    if (isWorkspaceDefault) return 'Belongs to workspace';
    if (currentUserId != null && Number(container?.created_by) === Number(currentUserId)) {
      return 'Created by you';
    }
    if (container?.created_by_username) {
      return `Created by ${container.created_by_username}`;
    }
    return 'Belongs to workspace';
  };

  const colorInputRef = useRef(null);
  const totalSelectedFolderItems = selectedDocuments.size + selectedFolders.size;

    // RENDER FOLDER VIEW - ADD THIS BEFORE THE MAIN VIEW
  if (openedFolder) {
    return (
      <div className="folder-view-container">
        {/* Folder Header */}
        <div className="folder-header">
          <div className="folder-header-left">
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
        </div>

        <div className="folder-breadcrumbs" aria-label="Folder path">
          <button
            type="button"
            className="folder-breadcrumb"
            onClick={() => {
              setOpenedFolder(null);
              setFolderDocuments([]);
              setAutoOrganizeReport(null);
              setFolderSearchQuery('');
              setSelectedDocuments(new Set());
              setSelectedFolders(new Set());
              setSortBy('lastOpened');
              setShowCreateContainer(false);
              setCreateContainerParentId(null);
              navigate('/documents');
            }}
          >
            All folders
          </button>
          {openedFolderPath.length > 1 && openedFolderPath.slice(0, -1).map((folder) => (
            <React.Fragment key={`breadcrumb-${folder.id}`}>
              <span className="folder-breadcrumb-separator" aria-hidden="true">
                <ChevronRight size={14} />
              </span>
              <button
                type="button"
                className="folder-breadcrumb"
                onClick={() => {
                  setSelectedDocuments(new Set());
                  setSelectedFolders(new Set());
                  setAutoOrganizeReport(null);
                  setFolderSearchQuery('');
                  setSortBy('lastOpened');
                  setShowCreateContainer(false);
                  setCreateContainerParentId(null);
                  navigate(`/documents/${folder.id}`);
                }}
              >
                {folder.name}
              </button>
            </React.Fragment>
          ))}
          {(() => {
            const wsId = openedFolder?.workspace_id;
            const ws = wsId ? workspaces.find((w) => Number(w.id) === Number(wsId)) : null;
            if (!ws) return null;
            return (
              <>
                <span className="folder-breadcrumb-dot" aria-hidden="true">&middot;</span>
                <button
                  type="button"
                  className="folder-breadcrumb folder-breadcrumb-workspace"
                  onClick={() => navigate(`/workspace/${ws.id}`)}
                  title={`Go to ${ws.name}`}
                >
                  {ws.name}
                </button>
              </>
            );
          })()}
        </div>

        {successMessage && (
          <div className="folder-success-toast" role="status" aria-live="polite">
            {successMessage}
          </div>
        )}

        {error && (
          <div className="folder-error-toast" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="folder-toast-dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Folder Content */}
        <div className="folder-content">
          {totalSelectedFolderItems > 0 && (
            <div className="bulk-actions-bar folder-bulk-actions">
              <span>{totalSelectedFolderItems} selected</span>
              <div className="folder-bulk-actions-controls">
                <select
                  className="folder-move-select"
                  value={moveTargetSubfolderId}
                  onChange={(event) => setMoveTargetSubfolderId(event.target.value)}
                  disabled={movingDocuments || selectedDocuments.size === 0 || openedFolderSubfolders.length === 0}
                  aria-label="Choose a subfolder to move selected documents"
                >
                  <option value="">Move to subfolder...</option>
                  {openedFolderSubfolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                <button
                  className="action-btn"
                  onClick={handleMoveSelectedToSubfolder}
                  disabled={movingDocuments || selectedDocuments.size === 0 || !moveTargetSubfolderId || openedFolderSubfolders.length === 0}
                  title={selectedDocuments.size === 0 ? 'Select one or more documents to move' : openedFolderSubfolders.length === 0 ? 'Create a subfolder first' : 'Move selected documents to chosen subfolder'}
                >
                  <Folder size={18} />
                  {movingDocuments ? 'Moving…' : 'Move'}
                </button>
                <button 
                  className="action-btn delete-btn"
                  onClick={handleBulkDeleteFolderDocuments}
                  title="Delete selected items"
                  disabled={movingDocuments}
                >
                  <Trash2 size={18} />
                  Delete Selected
                </button>
              </div>
            </div>
          )}

          <div className="folder-top-toolbar">
            <div className="folder-primary-actions">
              <button
                type="button"
                className="new-document-btn"
                onClick={() => {
                  setSelectedWorkspace(Number(openedFolder.workspace_id || ''));
                  setShowUploadModal(true);
                }}
                title="Upload document"
                aria-label="Upload document"
              >
                <Upload size={20} />
              </button>
              <button
                type="button"
                className="new-document-btn subfolder-btn"
                onClick={() => {
                  setCreateContainerParentId(Number(openedFolder?.id));
                  setShowCreateContainer((prev) => !prev);
                }}
                title="New subfolder"
                aria-label="Create a subfolder inside this folder"
              >
                <FolderPlus size={20} />
              </button>
              <button
                type="button"
                className="new-document-btn auto-organize-btn"
                onClick={handleAutoOrganizeWorkspace}
                disabled={autoOrganizing || !openedFolder?.workspace_id}
                title={openedFolder?.workspace_id ? 'Suggest organize' : 'Auto-organize is only available for workspace folders'}
                aria-label={autoOrganizing ? 'Analyzing…' : 'Suggest organize'}
              >
                <Sparkles size={20} />
              </button>
            </div>
            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                placeholder="Search documents..."
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
              />
            </div>
            <div className="folder-toolbar-right">
              <div className="sort-dropdown-wrapper">
                <button className="sort-button" onClick={() => { setShowSortMenu(!showSortMenu); setShowFolderOptionsMenu(false); }}>
                  Sort by
                  <ChevronDown size={16} />
                </button>
                {showSortMenu && (
                  <div className="sort-menu">
                    <button className={`sort-option ${sortBy === 'lastOpened' ? 'active' : ''}`} onClick={() => { setSortBy('lastOpened'); setShowSortMenu(false); }}>✓ Last opened</button>
                    <button className={`sort-option ${sortBy === 'name' ? 'active' : ''}`} onClick={() => { setSortBy('name'); setShowSortMenu(false); }}>{sortBy === 'name' && '✓ '}Name</button>
                    <button className={`sort-option ${sortBy === 'size' ? 'active' : ''}`} onClick={() => { setSortBy('size'); setShowSortMenu(false); }}>{sortBy === 'size' && '✓ '}Size</button>
                    <button className={`sort-option ${sortBy === 'lastModified' ? 'active' : ''}`} onClick={() => { setSortBy('lastModified'); setShowSortMenu(false); }}>{sortBy === 'lastModified' && '✓ '}Date modified</button>
                  </div>
                )}
              </div>
              <div className="folder-options-menu-wrapper" ref={folderOptionsMenuRef}>
              <button
                type="button"
                className="folder-options-trigger"
                onClick={(e) => { e.stopPropagation(); setShowFolderOptionsMenu((v) => !v); setShowSortMenu(false); }}
                aria-label="Folder and table options"
                aria-expanded={showFolderOptionsMenu}
              >
                <MoreVertical size={20} />
              </button>
              {showFolderOptionsMenu && (
                <div className="folder-options-menu" role="menu">
                  <div className="folder-options-menu-section folder-options-menu-section--label">Display columns</div>
                  {[
                    { key: 'name', label: 'Name' },
                    { key: 'size', label: 'Size' },
                    { key: 'status', label: 'Status' },
                    { key: 'lastModified', label: 'Last modified' },
                    { key: 'dateCreated', label: 'Date created' },
                    { key: 'owner', label: 'Owner' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`folder-options-menu-item ${visibleColumns[key] ? 'is-checked' : ''}`}
                      role="menuitemcheckbox"
                      aria-checked={!!visibleColumns[key]}
                      onClick={(e) => { e.stopPropagation(); toggleColumn(key); }}
                    >
                      {visibleColumns[key] ? <Check size={16} /> : <span className="folder-options-menu-check-placeholder" />}
                      <span>{label}</span>
                    </button>
                  ))}
                  {canDeleteContainer(openedFolder?.id) && (
                    <>
                      <div className="folder-options-menu-divider" />
                      <button
                        type="button"
                        className="folder-options-menu-item folder-options-menu-item--danger"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowFolderOptionsMenu(false);
                          if (window.confirm(`Delete ${openedFolder?.name}?`)) {
                            handleDeleteContainer(openedFolder.id);
                            handleBackFromFolder();
                          }
                        }}
                      >
                        <Trash2 size={16} />
                        <span>Delete folder</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>

          {showCreateContainer && Number(createContainerParentId) === Number(openedFolder?.id) && (
            <div className="folder-create-panel-wrap">
              <div className="create-container-panel folder-create-subfolder-panel" role="region" aria-label="Create subfolder panel">
                <div className="panel-header">
                  <strong>Create Subfolder</strong>
                  <button
                    className="panel-close"
                    onClick={() => {
                      setShowCreateContainer(false);
                      setCreateContainerParentId(null);
                    }}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="create-container-note">
                  This subfolder will be created inside <strong>{openedFolder.name}</strong>.
                </p>

                <form onSubmit={handleCreateContainer}>
                  <div className="form-group">
                    <label htmlFor="subfolder-name">Name</label>
                    <input
                      id="subfolder-name"
                      type="text"
                      value={containerName}
                      onChange={(e) => setContainerName(e.target.value)}
                      placeholder="e.g., Nigerian Dishes"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Pick color</label>
                    <ColorSwatchPicker
                      className="color-swatches"
                      colors={CONTAINER_SWATCH_PRESETS}
                      value={containerColor}
                      onChange={setContainerColor}
                      ariaLabel="Subfolder color options"
                      optionAriaLabelPrefix="Select color"
                      customAriaLabel="Choose custom color from wheel"
                      customTitle="Click to open color picker"
                    />
                  </div>

                  <div className="panel-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowCreateContainer(false);
                        setCreateContainerParentId(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary">Create Subfolder</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {autoOrganizeReport && (
            <section className="auto-organize-report" aria-live="polite">
              <div className="auto-organize-report-header">
                <h3>{autoOrganizeReport.mode === 'preview' ? 'Ada Organization Suggestions' : 'Last Applied Organization Run'}</h3>
                <span>{new Date(autoOrganizeReport.ranAt).toLocaleString()}</span>
              </div>

              <div className="auto-organize-report-stats">
                <span>{autoOrganizeReport.considered} scanned</span>
                <span>{autoOrganizeReport.moved} moved</span>
                <span>{autoOrganizeReport.skipped_already_organized} already organized</span>
                <span>{autoOrganizeReport.skipped_low_confidence} low confidence</span>
                <span>{autoOrganizeReport.skipped_no_suggestion} no suggestion</span>
                {Number.isFinite(autoOrganizeReport.average_confidence_score) && (
                  <span>avg confidence {autoOrganizeReport.average_confidence_score}</span>
                )}
                {Number.isFinite(autoOrganizeReport.trend_from_previous_run) && (
                  <span>
                    trend {autoOrganizeReport.trend_from_previous_run > 0 ? '+' : ''}
                    {autoOrganizeReport.trend_from_previous_run}
                  </span>
                )}
                {autoOrganizeReport.boosted_moves > 0 && (
                  <span>{autoOrganizeReport.boosted_moves} boost-informed</span>
                )}
              </div>

              <div className="auto-organize-before-after">
                Current folder items: {autoOrganizeReport.folder_before_count} before, {autoOrganizeReport.folder_after_count} after.
              </div>

              {autoOrganizeReport.mode === 'preview' && autoOrganizeReport.moved_documents.length > 0 && (
                <div className="auto-organize-report-actions">
                  <button
                    type="button"
                    className="auto-organize-apply-btn"
                    onClick={handleApplyAutoOrganizeSuggestions}
                    disabled={autoOrganizing}
                  >
                    {autoOrganizing ? 'Applying…' : 'Accept Ada Changes'}
                  </button>
                </div>
              )}

              {autoOrganizeReport.moved_documents.length > 0 ? (
                <ul className="auto-organize-moves">
                  {autoOrganizeReport.moved_documents.map((move) => (
                    <li key={move.document_id}>
                      <strong>{move.filename}</strong>
                      <span>{move.from_container_name} → {move.to_container_name}</span>
                      <em>
                        {move.confidence}
                        {Number.isFinite(move.confidence_score) ? ` (${move.confidence_score})` : ''}
                        {move.boost_applied ? ' +boost' : ''}
                      </em>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="auto-organize-no-moves">No documents were moved in this run.</p>
              )}
            </section>
          )}

          <div className="folder-main-content">
          {/* Folder Documents List */}
          <main className="folder-main">
            <div className="documents-table">
              <div className="table-header folder-table-header" style={folderTableGridStyle}>
                {folderTableColumnConfig.map((c) => (
                  <div key={c.key} className={`col-${c.key === 'icon' ? 'icon' : c.key === 'actions' ? 'actions' : c.key}`}>
                    {c.label ?? ''}
                  </div>
                ))}
              </div>
                {folderTableEntries.map((entry) => {
                if (entry.kind === 'folder') {
                  const folder = entry.item;
                  const canDeleteFolder = canDeleteContainer(folder.id);
                  return (
                    <div
                      key={`folder-${folder.id}`}
                      className={`table-row table-row-folder ${selectedFolders.has(folder.id) ? 'is-selected' : ''}`}
                      style={folderTableGridStyle}
                      onClick={() => handleFolderDoubleClick(folder)}
                    >
                      {folderTableColumnConfig.map((c) => {
                        if (c.key === 'icon') return <div key={c.key} className="col-icon"><input type="checkbox" checked={selectedFolders.has(folder.id)} onClick={(e) => e.stopPropagation()} onChange={() => handleFolderCheckboxChange(folder.id)} title={`Select ${folder.name}`} aria-label={`Select ${folder.name}`} /></div>;
                        if (c.key === 'name') return <div key={c.key} className="col-name"><div className="doc-name-main doc-name-main--folder">{folder.name}</div></div>;
                        if (c.key === 'size') return <div key={c.key} className="col-size">-</div>;
                        if (c.key === 'status') return <div key={c.key} className="col-status"><span className="document-status document-status--tag folder">Folder</span></div>;
                        if (c.key === 'lastModified') return <div key={c.key} className="col-modified">{folder.created_at ? new Date(folder.created_at).toLocaleDateString() : '-'}</div>;
                        if (c.key === 'dateCreated') return <div key={c.key} className="col-date-created">{folder.created_at ? new Date(folder.created_at).toLocaleDateString() : '-'}</div>;
                        if (c.key === 'owner') return <div key={c.key} className="col-owner">—</div>;
                        if (c.key === 'actions') return <div key={c.key} className="col-actions">{canDeleteFolder && <button type="button" className="action-menu delete-btn" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete ${folder.name}?`)) handleDeleteContainer(folder.id); }} title="Delete subfolder" aria-label={`Delete ${folder.name}`}><Trash2 size={18} /></button>}</div>;
                        return null;
                      })}
                    </div>
                  );
                }

                const doc = entry.item;
                const statusDisplay = getDocumentStatusDisplay(doc);
                const isRetryingIndex = retryingDocIds.has(doc.id);
                const canRetryIndexing = statusDisplay.statusKey === 'failed' || statusDisplay.statusKey === 'processing' || statusDisplay.statusKey === 'uploaded';
                return (
                  <div
                    key={doc.id}
                    className={`table-row ${selectedDocuments.has(doc.id) ? 'is-selected' : ''}`}
                    style={folderTableGridStyle}
                    onClick={() => handleCheckboxChange(doc.id)}
                  >
                    {folderTableColumnConfig.some((c) => c.key === 'icon') && (
                      <div className="col-icon">
                        <input type="checkbox" checked={selectedDocuments.has(doc.id)} onClick={(e) => e.stopPropagation()} onChange={() => handleCheckboxChange(doc.id)} title="Select document" aria-label={`Select ${doc.filename}`} />
                      </div>
                    )}
                    {folderTableColumnConfig.some((c) => c.key === 'name') && (
                    <div className="col-name">
                      <div className="doc-name-main">{doc.filename}</div>
                      {suggestionsByDoc[doc.id] && (
                        <div className="doc-suggestion-line">
                          {suggestionsByDoc[doc.id].suggested_container_id ? (
                            <>
                              <div className="doc-suggestion-row">
                                <span>
                                  Ada suggests: {suggestionsByDoc[doc.id].suggested_container_name}
                                  {' '}({suggestionsByDoc[doc.id].confidence}
                                  {Number.isFinite(Number(suggestionsByDoc[doc.id].confidence_score))
                                    ? ` ${Number(suggestionsByDoc[doc.id].confidence_score).toFixed(3)}`
                                    : ''}
                                  {suggestionsByDoc[doc.id].boost_applied ? ' +boost' : ''})
                                </span>
                                {Number(suggestionsByDoc[doc.id].suggested_container_id) !== Number(openedFolder?.id) && (
                                  <button
                                    type="button"
                                    className="suggestion-apply-btn"
                                    disabled={applyingSuggestionIds.has(doc.id)}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleApplySuggestion(doc, suggestionsByDoc[doc.id]);
                                    }}
                                  >
                                    {applyingSuggestionIds.has(doc.id) ? 'Applying…' : 'Apply'}
                                  </button>
                                )}
                                {openedFolderSubfolders.length > 0 && (
                                  <>
                                    <label className="suggestion-move-label" htmlFor={`move-to-${doc.id}`}>
                                      Move to:
                                    </label>
                                    <select
                                      id={`move-to-${doc.id}`}
                                      className="suggestion-move-select"
                                      value=""
                                      disabled={applyingSuggestionIds.has(doc.id)}
                                      onChange={(event) => {
                                        event.stopPropagation();
                                        const val = event.target.value;
                                        if (val) {
                                          handleCorrectSuggestion(doc, suggestionsByDoc[doc.id], val);
                                          event.target.value = '';
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label={`Move ${doc.filename} to another folder`}
                                    >
                                      <option value="">Choose folder…</option>
                                      {openedFolderSubfolders.map((folder) => (
                                        <option key={folder.id} value={folder.id}>
                                          {folder.name}
                                        </option>
                                      ))}
                                    </select>
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="suggestion-dismiss-btn"
                                  disabled={applyingSuggestionIds.has(doc.id)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDismissSuggestion(doc.id);
                                  }}
                                  aria-label={`Dismiss suggestion for ${doc.filename}`}
                                >
                                  Dismiss
                                </button>
                              </div>
                              {suggestionsByDoc[doc.id].suggested_new_container_name && openedFolder?.id && openedFolder?.workspace_id && (
                                <div className="doc-suggestion-create-row">
                                  <button
                                    type="button"
                                    className="suggestion-apply-btn suggestion-create-new-btn"
                                    disabled={applyingSuggestionIds.has(doc.id)}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleCreateSuggestedSubfolderAndMove(doc, suggestionsByDoc[doc.id]);
                                    }}
                                    title={`Create subfolder "${suggestionsByDoc[doc.id].suggested_new_container_name}" and move document`}
                                    aria-label={`Create subfolder ${suggestionsByDoc[doc.id].suggested_new_container_name} and move ${doc.filename}`}
                                  >
                                    {applyingSuggestionIds.has(doc.id) ? 'Creating…' : `Create "${suggestionsByDoc[doc.id].suggested_new_container_name}" & move`}
                                  </button>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="doc-suggestion-row">
                                <span>{suggestionsByDoc[doc.id].reason}</span>
                              </div>
                              {suggestionsByDoc[doc.id].suggested_new_container_name && openedFolder?.id && openedFolder?.workspace_id && (
                                <div className="doc-suggestion-create-row">
                                  <button
                                    type="button"
                                    className="suggestion-apply-btn suggestion-create-new-btn"
                                    disabled={applyingSuggestionIds.has(doc.id)}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleCreateSuggestedSubfolderAndMove(doc, suggestionsByDoc[doc.id]);
                                    }}
                                    title={`Create subfolder "${suggestionsByDoc[doc.id].suggested_new_container_name}" and move document`}
                                  >
                                    {applyingSuggestionIds.has(doc.id) ? 'Creating…' : `Create "${suggestionsByDoc[doc.id].suggested_new_container_name}" & move`}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    )}
                    {folderTableColumnConfig.some((c) => c.key === 'size') && <div className="col-size">{formatBytes(getDocumentSizeBytes(doc))}</div>}
                    {folderTableColumnConfig.some((c) => c.key === 'status') && (
                      <div className="col-status">
                        <span className={`document-status document-status--tag ${statusDisplay.statusKey}`} title={statusDisplay.detail || undefined} aria-label={`Status: ${statusDisplay.label}${statusDisplay.detail ? `. ${statusDisplay.detail}` : ''}`}>
                          {statusDisplay.label}
                        </span>
                      </div>
                    )}
                    {folderTableColumnConfig.some((c) => c.key === 'lastModified') && <div className="col-modified">{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '-'}</div>}
                    {folderTableColumnConfig.some((c) => c.key === 'dateCreated') && <div className="col-date-created">{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '-'}</div>}
                    {folderTableColumnConfig.some((c) => c.key === 'owner') && <div className="col-owner">{doc.uploaded_by === currentUserId ? 'You' : (doc.uploaded_by_username || '—')}</div>}
                    {folderTableColumnConfig.some((c) => c.key === 'actions') && (
                    <div className="col-actions" ref={openDocMenuId === doc.id ? docMenuRef : null}>
                      <button
                        type="button"
                        className="action-menu doc-row-menu-trigger"
                        onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(openDocMenuId === doc.id ? null : doc.id); }}
                        aria-label={`Actions for ${doc.filename}`}
                        aria-expanded={openDocMenuId === doc.id}
                      >
                        <MoreVertical size={18} />
                      </button>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="pagination">
              <span>
                {folderTableEntries.length > 0
                  ? `1 - ${folderTableEntries.length} of ${folderTableEntries.length}`
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

        {openDocMenuId && docMenuPosition && (() => {
          const doc = folderTableEntries.find((e) => e.kind === 'document' && e.item.id === openDocMenuId)?.item;
          if (!doc) return null;
          const statusDisplay = getDocumentStatusDisplay(doc);
          const isRetryingIndex = retryingDocIds.has(doc.id);
          const canRetryIndexing = statusDisplay.statusKey === 'failed' || statusDisplay.statusKey === 'processing' || statusDisplay.statusKey === 'uploaded';
          return createPortal(
            <div
              ref={docMenuPortalRef}
              className="doc-row-context-menu doc-row-context-menu--portal"
              style={{ position: 'fixed', top: docMenuPosition.top, right: docMenuPosition.right }}
              role="menu"
            >
              {canRetryIndexing && (
                <button
                  type="button"
                  className="doc-row-menu-item"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(null); handleRetryIndexing(doc, e); }}
                  disabled={isRetryingIndex}
                >
                  <RotateCcw size={16} className={isRetryingIndex ? 'spin' : ''} />
                  <span>{isRetryingIndex ? 'Restarting…' : (statusDisplay.statusKey === 'failed' ? 'Retry indexing' : 'Restart indexing')}</span>
                </button>
              )}
              <button
                type="button"
                className="doc-row-menu-item"
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(null); handleDocumentDoubleClick(doc); }}
              >
                <Eye size={16} />
                <span>Preview</span>
              </button>
              <button
                type="button"
                className="doc-row-menu-item"
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(null); handleDownloadDocument(doc.id, doc.filename); }}
              >
                <Download size={16} />
                <span>Download</span>
              </button>
              <button
                type="button"
                className="doc-row-menu-item"
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(null); handleSuggestContainer(doc); }}
                disabled={suggestingDocIds.has(doc.id)}
              >
                <Folder size={16} />
                <span>Suggest destination folder</span>
              </button>
              {openedFolder?.id && openedFolder?.workspace_id && (
                <button
                  type="button"
                  className="doc-row-menu-item"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(null); handleCreateSubfolderForDocument(doc); }}
                  disabled={suggestingDocIds.has(doc.id) || applyingSuggestionIds.has(doc.id)}
                >
                  <FolderPlus size={16} />
                  <span>{applyingSuggestionIds.has(doc.id) ? 'Creating…' : 'Create subfolder & move'}</span>
                </button>
              )}
              <div className="doc-row-menu-divider" />
              {doc.uploaded_by === currentUserId ? (
                <button
                  type="button"
                  className="doc-row-menu-item doc-row-menu-item--danger"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(null); handleDeleteFolderDocument(doc.id); }}
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
                          ) : (
                            <button
                              type="button"
                              className="doc-row-menu-item doc-row-menu-item--danger"
                              role="menuitem"
                              onClick={(e) => { e.stopPropagation(); setOpenDocMenuId(null); handleRequestDeletion(doc.id, doc.filename); }}
                              disabled={requestingDeletionId === doc.id}
                            >
                              <Trash2 size={16} />
                              <span>{requestingDeletionId === doc.id ? 'Sending…' : 'Request deletion'}</span>
                            </button>
                          )}
            </div>,
            document.body
          );
        })()}

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
                        const maxFiles = 50;
                        if (combined.length > maxFiles) {
                          setError(`You can select up to ${maxFiles} documents per upload`);
                          setUploadFiles(combined.slice(0, maxFiles));
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
                        <h4>Selected Files ({uploadFiles.length}/50):</h4>
                        {uploadFiles.length === 50 && (
                          <span className="limit-reached-badge">Limit reached</span>
                        )}
                      </div>
                      <ul>
                        {uploadFiles.map((file, idx) => (
                          <li key={idx} className="file-item">
                            <span className="file-name" title={file.name}>{file.name}</span>
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
                    disabled={uploadFiles.length === 0 || !((openedFolder?.id && !openedFolder?.workspace_id) || (openedFolder?.workspace_id || selectedWorkspace)) || uploading}
                  >
                    {uploading ? `Uploading ${Object.values(uploadProgress).filter(p => p === 100).length}/${uploadFiles.length}...` : `Upload (${uploadFiles.length}/50)`}
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

  if (workspaceIdFromQuery && error && isWorkspaceAccessErrorMessage(error)) {
    return (
      <div className="documents-page">
        <AccessState
          title="Workspace unavailable"
          message="We couldn’t open documents for this workspace. It may not exist, or you may not have access."
          primaryLabel="View Workspaces"
          primaryTo="/workspace"
        />
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
                    <option value="ai">Ada-Created</option>
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
              onClick={() => {
                setCreateContainerParentId(null);
                setShowCreateContainer(true);
              }}
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
                    <ColorSwatchPicker
                      className="color-swatches"
                      colors={CONTAINER_SWATCH_PRESETS}
                      value={containerColor}
                      onChange={setContainerColor}
                      ariaLabel="Container color options"
                      optionAriaLabelPrefix="Select color"
                      customAriaLabel="Choose custom color from wheel"
                      customTitle="Click to open color picker"
                    />
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
                      const maxFilesUpload = 50;
                      if (combined.length > maxFilesUpload) {
                        setError(`You can select up to ${maxFilesUpload} documents per upload`);
                        setUploadFiles(combined.slice(0, maxFilesUpload));
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
                        <h4>Selected Files ({uploadFiles.length}/50):</h4>
                        {uploadFiles.length === 50 && (
                          <span className="limit-reached-badge">Limit reached</span>
                        )}
                      </div>
                      <ul>
                        {uploadFiles.map((file, idx) => (
                          <li key={idx} className="file-item">
                            <span className="file-name" title={file.name}>{file.name}</span>
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
                  disabled={uploadFiles.length === 0 || !((openedFolder?.id && !openedFolder?.workspace_id) || (openedFolder?.workspace_id || selectedWorkspace)) || uploading}
                >
                  {uploading ? `Uploading ${Object.values(uploadProgress).filter(p => p === 100).length}/${uploadFiles.length}...` : `Upload (${uploadFiles.length}/50)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Container Dropdown Panel is rendered inline in the sidebar (see sidebar area) */}

      
            {/* Containers / Cards Grid (design) */}
      <div className={`container-grid container-grid-${viewMode}`}>
              <div
                className={`container-drag-hint ${draggedContainerId != null ? 'container-drag-hint-droppable' : ''} ${dropTargetContainerId === 'ROOT' ? 'is-drop-target' : ''}`}
                onDragOver={(event) => {
                  if (draggedContainerId == null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTargetContainerId('ROOT');
                }}
                onDragLeave={() => {
                  if (dropTargetContainerId === 'ROOT') setDropTargetContainerId(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const movingId = Number(event.dataTransfer.getData('text/plain') || draggedContainerId);
                  if (Number.isFinite(movingId)) {
                    handleMoveContainer(movingId, null);
                  }
                  setDropTargetContainerId(null);
                  setDraggedContainerId(null);
                }}
              >
                {draggedContainerId != null ? (
                  <>Drop here to move folder to top level</>
                ) : (
                  <>Tip: drag a folder onto another folder to nest it. Drop on this area to unnest.</>
                )}
              </div>
              {viewMode === 'grid'
                ? flattenContainerTree(rootTreeContainers).map((node) => (
                    <div key={node.container.id} className="container-tree-node">
                      {renderContainerCard(node.container, { depth: node.depth, showToggle: false })}
                    </div>
                  ))
                : rootTreeContainers.map((c) => renderContainerTreeNode(c, 0))
              }
        {filteredDisplayedContainers.length === 0 && (
          <p className="empty-state-text">{emptyStateMessage}</p>
        )}
      </div>

        </main>
      </div>
    </div>
  );
}

export default Documents;
