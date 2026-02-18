import { useCallback, useState } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import {
  JSON_HEADERS,
  apiFetch,
  getErrorMessage,
  requestJson,
} from "../lib/api-client.js";

async function fetchTenants() {
  return requestJson(API_ROUTES.tenants.base, {}, "Failed to fetch tenants");
}

export function useTenants() {
  const [mutationError, setMutationError] = useState(null);

  const {
    data,
    error: fetchError,
    isLoading,
    mutate,
  } = useSWR(API_ROUTES.tenants.base, fetchTenants);

  const refetch = useCallback(async () => {
    setMutationError(null);
    await mutate();
  }, [mutate]);

  const createTenant = useCallback(async (createData) => {
    setMutationError(null);
    try {
      const newTenant = await requestJson(
        API_ROUTES.tenants.base,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(createData),
        },
        "Failed to create tenant",
      );

      await mutate((prevTenants = []) => [...prevTenants, newTenant], {
        revalidate: false,
      });
      return { success: true };
    } catch (err) {
      setMutationError(err.message);
      return { success: false, error: err.message };
    }
  }, [mutate]);

  const updateTenant = useCallback(async (tenantId, updateData) => {
    setMutationError(null);
    try {
      const updatedTenant = await requestJson(
        API_ROUTES.tenants.byId(tenantId),
        {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(updateData),
        },
        "Failed to update tenant",
      );

      await mutate(
        (prevTenants = []) =>
          prevTenants.map((tenant) =>
            tenant.tenant_id === tenantId ? updatedTenant : tenant,
          ),
        { revalidate: false },
      );
      return { success: true };
    } catch (err) {
      setMutationError(err.message);
      return { success: false, error: err.message };
    }
  }, [mutate]);

  const deleteTenant = useCallback(async (tenantId) => {
    setMutationError(null);
    try {
      const response = await apiFetch(API_ROUTES.tenants.byId(tenantId), {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Failed to delete tenant"));
      }

      await mutate(
        (prevTenants = []) =>
          prevTenants.filter((tenant) => tenant.tenant_id !== tenantId),
        { revalidate: false },
      );
      return { success: true };
    } catch (err) {
      setMutationError(err.message);
      return { success: false, error: err.message };
    }
  }, [mutate]);

  return {
    tenants: data ?? [],
    loading: isLoading,
    error: mutationError || fetchError?.message || null,
    refetch,
    createTenant,
    updateTenant,
    deleteTenant,
  };
}
