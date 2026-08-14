import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Bell, AlertTriangle, CheckCircle2, Play, ShieldAlert, Sparkles } from 'lucide-react';
import { NotificationPreferences } from '../../types';
import {
  playNotificationChime,
  requestNotificationPermission,
  getNotificationPermissionState,
  sendDesktopNotification,
  DEFAULT_NOTIFICATION_SETTINGS,
} from '../../lib/notifications';

interface SettingsNotificationsTabProps {
  notificationPreferences?: NotificationPreferences;
  onUpdateNotifications?: (prefs: NotificationPreferences) => void;
}

export const SettingsNotificationsTab: React.FC<SettingsNotificationsTabProps> = ({
  notificationPreferences,
  onUpdateNotifications,
}) => {
  const [prefs, setPrefs] = useState<NotificationPreferences>(() => {
    const saved = localStorage.getItem('council_notification_preferences');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return notificationPreferences || DEFAULT_NOTIFICATION_SETTINGS;
  });

  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>('default');
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    setPermissionState(getNotificationPermissionState());
  }, []);

  const updatePreference = <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    localStorage.setItem('council_notification_preferences', JSON.stringify(next));
    if (onUpdateNotifications) {
      onUpdateNotifications(next);
    }
  };

  const handleRequestPermission = async () => {
    const res = await requestNotificationPermission();
    setPermissionState(res);
    if (res === 'granted') {
      updatePreference('enableBrowserNotifications', true);
      sendDesktopNotification('🏛️ Council Chamber Alerts Active', 'You will be notified when deliberations finish.');
    }
  };

  const handleTestChime = () => {
    playNotificationChime('test', prefs.soundVolume ?? 0.5);
  };

  const handleTestDesktopNotification = () => {
    sendDesktopNotification('🏛️ Council Deliberation Complete', 'Stage 3 Consensus and verdict are ready to review.');
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Audio Alerts Section */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Volume2 size={12} className="text-indigo-400" />
          <span>Sound Effects & Audio Chimes</span>
        </h3>

        <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/50 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-white">Enable Audio Chimes</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Plays a gentle synthesized tone when deliberation stages or consensus finish
              </p>
            </div>
            <button
              type="button"
              onClick={() => updatePreference('enableSoundAlerts', !prefs.enableSoundAlerts)}
              className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer shrink-0 ${
                prefs.enableSoundAlerts ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <div
                className={`absolute top-1 bg-white w-4 h-4 rounded-full shadow transition-transform ${
                  prefs.enableSoundAlerts ? 'right-1' : 'left-1'
                }`}
              />
            </button>
          </div>

          {prefs.enableSoundAlerts && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                <span className="text-xs font-mono text-slate-500">Volume:</span>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={prefs.soundVolume ?? 0.5}
                  onChange={(e) => updatePreference('soundVolume', parseFloat(e.target.value))}
                  className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg cursor-pointer"
                />
                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 w-9 text-right">
                  {Math.round((prefs.soundVolume ?? 0.5) * 100)}%
                </span>
              </div>

              <button
                type="button"
                onClick={handleTestChime}
                className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Play size={11} className="fill-indigo-500 text-indigo-500" />
                <span>Test Chime</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Browser Desktop Notifications */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Bell size={12} className="text-indigo-400" />
          <span>Browser Desktop Notifications</span>
        </h3>

        <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/50 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-white">Desktop Push Notifications</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Receive system notifications even if the Council Chamber is in a background tab
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (permissionState !== 'granted') {
                  handleRequestPermission();
                } else {
                  updatePreference('enableBrowserNotifications', !prefs.enableBrowserNotifications);
                }
              }}
              className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer shrink-0 ${
                prefs.enableBrowserNotifications && permissionState === 'granted'
                  ? 'bg-indigo-600'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <div
                className={`absolute top-1 bg-white w-4 h-4 rounded-full shadow transition-transform ${
                  prefs.enableBrowserNotifications && permissionState === 'granted' ? 'right-1' : 'left-1'
                }`}
              />
            </button>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Browser Permission:</span>
              <span
                className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1 ${
                  permissionState === 'granted'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                    : permissionState === 'denied'
                    ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800'
                    : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                }`}
              >
                {permissionState === 'granted' && <CheckCircle2 size={11} />}
                {permissionState === 'denied' && <AlertTriangle size={11} />}
                <span>{permissionState.toUpperCase()}</span>
              </span>
            </div>

            {permissionState !== 'granted' ? (
              <button
                type="button"
                onClick={handleRequestPermission}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Grant Permission
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTestDesktopNotification}
                className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-mono transition-colors cursor-pointer"
              >
                {testSent ? 'Notification Sent!' : 'Send Test Notification'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Trigger Event Toggles */}
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Notification Triggers
        </h3>

        <div className="space-y-2">
          <label className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors cursor-pointer">
            <div className="flex items-center gap-2.5">
              <Sparkles size={14} className="text-amber-500" />
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  Deliberation & Consensus Complete
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Notify when Stage 3 synthesis is generated and ready
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.notifyOnDeliberationComplete ?? true}
              onChange={(e) => updatePreference('notifyOnDeliberationComplete', e.target.checked)}
              className="accent-indigo-600 h-4 w-4 rounded cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors cursor-pointer">
            <div className="flex items-center gap-2.5">
              <ShieldAlert size={14} className="text-red-500" />
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  API & Provider Errors
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Alert if a model times out, encounters an error, or activates fallback
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.notifyOnError ?? true}
              onChange={(e) => updatePreference('notifyOnError', e.target.checked)}
              className="accent-indigo-600 h-4 w-4 rounded cursor-pointer"
            />
          </label>
        </div>
      </section>
    </div>
  );
};
