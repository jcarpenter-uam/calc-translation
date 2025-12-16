import React, { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
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

  const value = { user, setUser, isLoading, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  return useContext(AuthContext);
};
