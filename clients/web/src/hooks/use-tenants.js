import { useState, useEffect, useCallback } from "react";

export function useTenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch all tenants
  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/tenant/");
      if (!response.ok) throw new Error("Failed to fetch tenants");
      const data = await response.json();
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

  // Create Tenant
  const createTenant = useCallback(async (createData) => {
    try {
      const response = await fetch("/api/tenant/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createData),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to create tenant");
      }
      const newTenant = await response.json();
      setTenants((prevTenants) => [...prevTenants, newTenant]);
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, []);

  // Update Tenant
  const updateTenant = useCallback(async (tenantId, updateData) => {
    try {
      const response = await fetch(`/api/tenant/${tenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to update tenant");
      }
      const updatedTenant = await response.json();
      setTenants((prevTenants) =>
        prevTenants.map((t) => (t.tenant_id === tenantId ? updatedTenant : t)),
      );
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, []);

  // Delete Tenant
  const deleteTenant = useCallback(async (tenantId) => {
    try {
      const response = await fetch(`/api/tenant/${tenantId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to delete tenant");
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
