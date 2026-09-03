"use client";

import { useEffect } from "react";

/**
 * Keep all native audio players in the application mutually exclusive.
 *
 * `play` does not bubble, so the listener is registered in the capture phase;
 * this covers native controls, programmatic `HTMLAudioElement.play()`, and
 * audio players mounted later by dialogs/history lists.
 */
export function ExclusiveAudioPlayback() {
  useEffect(() => {
    const pauseOtherAudio = (event: Event) => {
      const current = event.target;
      if (!(current instanceof HTMLAudioElement)) return;

      document.querySelectorAll("audio").forEach((audio) => {
        if (audio !== current && !audio.paused) audio.pause();
      });
    };

    document.addEventListener("play", pauseOtherAudio, true);
    return () => document.removeEventListener("play", pauseOtherAudio, true);
  }, []);

  return null;
}
