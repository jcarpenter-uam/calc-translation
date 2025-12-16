import React, { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let timeoutId;
    const fetchUser = async () => {
      try {
        const response = await fetch("/api/users/me");

        if (!response.ok) {
          throw new Error("Not authenticated");
        }

        const userData = await response.json();
        setUser(userData);
      } catch (error) {
        setUser(null);

        const isLoginPage = window.location.pathname === "/login";

        if (!isLoginPage) {
          setError("Not authenticated. Redirecting to login...");

          timeoutId = setTimeout(() => {
            window.location.href = "/login";
          }, 3000);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  const logout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });

      if (!response.ok) {
        console.warn(
          "Server logout failed (e.g., token expired), logging out locally.",
        );
      }
    } catch (error) {
      console.error("Network error during logout:", error);
    } finally {
      setUser(null);
      window.location.href = "/login";
    }
  };

  const value = { user, setUser, isLoading, error, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  return useContext(AuthContext);
};
