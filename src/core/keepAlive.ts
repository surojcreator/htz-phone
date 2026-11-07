/**
 * Background keep-alive.
 *
 * iOS suspends a React Native app a few seconds after it leaves the
 * foreground, which freezes every pending `await` in the order loop. The only
 * reliable way to keep a *plain* JS app running in the background is to hold an
 * active audio session: with `UIBackgroundModes: ["audio"]` and
 * `staysActiveInBackground`, the OS keeps the process (and its timers) alive
 * while a (silent) looping track plays.
 *
 * Android keeps a process with active audio playback alive much longer than an
 * idle one, so the same trick buys real time there too. On both platforms the
 * audio is mixed with anything else that is playing, so it never steals the
 * user's music.
 *
 * Everything degrades to a no-op if the native player is unavailable.
 */
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

import silence from '../../assets/silence.wav';

let sound: Audio.Sound | null = null;
let starting: Promise<void> | null = null;

async function configure(active: boolean): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    staysActiveInBackground: active,
    playsInSilentModeIOS: active,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

export async function startKeepAlive(): Promise<boolean> {
  if (sound) return true;
  if (starting) {
    await starting;
    return !!sound;
  }
  starting = (async () => {
    try {
      await configure(true);
      // the asset is one second of digital silence at full scale — inaudible,
      // but a real playback session, which is what the OS watches
      const created = await Audio.Sound.createAsync(silence, {
        isLooping: true,
        volume: 1,
        shouldPlay: true,
      });
      sound = created.sound;
    } catch {
      sound = null;
      try { await configure(false); } catch { /* ignore */ }
    } finally {
      starting = null;
    }
  })();
  await starting;
  return !!sound;
}

export async function stopKeepAlive(): Promise<void> {
  if (starting) { try { await starting; } catch { /* ignore */ } }
  const s = sound;
  sound = null;
  try {
    if (s) {
      await s.stopAsync().catch(() => {});
      await s.unloadAsync().catch(() => {});
    }
  } finally {
    try { await configure(false); } catch { /* ignore */ }
  }
}

export function keepAliveRunning(): boolean {
  return !!sound;
}
