export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  AUTH_GOOGLE_ID: string;
  AUTH_GOOGLE_SECRET: string;
  AUTH_SECRET: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
}
