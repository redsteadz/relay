interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface CloudflareEnv {
  PIPELINE: Fetcher;
  NEXTJS_ENV: string;
  RELAY_INGEST_SHARED_SECRET: string;
}
