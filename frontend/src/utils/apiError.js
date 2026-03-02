export const parseApiErrorMessage = (data, fallback) => {
  if (data?.error?.message) {
    return data.error.message;
  }
  if (typeof data?.detail === 'string' && data.detail.trim()) {
    return data.detail;
  }
  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message;
  }
  return fallback;
};

export const getApiErrorMessage = async (response, fallback = 'Something went wrong.') => {
  if (!response) {
    return fallback;
  }
  try {
    const data = await response.json();
    return parseApiErrorMessage(data, fallback);
  } catch {
    try {
      const text = await response.text();
      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    } catch {
      // no-op: fall through to status-based fallback
    }
    if (response.status) {
      return `${fallback} (HTTP ${response.status})`;
    }
    return fallback;
  }
};

export const isWorkspaceAccessErrorMessage = (message) => {
  const value = String(message || '').toLowerCase();
  if (!value) return false;
  return (
    value.includes('workspace not found or you do not have access')
    || value.includes('do not have permission to perform this action in this workspace')
    || value.includes('workspace not found')
  );
};
