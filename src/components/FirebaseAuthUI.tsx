import React, { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { loginWithGoogle } from '../lib/persistence';
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

  const handleLogin = async () => {
    try {
      setIsLoggingIn(true);
      console.log('[FirebaseAuthUI] User clicked Google Sign-In.');
      const result = await loginWithGoogle();
      
      if (result === 'redirecting') {
        console.log('[FirebaseAuthUI] Redirect initiated, updating UI to redirecting state.');
        setIsRedirecting(true);
        return;
      }
      
      if (result) {
        console.log('[FirebaseAuthUI] Successfully signed in user:', result.displayName || result.email);
        onSuccess?.(result);
      }
    } catch (err: any) {
      console.error('[FirebaseAuthUI] Error during Google authentication:', err);
      if (onError) {
        onError(err);
      }
    } finally {
      if (!isRedirecting) {
        setIsLoggingIn(false);
      }
    }
  };

  if (isRedirecting) {
    if (isCompact) {
      return (
        <div className={`flex items-center gap-2 px-3 py-2 text-xs font-medium text-cyan-600 dark:text-cyan-400 ${className}`}>
          <Loader2 size={15} className="animate-spin shrink-0" />
          <span>Redirecting to Google...</span>
        </div>
      );
    }
    return (
      <div className={`flex items-center justify-center gap-2.5 px-4 py-3 bg-cyan-500/10 dark:bg-cyan-950/40 border border-cyan-500/30 rounded-xl text-xs font-medium text-cyan-600 dark:text-cyan-400 ${className}`}>
        <Loader2 size={16} className="animate-spin shrink-0" />
        <span>Redirecting to Google Sign-In...</span>
      </div>
    );
  }

  if (isCompact) {
    return (
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoggingIn}
        className={`flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed ${className}`}
      >
        {isLoggingIn ? <Loader2 size={15} className="animate-spin text-cyan-500 shrink-0" /> : <LogIn size={15} className="shrink-0" />}
        <span>{isLoggingIn ? 'Signing in...' : 'Sign In with Google'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogin}
      disabled={isLoggingIn}
      className={`w-full flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-colors shadow-xs disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer ${className}`}
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
        {isLoggingIn ? 'Signing in...' : 'Continue with Google'}
      </span>
    </button>
  );
};
