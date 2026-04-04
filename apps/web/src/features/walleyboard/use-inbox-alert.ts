import { useEffect, useRef } from "react";

import { getNewInboxItemKeys } from "../../lib/inbox-alert.js";

const INBOX_ALERT_GRACE_PERIOD_MS = 500;

type UseInboxAlertInput = {
  actionItemKeys: string[];
  visibleActionItemKeys?: string[];
  inboxQueriesSettled: boolean;
};

export function useInboxAlert({
  actionItemKeys,
  visibleActionItemKeys = actionItemKeys,
  inboxQueriesSettled,
}: UseInboxAlertInput) {
  const inboxAlertAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousInboxItemKeysRef = useRef<string[] | null>(null);
  const ignoredInboxItemKeysRef = useRef<Set<string>>(new Set());
  const seenInboxItemKeysRef = useRef<Set<string>>(new Set());
  const pendingVisibleInboxItemKeysRef = useRef<Set<string>>(new Set());
  const pendingAlertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }

    // Third-party asset notice: /alert.mp3 is "New Notification 09" by
    // Universfield on Pixabay and is excluded from the repository MIT license.
    // See THIRD_PARTY_NOTICES.md and apps/web/public/alert.mp3.license.txt.
    const audio = new Audio("/alert.mp3");
    audio.preload = "auto";
    inboxAlertAudioRef.current = audio;

    return () => {
      audio.pause();
      inboxAlertAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      const pendingAlertTimeout = pendingAlertTimeoutRef.current;
      if (pendingAlertTimeout !== null) {
        clearTimeout(pendingAlertTimeout);
      }
    };
  }, []);

  useEffect(() => {
    const pendingVisibleInboxItemKeys = pendingVisibleInboxItemKeysRef.current;
    const pendingAlertTimeout = pendingAlertTimeoutRef.current;
    const clearPendingAlertTimeout = (): void => {
      if (pendingAlertTimeoutRef.current === null) {
        return;
      }

      clearTimeout(pendingAlertTimeoutRef.current);
      pendingAlertTimeoutRef.current = null;
    };

    if (!inboxQueriesSettled) {
      pendingVisibleInboxItemKeys.clear();
      clearPendingAlertTimeout();
      return;
    }

    const previousInboxItemKeys = previousInboxItemKeysRef.current;
    const ignoredInboxItemKeys = ignoredInboxItemKeysRef.current;
    const seenInboxItemKeys = seenInboxItemKeysRef.current;
    previousInboxItemKeysRef.current = actionItemKeys;

    const newInboxItemKeys = getNewInboxItemKeys(
      previousInboxItemKeys,
      actionItemKeys,
      ignoredInboxItemKeys,
      seenInboxItemKeys,
    );
    const visibleActionItemKeySet = new Set(visibleActionItemKeys);
    const actionItemKeySet = new Set(actionItemKeys);
    for (const key of Array.from(pendingVisibleInboxItemKeys)) {
      if (!actionItemKeySet.has(key) || !visibleActionItemKeySet.has(key)) {
        pendingVisibleInboxItemKeys.delete(key);
      }
    }
    for (const key of newInboxItemKeys) {
      if (visibleActionItemKeySet.has(key)) {
        pendingVisibleInboxItemKeys.add(key);
      }
    }
    for (const key of actionItemKeys) {
      seenInboxItemKeys.add(key);
    }
    ignoredInboxItemKeys.clear();

    if (pendingVisibleInboxItemKeys.size === 0) {
      clearPendingAlertTimeout();
      return;
    }

    if (pendingAlertTimeout !== null) {
      return;
    }

    pendingAlertTimeoutRef.current = setTimeout(() => {
      pendingAlertTimeoutRef.current = null;
      if (pendingVisibleInboxItemKeysRef.current.size === 0) {
        return;
      }

      pendingVisibleInboxItemKeysRef.current.clear();
      const audio = inboxAlertAudioRef.current;
      if (!audio) {
        return;
      }

      audio.currentTime = 0;
      void audio.play().catch(() => {});
    }, INBOX_ALERT_GRACE_PERIOD_MS);
  }, [actionItemKeys, inboxQueriesSettled, visibleActionItemKeys]);

  return {
    silenceNextInboxItemKey(key: string): void {
      ignoredInboxItemKeysRef.current.add(key);
    },
  };
}
