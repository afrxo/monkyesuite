// Minimal Better Auth client over its REST endpoints (the API owns /v1/auth/*,
// specs/06 §6.1). We hit the endpoints with fetch + credentials:"include" so the
// session cookie is set on / sent to the API origin, rather than pulling in the
// better-auth React client as a web dependency. Cross-origin cookies work in dev
// because :3000 and :8787 share the same site (localhost); deploy config handles
// SameSite=None for the split Cloudflare/Railway origins.

const AUTH_BASE = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/v1"
).replace(/\/$/, "");

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function authFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AUTH_BASE}/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : res.statusText;
    throw new AuthError(res.status, message);
  }
  return data as T;
}

export const authClient = {
  async signIn(email: string, password: string): Promise<SessionUser> {
    const r = await authFetch<{ user: SessionUser }>("/sign-in/email", {
      email,
      password,
    });
    return r.user;
  },
  async signUp(
    name: string,
    email: string,
    password: string,
  ): Promise<SessionUser> {
    const r = await authFetch<{ user: SessionUser }>("/sign-up/email", {
      name,
      email,
      password,
    });
    return r.user;
  },
  async signOut(): Promise<void> {
    await authFetch("/sign-out", {});
  },
  // Better Auth returns null (not an error) when there is no active session.
  async getSession(): Promise<SessionUser | null> {
    const r = await authFetch<{ user: SessionUser } | null>("/get-session");
    return r?.user ?? null;
  },
};
