import { isNativeApp } from './native';

/**
 * Where a call's sound comes out.
 *
 * The speaker button used to flip a boolean and nothing else — a control that
 * looked real and changed nothing, because every call in the Android app came
 * out of the loudspeaker regardless. There is no web API that can fix that:
 * choosing the earpiece is telephony routing, which only Android's
 * AudioManager can reach, so the work happens in CallAudioPlugin and this is
 * the thin edge of it.
 *
 * In a browser all four functions do nothing, deliberately. A laptop has one
 * output and the operating system already decides which; a browser that tried
 * to override that would be wrong more often than right.
 */

type CallAudioPlugin = {
  setInCall(options: { inCall: boolean }): Promise<void>;
  setSpeaker(options: { on: boolean }): Promise<void>;
};

let plugin: CallAudioPlugin | null = null;
let looked = false;

async function native(): Promise<CallAudioPlugin | null> {
  if (!isNativeApp()) return null;
  if (looked) return plugin;
  looked = true;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    plugin = registerPlugin<CallAudioPlugin>('CallAudio');
  } catch {
    // An older build without the plugin. Calls still work; they just come out
    // of whichever speaker Android picks, which is where they came out before.
    plugin = null;
  }
  return plugin;
}

/**
 * Enter call routing, and choose the starting output.
 *
 * A voice call starts on the earpiece because that is how a phone call
 * behaves — you lift it to your ear and it is already right. A video call
 * starts on the loudspeaker because nobody holds a video call to their ear.
 * Both remain a tap away from the other.
 */
export async function startCallAudio(video: boolean) {
  const p = await native();
  if (!p) return;
  await p.setInCall({ inCall: true }).catch(() => {});
  await p.setSpeaker({ on: video }).catch(() => {});
}

/**
 * Leave call routing.
 *
 * This matters as much as entering it. An app that stays in communication mode
 * after hanging up leaves the phone convinced a call is still happening —
 * music plays out of the earpiece, and the volume buttons keep adjusting a
 * call that ended ten minutes ago.
 */
export async function stopCallAudio() {
  const p = await native();
  if (!p) return;
  await p.setInCall({ inCall: false }).catch(() => {});
}

export async function setCallSpeaker(on: boolean) {
  const p = await native();
  if (!p) return;
  await p.setSpeaker({ on }).catch(() => {});
}
