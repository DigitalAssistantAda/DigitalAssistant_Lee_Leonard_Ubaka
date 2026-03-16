import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/apiClient';
import LoadingState from '../LoadingState';

export default function TxtPreview({ docId }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const text = await apiFetch(`/api/v1/documents/${docId}/content`, { responseType: 'text' });
        setContent(text);
      } catch (err) {
        setError(err.message || 'Failed to load preview');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docId]);

  if (loading) return <LoadingState className="preview-loading" message="Loading preview..." size={32} />;
  if (error) return <div className="preview-error">{error}</div>;

  return (
    <pre className="txt-preview">
      {content}
    </pre>
  );
}
