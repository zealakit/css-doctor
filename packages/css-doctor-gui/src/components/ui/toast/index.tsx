import { useEffect, useState } from "react";

import { dismissToast, subscribeToast, type ToastMessage } from "@/lib/toast";

export function ToastHost() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => subscribeToast(setToast), []);

  if (!toast) {
    return null;
  }

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      <div className="toast" role="status">
        <span className="toast__text">{renderToastText(toast)}</span>
        <button
          type="button"
          className="toast__dismiss"
          aria-label="Dismiss notification"
          onClick={dismissToast}
        >
          ×
        </button>
      </div>
      <style>{`
        .toast-host {
          position: fixed;
          left: 50%;
          bottom: 1.25rem;
          z-index: 50;
          transform: translateX(-50%);
          pointer-events: none;
          max-width: min(36rem, calc(100vw - 2rem));
        }

        .toast {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.7rem 0.85rem;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--cssd-success) 40%, var(--cssd-border));
          background: color-mix(in srgb, var(--cssd-success) 14%, var(--cssd-bg-elevated));
          color: var(--cssd-text);
          box-shadow: var(--cssd-shadow);
          animation: toast-in 0.18s ease-out;
        }

        .toast__text {
          margin: 0;
          font-size: 0.9rem;
          line-height: 1.35;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .toast__path {
          font-family: var(--cssd-font-mono);
          text-decoration: underline;
          text-underline-offset: 0.18em;
          text-decoration-thickness: 1px;
        }

        .toast__dismiss {
          appearance: none;
          flex-shrink: 0;
          border: 0;
          background: transparent;
          color: var(--cssd-text-muted);
          font-size: 1.1rem;
          line-height: 1;
          cursor: pointer;
          padding: 0.1rem 0.25rem;
          border-radius: 4px;
        }

        .toast__dismiss:hover {
          color: var(--cssd-text);
        }

        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateY(0.4rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .toast {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

function renderToastText(toast: ToastMessage) {
  if (toast.highlight) {
    return (
      <>
        {toast.before ?? null}
        <span className="toast__path">{toast.highlight}</span>
        {toast.after ?? null}
      </>
    );
  }
  return toast.text ?? "";
}
