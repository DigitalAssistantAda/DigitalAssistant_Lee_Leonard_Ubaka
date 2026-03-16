import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiClient';
import LoadingState from '../LoadingState';

export default function PdfPreview({ docId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const urlRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const blob = await apiFetch(`/api/v1/documents/${docId}/preview`, { responseType: 'blob' });
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setPdfUrl(urlRef.current);
      } catch (err) {
        setError(err.message || 'Failed to load PDF');
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [docId]);

  if (loading) return <LoadingState className="preview-loading" message="Loading preview..." size={32} />;
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
