type ImportMetaWithOptionalEnv = ImportMeta & {
  env?: {
    VITE_API_URL?: string;
  };
};

function readApiBaseUrlFromEnv(): string | undefined {
  return (import.meta as ImportMetaWithOptionalEnv).env?.VITE_API_URL;
}

function readApiBaseUrlFromWindow(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.location?.origin;
}

export const apiBaseUrl =
  readApiBaseUrlFromEnv()?.replace(/\/+$/, "") ??
  readApiBaseUrlFromWindow()?.replace(/\/+$/, "") ??
  "http://127.0.0.1:4000";

export function resolveApiPath(path: string): string {
  if (!path.startsWith("/")) {
    return path;
  }

  return `${apiBaseUrl}${path}`;
}

export function resolveProjectArtifactHref(href: string): string {
  if (!href.startsWith("/projects/")) {
    return href;
  }

  return resolveApiPath(href);
}
