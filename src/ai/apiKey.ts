// The app's one Anthropic credential: user-supplied, stored locally, shared
// by every AI feature (cell descriptions, group labels, circuit chat).

const API_KEY_STORAGE = 'cdl-viewer:anthropic-api-key';

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE);
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE);
}
