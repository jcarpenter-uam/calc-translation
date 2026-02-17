import { useState, useEffect, useCallback } from "react";
import { API_ROUTES } from "../constants/routes.js";
import {
  JSON_HEADERS,
  apiFetch,
  getErrorMessage,
  requestJson,
} from "../lib/api-client.js";

export function useUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestJson(
        API_ROUTES.users.base,
        {},
        "Failed to fetch users",
      );
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const toggleUserAdmin = useCallback(async (userId, isAdmin) => {
    try {
      const updatedUser = await requestJson(
        API_ROUTES.users.admin(userId),
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ is_admin: isAdmin }),
        },
        "Failed to update admin status",
      );

      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.id === userId ? { ...user, ...updatedUser } : user,
        ),
      );
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, []);

  const deleteUser = useCallback(async (userId) => {
    try {
      const response = await apiFetch(API_ROUTES.users.byId(userId), {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Failed to delete user"));
      }

      setUsers((prevUsers) => prevUsers.filter((user) => user.id !== userId));
      return { success: true };
    } catch (err) {
      console.error("Delete error:", err);
      return { success: false, error: err.message };
    }
  }, []);

  return {
    users,
    loading,
    error,
    refetch: fetchUsers,
    toggleUserAdmin,
    deleteUser,
  };
}
