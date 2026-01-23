import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import UserManagement from "../components/admin/user-management.jsx";
import TenantManagement from "../components/admin/tenant-management.jsx";
import MetricsViewing from "../components/admin/metrics.jsx";
import LogViewing from "../components/admin/log-viewing.jsx";
import { useMetrics } from "../hooks/use-metrics";
import { useLogs } from "../hooks/use-logs.js";

export default function AdminPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const {
    serverMetrics,
    zoomMetrics,
    loading: metricsLoading,
    error: metricsError,
    refetch: fetchMetrics,
  } = useMetrics(15000);

  const {
    logs,
    loading: logsLoading,
    error: logsError,
    refetch: fetchLogs,
  } = useLogs(3000);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [userResponse, tenantResponse] = await Promise.all([
          fetch("/api/users/"),
          fetch("/api/tenant/"),
        ]);

        if (!userResponse.ok) throw new Error("Failed to fetch users");
        if (!tenantResponse.ok) throw new Error("Failed to fetch tenants");

        const usersData = await userResponse.json();
        const tenantsData = await tenantResponse.json();

        setUsers(usersData);
        setTenants(tenantsData);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleToggleUserAdmin = async (userId, isAdmin) => {
    try {
      const response = await fetch(`/api/users/${userId}/admin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_admin: isAdmin }),
      });
      if (!response.ok) throw new Error("Failed to update admin status");
      const updatedUser = await response.json();
      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.id === userId ? { ...user, ...updatedUser } : user,
        ),
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete user");
      setUsers((prevUsers) => prevUsers.filter((user) => user.id !== userId));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const handleCreateTenant = async (createData) => {
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
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdateTenant = async (tenantId, updateData) => {
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
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTenant = async (tenantId) => {
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
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="w-full">
      {isLoading ? (
        <div className="text-center text-zinc-500 dark:text-zinc-400">
          {t("loading_admin")}
        </div>
      ) : error ? (
        <div className="text-center text-red-500">Error: {error}</div>
      ) : (
        <div className="space-y-12">
          <UserManagement
            users={users}
            onToggleAdmin={handleToggleUserAdmin}
            onDeleteUser={handleDeleteUser}
          />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <TenantManagement
            tenants={tenants}
            onCreateTenant={handleCreateTenant}
            onUpdateTenant={handleUpdateTenant}
            onDeleteTenant={handleDeleteTenant}
          />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <MetricsViewing
            serverMetrics={serverMetrics}
            zoomMetrics={zoomMetrics}
            loading={metricsLoading}
            error={metricsError}
            onRefresh={fetchMetrics}
          />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <LogViewing
            logs={logs}
            loading={logsLoading}
            error={logsError}
            onRefresh={fetchLogs}
          />
        </div>
      )}
    </div>
  );
}
