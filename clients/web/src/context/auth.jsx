import React, { createContext, useCallback, useContext } from "react";
import useSWR from "swr";
import { apiFetch } from "../lib/api-client.js";

const AuthContext = createContext(null);

async function fetchCurrentUser() {
  const response = await apiFetch("/api/users/me");

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export function AuthProvider({ children }) {
  const { data, isLoading, mutate } = useSWR("/api/users/me", fetchCurrentUser);

  const setUser = useCallback(
    (nextUser) => {
      mutate(
        (currentUser) =>
          typeof nextUser === "function" ? nextUser(currentUser) : nextUser,
        { revalidate: false },
      );
    },
    [mutate],
  );

  const logout = useCallback(async () => {
    try {
      const response = await apiFetch("/api/auth/logout", { method: "POST" });

      if (!response.ok) {
        console.warn(
          "Server logout failed (e.g., token expired), logging out locally.",
        );
      }
    } catch (error) {
      console.error("Network error during logout:", error);
    } finally {
      mutate(null, { revalidate: false });
      window.location.href = "/login";
    }
  }, [mutate]);

  const value = { user: data ?? null, setUser, isLoading, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  return useContext(AuthContext);
};
