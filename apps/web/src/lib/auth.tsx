// Client-side session state via TanStack Query. The session is fetched from the
// API (Better Auth) on the client only — scoped data never renders on the server
// here, because SSR has no session cookie to forward (specs/08 "Data access").
// Components read useSession() for the current user and the auth mutations to
// sign in / out, invalidating the session query on success. There is no
// sign-up mutation — the suite is closed and accounts are admin-only
// (specs/06 §6.1).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient, type SessionUser } from "./authClient";

const SESSION_KEY = ["session"] as const;

export function useSession(): {
  user: SessionUser | null;
  isPending: boolean;
} {
  const q = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => authClient.getSession(),
    staleTime: 30_000,
    retry: false,
  });
  return { user: q.data ?? null, isPending: q.isPending };
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { username: string; password: string }) =>
      authClient.signIn(v.username, v.password),
    onSuccess: (user) => qc.setQueryData(SESSION_KEY, user),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authClient.signOut(),
    onSuccess: () => {
      qc.setQueryData(SESSION_KEY, null);
      qc.invalidateQueries();
    },
  });
}
