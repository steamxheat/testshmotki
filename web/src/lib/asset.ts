export function assetUrl(url: string): string {
  return url.startsWith('/uploads/') ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${url}` : url;
}
