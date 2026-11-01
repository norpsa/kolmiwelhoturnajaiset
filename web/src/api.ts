import { useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number) {
    super(`Request failed with status ${status}`);
  }
}

type Loaded<T> =
  | { status: 'loading' }
  | { status: 'failed'; error: unknown }
  | { status: 'ready'; data: T };

// Loads again when the path changes, and ignores answers to an older path
export const useApi = <T,>(path: string): Loaded<T> => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ status: 'loading' });

    fetch(path, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new ApiError(response.status);
        setLoaded({ status: 'ready', data: await response.json() });
      })
      .catch(error => {
        if (!controller.signal.aborted) setLoaded({ status: 'failed', error });
      });

    return () => controller.abort();
  }, [path]);

  return loaded;
};
