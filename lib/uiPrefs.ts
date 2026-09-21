"use client";

import { useEffect, useState } from "react";

export const CHAT_OPEN_KEY = "astronotes.ui.chatOpen";
export const FEED_OPEN_KEY = "astronotes.ui.feedOpen";
export const SEARCH_OPEN_KEY = "astronotes.ui.searchOpen";
export const FILTERS_OPEN_KEY = "astronotes.ui.filtersOpen";
export const GRAPH_CHROME_OPEN_KEY = "astronotes.ui.graphChromeOpen";

function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "0" || stored === "false") return false;
    if (stored === "1" || stored === "true") return true;
  } catch {
    /* ignore quota / private-mode failures */
  }
  return fallback;
}

const PHONE_QUERY = "(max-width: 767px)";

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isPhone;
}

export function usePersistentBoolean(key: string, fallback = true) {
  const [value, setValue] = useState(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setValue(readStoredBoolean(key, fallback));
    setReady(true);
  }, [fallback, key]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      /* ignore quota / private-mode failures */
    }
  }, [key, ready, value]);

  return [value, setValue] as const;
}
