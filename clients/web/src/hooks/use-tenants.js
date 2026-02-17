import { useState, useEffect, useCallback } from "react";
import { API_ROUTES } from "../constants/routes.js";
import {
  JSON_HEADERS,
  apiFetch,
  getErrorMessage,
  requestJson,
} from "../lib/api-client.js";

export function useTenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestJson(
        API_ROUTES.tenants.base,
        {},
        "Failed to fetch tenants",
      );
      setTenants(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const createTenant = useCallback(async (createData) => {
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
      setTenants((prevTenants) => [...prevTenants, newTenant]);
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, []);

  const updateTenant = useCallback(async (tenantId, updateData) => {
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

      setTenants((prevTenants) =>
        prevTenants.map((t) => (t.tenant_id === tenantId ? updatedTenant : t)),
      );
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, []);

  const deleteTenant = useCallback(async (tenantId) => {
    try {
      const response = await apiFetch(API_ROUTES.tenants.byId(tenantId), {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Failed to delete tenant"));
      }

      setTenants((prevTenants) =>
        prevTenants.filter((t) => t.tenant_id !== tenantId),
      );
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, []);

  return {
    tenants,
    loading,
    error,
    refetch: fetchTenants,
    createTenant,
    updateTenant,
    deleteTenant,
  };
}
