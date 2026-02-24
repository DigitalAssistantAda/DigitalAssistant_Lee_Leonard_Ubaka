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
    return fallback;
  }
};
