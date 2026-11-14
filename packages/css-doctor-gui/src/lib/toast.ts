export type ToastContent = {
  before?: string;
  /** Path or other segment rendered with underline. */
  highlight?: string;
  after?: string;
  /** Plain-text fallback when no highlight is needed. */
  text?: string;
};

export type ToastMessage = ToastContent & {
  id: number;
};

type ToastListener = (toast: ToastMessage | null) => void;

const listeners = new Set<ToastListener>();
let current: ToastMessage | null = null;
let dismissTimer: number | null = null;
let nextId = 1;

export function showToast(
  input: string | ToastContent,
  durationMs = 1800,
): void {
  const content =
    typeof input === "string"
      ? { text: input }
      : {
          before: input.before,
          highlight: input.highlight,
          after: input.after,
          text: input.text,
        };

  current = { id: nextId++, ...content };
  notify();

  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
  }
  dismissTimer = window.setTimeout(() => {
    current = null;
    dismissTimer = null;
    notify();
  }, durationMs);
}

export function dismissToast(): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (!current) {
    return;
  }
  current = null;
  notify();
}

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener(current);
  }
}
