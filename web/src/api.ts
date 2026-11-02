import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message = `Request failed with status ${status}`) {
    super(message);
  }
}

type Loaded<T> =
  | { status: 'loading' }
  | { status: 'failed'; error: unknown }
  | { status: 'ready'; data: T };

interface Refresh<T> {
  refreshMs: number;
  // Refreshing stops once this is true
  until: (data: T) => boolean;
}

// Loads again when the path changes, and ignores answers to an older path. Refreshing keeps
// the current data on screen, also if a refresh fails.
export const useApi = <T,>(path: string, refresh?: Refresh<T>) => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const isRefresh = loadedPath.current === path;
    if (!isRefresh) setLoaded({ status: 'loading' });

    fetch(path, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new ApiError(response.status);
        const data = await response.json();
        loadedPath.current = path;
        setLoaded({ status: 'ready', data });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isRefresh) setLoaded({ status: 'failed', error });
      });

    return () => controller.abort();
  }, [path, version]);

  const reload = useCallback(() => setVersion(current => current + 1), []);

  const refreshMs = refresh?.refreshMs;
  const isDone = loaded.status === 'ready' && refresh?.until(loaded.data);

  useEffect(() => {
    if (!refreshMs || isDone) return;
    const timer = setInterval(reload, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, isDone, reload]);

  return { ...loaded, reload };
};

// Throws an ApiError with the server's explanation
export const postJson = async <T,>(path: string, key: string, body?: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  const answer = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, answer?.error);
  return answer;
};
