import React, { useState } from 'react';
import { LogIn, Loader2, AlertTriangle, ArrowRight, Copy, Check, ExternalLink, RefreshCw, X, ShieldAlert, Globe, Server } from 'lucide-react';
import { loginWithGoogle, loginWithGoogleRedirect, FirebaseAuthError, AuthErrorInfo, getFirebaseActiveConfig } from '../lib/persistence';
import { User } from 'firebase/auth';

interface FirebaseAuthUIProps {
  onSuccess?: (user: User) => void;
  onError?: (error: Error) => void;
  className?: string;
  isCompact?: boolean;
}

export const FirebaseAuthUI: React.FC<FirebaseAuthUIProps> = ({ 
  onSuccess, 
  onError, 
  className = '',
  isCompact = false
}) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorInfo | null>(null);
  const [copiedHostname, setCopiedHostname] = useState(false);

  const handleLogin = async () => {
    try {
      setIsLoggingIn(true);
      setAuthError(null);
      console.log('[FirebaseAuthUI] Initiating Google Sign-In with popup...');
      const user = await loginWithGoogle();
      
      if (user) {
        console.log('[FirebaseAuthUI] Successfully signed in user:', user.displayName || user.email);
        onSuccess?.(user);
      }
    } catch (err: any) {
      const code = err?.authInfo?.code || err?.code;
      if (code === 'auth/popup-closed-by-user' && !err?.authInfo?.isQuickDismissal) {
        console.info('[FirebaseAuthUI] User closed Google Sign-In popup.');
      } else {
        console.warn('[FirebaseAuthUI] Authentication error:', err);
      }
      if (err instanceof FirebaseAuthError && err.authInfo) {
        setAuthError(err.authInfo);
      } else {
        const activeCfg = getFirebaseActiveConfig();
        const code = err?.code || 'auth/unknown';
        const message = err?.message || String(err);
        setAuthError({
          code,
          message,
          hostname: activeCfg.hostname,
          origin: activeCfg.origin,
          authDomain: activeCfg.authDomain,
          projectId: activeCfg.projectId,
          durationMs: 0,
          isQuickDismissal: false,
        });
      }
      onError?.(err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRedirectLogin = async () => {
    try {
      setIsRedirecting(true);
      console.log('[FirebaseAuthUI] Direct user click triggering signInWithRedirect...');
      await loginWithGoogleRedirect();
    } catch (err: any) {
      console.error('[FirebaseAuthUI] Error during Google redirect sign-in:', err);
      setIsRedirecting(false);
      if (err instanceof FirebaseAuthError && err.authInfo) {
        setAuthError(err.authInfo);
      } else {
        const activeCfg = getFirebaseActiveConfig();
        setAuthError({
          code: err?.code || 'auth/redirect-error',
          message: err?.message || String(err),
          hostname: activeCfg.hostname,
          origin: activeCfg.origin,
          authDomain: activeCfg.authDomain,
          projectId: activeCfg.projectId,
          durationMs: 0,
          isQuickDismissal: false,
        });
      }
      onError?.(err);
    }
  };

  const handleCopyHostname = (hostname: string) => {
    navigator.clipboard.writeText(hostname).then(() => {
      setCopiedHostname(true);
      setTimeout(() => setCopiedHostname(false), 2000);
    });
  };

  if (isRedirecting) {
    return (
      <div className={`flex items-center justify-center gap-2.5 px-3.5 py-2.5 bg-cyan-500/10 dark:bg-cyan-950/40 border border-cyan-500/30 rounded-xl text-xs font-medium text-cyan-700 dark:text-cyan-300 ${className}`}>
        <Loader2 size={15} className="animate-spin text-cyan-500 shrink-0" />
        <span>Redirecting to Google Sign-In...</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2.5">
      {/* Primary Google Login Button */}
      {!isCompact ? (
        <button
          type="button"
          onClick={handleLogin}
          disabled={isLoggingIn}
          className={`w-full flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all shadow-xs disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer ${className}`}
        >
          {isLoggingIn ? (
            <Loader2 size={18} className="animate-spin text-cyan-500 shrink-0" />
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z"/>
                <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z"/>
                <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.724 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z"/>
                <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z"/>
              </g>
            </svg>
          )}
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {isLoggingIn ? 'Connecting to Google...' : 'Continue with Google'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleLogin}
          disabled={isLoggingIn}
          className={`flex w-full items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-medium transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed ${className}`}
        >
          <div className="flex items-center gap-2.5">
            {isLoggingIn ? <Loader2 size={15} className="animate-spin text-cyan-500 shrink-0" /> : <LogIn size={15} className="shrink-0 text-cyan-500" />}
            <span className="font-semibold">{isLoggingIn ? 'Signing in...' : 'Sign In with Google'}</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">OAuth</span>
        </button>
      )}

      {/* Troubleshooting and Diagnostic Panel */}
      {authError && (
        <div className="p-3 bg-amber-500/10 dark:bg-amber-950/40 border border-amber-500/30 rounded-xl text-xs space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="font-bold text-amber-900 dark:text-amber-200 text-[11px] truncate">
                Authentication Notice
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-800 dark:text-amber-300 font-mono text-[10px]">
                {authError.code}
              </span>
              <button
                type="button"
                onClick={() => setAuthError(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                title="Dismiss"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Detailed Diagnosis based on error code */}
          <div className="text-[11px] text-slate-700 dark:text-slate-300 space-y-1.5">
            {authError.code === 'auth/unauthorized-domain' && (
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">
                  Current domain is not authorized in Firebase:
                </p>
                <div className="flex items-center justify-between gap-1 p-1.5 bg-white dark:bg-slate-900 border border-amber-500/30 rounded-lg font-mono text-[10px]">
                  <span className="truncate text-slate-800 dark:text-slate-200">{authError.hostname}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyHostname(authError.hostname)}
                    className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 text-amber-800 dark:text-amber-200 rounded flex items-center gap-1 shrink-0 transition-colors"
                  >
                    {copiedHostname ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    <span>{copiedHostname ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                  Add this hostname to Firebase Console → <strong>Authentication</strong> → <strong>Settings</strong> → <strong>Authorized domains</strong>.
                </p>
              </div>
            )}

            {authError.code === 'auth/operation-not-allowed' && (
              <p>
                Google Sign-In is not enabled. Go to Firebase Console → <strong>Authentication</strong> → <strong>Sign-in method</strong> and enable <strong>Google</strong>.
              </p>
            )}

            {(authError.code === 'auth/invalid-api-key' || authError.code === 'auth/api-key-not-valid' || authError.code === 'auth/configuration-not-found') && (
              <div className="space-y-1">
                <p className="font-semibold text-red-600 dark:text-red-400">Firebase Configuration Check Required:</p>
                <p className="text-[10px] text-slate-500">
                  Active Project: <strong className="font-mono">{authError.projectId}</strong> | Auth Domain: <strong className="font-mono">{authError.authDomain}</strong>
                </p>
              </div>
            )}

            {(authError.code === 'auth/popup-blocked' || (authError.code === 'auth/popup-closed-by-user' && authError.isQuickDismissal) || authError.code === 'auth/cancelled-popup-request') && (
              <p>
                Popup was blocked or closed immediately ({authError.durationMs}ms) by iframe restrictions. Continue using direct redirect below.
              </p>
            )}

            {authError.code === 'auth/popup-closed-by-user' && !authError.isQuickDismissal && (
              <p>
                The Google Sign-In popup window was closed before login completed.
              </p>
            )}

            {authError.code === 'auth/network-request-failed' && (
              <p>
                Network connection to Firebase servers failed. Please check your network connection and firewall settings.
              </p>
            )}

            {authError.code !== 'auth/unauthorized-domain' &&
             authError.code !== 'auth/operation-not-allowed' &&
             authError.code !== 'auth/invalid-api-key' &&
             authError.code !== 'auth/popup-blocked' &&
             authError.code !== 'auth/popup-closed-by-user' &&
             authError.code !== 'auth/cancelled-popup-request' &&
             authError.code !== 'auth/network-request-failed' && (
              <p className="break-words">{authError.message}</p>
            )}
          </div>

          {/* Configuration context snippet */}
          <div className="pt-1.5 border-t border-amber-500/20 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            <span title="Active Firebase Project">Project: {authError.projectId}</span>
            <span title="Configured Auth Domain">Domain: {authError.authDomain}</span>
          </div>

          {/* Action Row */}
          <div className="pt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={handleRedirectLogin}
              className="flex-1 py-1.5 px-2.5 bg-cyan-600 hover:bg-cyan-700 active:bg-cyan-800 text-white rounded-lg font-semibold text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <span>Continue using redirect</span>
              <ArrowRight size={13} />
            </button>

            <button
              type="button"
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="py-1.5 px-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RefreshCw size={11} className={isLoggingIn ? "animate-spin" : ""} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

