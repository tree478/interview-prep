"use client";

import { useEffect, useState } from "react";

// Tracks one API call: loading -> success (with data) or error (with message).
//
// Usage in a component:
//   const feed = useApi(() => getFeed(filters), [filters.location]);
//   if (feed.status === "loading") return <Spinner />;
//   if (feed.status === "error") return <p>{feed.error}</p>;
//   return feed.data.map(...);
//
// `deps` works like a useEffect dependency list: when any value in it changes,
// the call runs again. While it re-runs, the old data stays on screen.

type ApiState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "success"; data: T };

export function useApi<T>(fetcher: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  // Bumping this number forces the effect below to run again.
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    // If the component unmounts or deps change before the request finishes,
    // ignore the late response so it can't overwrite newer data.
    let cancelled = false;
    fetcher().then(
      (data) => {
        if (!cancelled) setState({ status: "success", data });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // The caller controls when to refetch through `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadCount]);

  return {
    ...state,
    /** Run the request again. */
    reload: () => setReloadCount((n) => n + 1),
    /** Replace the data locally, e.g. after the user changes something. */
    setData: (data: T) => setState({ status: "success", data }),
  };
}
