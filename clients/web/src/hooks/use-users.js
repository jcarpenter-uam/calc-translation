import { useCallback, useState } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import {
  JSON_HEADERS,
  apiFetch,
  getErrorMessage,
  requestJson,
} from "../lib/api-client.js";

async function fetchUsers() {
  return requestJson(API_ROUTES.users.base, {}, "Failed to fetch users");
}

export function useUsers() {
  const [mutationError, setMutationError] = useState(null);

  const {
    data,
    error: fetchError,
    isLoading,
    mutate,
  } = useSWR(API_ROUTES.users.base, fetchUsers);

  const refetch = useCallback(async () => {
    setMutationError(null);
    await mutate();
  }, [mutate]);

  const toggleUserAdmin = useCallback(async (userId, isAdmin) => {
    setMutationError(null);
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

      await mutate(
        (prevUsers = []) =>
          prevUsers.map((user) =>
            user.id === userId ? { ...user, ...updatedUser } : user,
          ),
        { revalidate: false },
      );
      return { success: true };
    } catch (err) {
      setMutationError(err.message);
      return { success: false, error: err.message };
    }
  }, [mutate]);

  const deleteUser = useCallback(async (userId) => {
    setMutationError(null);
    try {
      const response = await apiFetch(API_ROUTES.users.byId(userId), {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Failed to delete user"));
      }

      await mutate(
        (prevUsers = []) =>
          prevUsers.filter((user) => user.id !== userId),
        { revalidate: false },
      );
      return { success: true };
    } catch (err) {
      console.error("Delete error:", err);
      setMutationError(err.message);
      return { success: false, error: err.message };
    }
  }, [mutate]);

  return {
    users: data ?? [],
    loading: isLoading,
    error: mutationError || fetchError?.message || null,
    refetch,
    toggleUserAdmin,
    deleteUser,
  };
}
