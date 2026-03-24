import React, { createContext, useCallback, useContext } from "react";
import useSWR from "swr";
import { apiFetch } from "../lib/api-client.js";
import { clientLogger } from "../lib/client-logger.js";

const AuthContext = createContext(null);

async function fetchCurrentUser() {
  clientLogger.info("Auth: Fetching current user");
  const response = await apiFetch("/api/users/me");

  if (!response.ok) {
    clientLogger.warn("Auth: Current user unavailable", { status: response.status });
    return null;
  }

  const user = await response.json();
  clientLogger.info("Auth: Current user loaded", {
    userId: user?.id || null,
    isAdmin: Boolean(user?.is_admin),
  });
  return user;
}

export function AuthProvider({ children }) {
  const { data, isLoading, mutate } = useSWR("/api/users/me", fetchCurrentUser);

  const setUser = useCallback(
    (nextUser) => {
      clientLogger.info("Auth: Updating cached user", {
        updateType: typeof nextUser,
      });
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
      clientLogger.info("Auth: Logging out current user");
      const response = await apiFetch("/api/auth/logout", { method: "POST" });

      if (!response.ok) {
        clientLogger.warn(
          "Server logout failed (e.g., token expired), logging out locally.",
        );
      }
    } catch (error) {
      clientLogger.error("Auth: Network error during logout", error);
    } finally {
      mutate(null, { revalidate: false });
      window.location.href = "/login";
    }
  }, [mutate]);

  const value = { user: data ?? null, setUser, isLoading, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  return useContext(AuthContext);
};
