import { useEffect, useRef } from "react";

import { hasNewInboxItems } from "../../lib/inbox-alert.js";

type UseInboxAlertInput = {
  actionItemKeys: string[];
  inboxQueriesSettled: boolean;
};

export function useInboxAlert({
  actionItemKeys,
  inboxQueriesSettled,
}: UseInboxAlertInput) {
  const inboxAlertAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousInboxItemKeysRef = useRef<string[] | null>(null);
  const ignoredInboxItemKeysRef = useRef<Set<string>>(new Set());

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
    if (!inboxQueriesSettled) {
      return;
    }

    const previousInboxItemKeys = previousInboxItemKeysRef.current;
    const ignoredInboxItemKeys = ignoredInboxItemKeysRef.current;
    previousInboxItemKeysRef.current = actionItemKeys;

    const shouldPlayAlert = hasNewInboxItems(
      previousInboxItemKeys,
      actionItemKeys,
      ignoredInboxItemKeys,
    );
    ignoredInboxItemKeys.clear();

    if (!shouldPlayAlert) {
      return;
    }

    const audio = inboxAlertAudioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }, [actionItemKeys, inboxQueriesSettled]);

  return {
    silenceNextInboxItemKey(key: string): void {
      ignoredInboxItemKeysRef.current.add(key);
    },
  };
}
