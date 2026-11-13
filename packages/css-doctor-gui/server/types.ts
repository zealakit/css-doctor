export type GuiServerOptions = {
  host?: string;
  port?: number;
  strictPort?: boolean;
  open?: boolean;
  staticDir?: string;
  /** When true, do not serve SPA assets (API-only, used with Vite proxy). */
  apiOnly?: boolean;
  /** Optional JSON report to preload into the session before listen. */
  reportPath?: string;
};

export type GuiServerListenResult = {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

export type GuiHealthResponse = {
  ok: true;
  service: "css-doctor-gui";
  mode: "web";
  version: string;
  now: string;
};
