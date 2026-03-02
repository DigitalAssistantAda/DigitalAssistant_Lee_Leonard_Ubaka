import { getApiErrorMessage } from './apiError';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export async function apiFetch(
  path,
  {
    method = 'GET',
    body,
    headers = {},
    auth = true,
    responseType = 'json',
  } = {},
) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;

  const finalHeaders = { ...headers };

  if (auth) {
    const token = localStorage.getItem('token');
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  let finalBody = body;
  if (body && !(body instanceof FormData) && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: finalBody,
  });

  if (!response.ok) {
    const message = await getApiErrorMessage(response, 'Request failed');
    throw new Error(message);
  }

  if (responseType === 'json') {
    return response.json();
  }
  if (responseType === 'text') {
    return response.text();
  }
  if (responseType === 'blob') {
    return response.blob();
  }

  return response;
}

