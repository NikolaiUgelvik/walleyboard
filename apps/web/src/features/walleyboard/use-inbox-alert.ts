import { useEffect, useRef } from "react";

export function useInboxAlert() {
  const inboxAlertAudioRef = useRef<HTMLAudioElement | null>(null);

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

  return {
    playInboxAlert(): void {
      const audio = inboxAlertAudioRef.current;
      if (!audio) {
        return;
      }

      audio.currentTime = 0;
      void audio.play().catch(() => {});
    },
  };
}
