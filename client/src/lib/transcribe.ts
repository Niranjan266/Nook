/**
 * On-device transcription for voice notes.
 *
 * Deliberately uses the browser's built-in SpeechRecognition rather than
 * shipping a Whisper model:
 *
 *   - Whisper via transformers.js means a 40–75 MB model download before the
 *     first transcript. On a phone, on data, that's not a feature — it's a
 *     tax. It also can't run during recording, only after.
 *   - SpeechRecognition is already installed, starts instantly, and runs while
 *     you speak.
 *
 * The important property is preserved either way: the text is produced on the
 * sender's device, attached to the message only if they keep it, and the audio
 * is never sent anywhere to be read. That also means it survives end-to-end
 * encryption, which a server-side transcription service would not.
 *
 * Caveat worth knowing: some browsers implement SpeechRecognition by streaming
 * audio to the vendor's own service. Chrome on desktop does. If that matters,
 * turn it off — the toggle is in settings, and nothing else depends on it.
 */

type Recognition = any;

const Impl: { new (): Recognition } | undefined =
  (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
  undefined;

export const canTranscribe = () => Boolean(Impl);

export interface LiveTranscription {
  stop: () => Promise<string>;
  cancel: () => void;
}

/**
 * Starts listening alongside the MediaRecorder and accumulates final results.
 * Returns a handle whose `stop()` resolves with the full transcript.
 */
export function transcribe(onPartial?: (text: string) => void): LiveTranscription | null {
  if (!Impl) return null;

  let recognition: Recognition;
  try {
    recognition = new Impl();
  } catch {
    return null;
  }

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';

  let settled = '';
  let stopped = false;

  recognition.onresult = (event: any) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) settled += `${result[0].transcript.trim()} `;
      else interim += result[0].transcript;
    }
    onPartial?.((settled + interim).trim());
  };

  // A no-speech or aborted error is normal, not a failure worth surfacing.
  recognition.onerror = () => {};

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () =>
      new Promise<string>((resolve) => {
        if (stopped) return resolve(settled.trim());
        stopped = true;
        recognition.onend = () => resolve(settled.trim());
        try {
          recognition.stop();
        } catch {
          resolve(settled.trim());
        }
        // Never let a stuck engine hold up sending the message.
        setTimeout(() => resolve(settled.trim()), 1200);
      }),
    cancel: () => {
      stopped = true;
      try {
        recognition.abort();
      } catch {
        /* already gone */
      }
    },
  };
}
