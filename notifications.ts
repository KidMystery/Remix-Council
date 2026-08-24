/* Web Audio & Browser Notification helper for Council Chamber */

export interface NotificationSettings {
  enableSoundAlerts: boolean;
  soundVolume: number; // 0 to 1
  enableBrowserNotifications: boolean;
  notifyOnDeliberationComplete: boolean;
  notifyOnError: boolean;
  notifyOnCostThreshold: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enableSoundAlerts: true,
  soundVolume: 0.5,
  enableBrowserNotifications: false,
  notifyOnDeliberationComplete: true,
  notifyOnError: true,
  notifyOnCostThreshold: true,
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Synthesizes a clean, pleasant chime using Web Audio API without needing external mp3 files.
 */
export function playNotificationChime(type: 'complete' | 'error' | 'test', volume = 0.5) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const masterGain = ctx.createGain();
    const safeVolume = Math.max(0.01, Math.min(volume, 1.0));
    masterGain.gain.setValueAtTime(safeVolume * 0.35, ctx.currentTime);
    masterGain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'complete' || type === 'test') {
      // Pleasant two-note ascending chime (e.g., E5 659.25Hz -> A5 880Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.7, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(masterGain);
      osc1.start(now);
      osc1.stop(now + 0.35);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.12);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.setValueAtTime(0.85, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(masterGain);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.65);
    } else if (type === 'error') {
      // Gentle warning chord (330Hz -> 261Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(329.63, now);
      osc.frequency.exponentialRampToValueAtTime(261.63, now + 0.25);
      gain.gain.setValueAtTime(0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch (e) {
    console.warn('Audio notification failed:', e);
  }
}

/**
 * Checks or requests Desktop Push Notification permissions.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (e) {
    return 'denied';
  }
}

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Sends a native system notification if permitted.
 */
export function sendDesktopNotification(title: string, body?: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      const notif = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: 'council-chamber',
      });
      notif.onclick = () => {
        window.focus();
        notif.close();
      };
      // Auto close after 5 seconds
      setTimeout(() => notif.close(), 5000);
    } catch (e) {
      console.warn('Desktop notification dispatch failed:', e);
    }
  }
}
