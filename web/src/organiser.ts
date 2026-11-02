import { useState } from 'react';
import { ApiError } from './api';

const STORAGE_KEY = 'organiser-key';

// Kept only until the tab closes. Storage can be blocked, and then the key is simply typed again.
const read = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

const write = (key: string) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Works for this page anyway
  }
};

export const useOrganiserKey = () => {
  const [key, setKey] = useState(read);

  const change = (value: string) => {
    setKey(value);
    write(value);
  };

  return [key, change] as const;
};

export const organiserError = (error: unknown) => {
  if (!(error instanceof ApiError)) return 'The server could not be reached.';
  if (error.status === 401) return 'Wrong organiser key.';
  if (error.status === 403) return 'This server has no organiser key. Set ADMIN_KEY to use this.';
  return error.message;
};
