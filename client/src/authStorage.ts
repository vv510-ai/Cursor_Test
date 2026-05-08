const TOKEN_KEY = "chat-deepseek-jwt";

export function getAuthToken(): string | null {
  return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
}

export function setAuthToken(token: string | null): void {
  if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
  else globalThis.localStorage?.removeItem(TOKEN_KEY);
}
