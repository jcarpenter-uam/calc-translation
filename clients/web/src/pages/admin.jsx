import React from "react";
import { useTranslation } from "react-i18next";
import UserManagement from "../components/admin/user-management.jsx";
import TenantManagement from "../components/admin/tenant-management.jsx";
import MetricsViewing from "../components/admin/metrics.jsx";
import LogViewing from "../components/admin/log-viewing.jsx";
import { useMetrics } from "../hooks/use-metrics";
import { useLogs } from "../hooks/use-logs.js";
import { useUsers } from "../hooks/use-users.js";
import { useTenants } from "../hooks/use-tenants";

export default function AdminPage() {
  const { t } = useTranslation();

  const {
    users,
    loading: usersLoading,
    error: usersError,
    toggleUserAdmin,
    deleteUser,
  } = useUsers();

  const {
    tenants,
    loading: tenantsLoading,
    error: tenantsError,
    createTenant,
    updateTenant,
    deleteTenant,
    refetch: refetchTenants,
  } = useTenants();

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

  const isPageLoading = usersLoading || tenantsLoading;
  const pageError = usersError || tenantsError;

  return (
    <div className="w-full">
      {isPageLoading ? (
        <div className="text-center text-zinc-500 dark:text-zinc-400">
          {t("loading_admin")}
        </div>
      ) : pageError ? (
        <div className="text-center text-red-500">Error: {pageError}</div>
      ) : (
        <div className="space-y-12">
          <UserManagement
            users={users}
            onToggleAdmin={toggleUserAdmin}
            onDeleteUser={deleteUser}
          />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          {/* Updated: Pass onRefresh */}
          <TenantManagement
            tenants={tenants}
            onCreateTenant={createTenant}
            onUpdateTenant={updateTenant}
            onDeleteTenant={deleteTenant}
            onRefresh={refetchTenants}
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
            refetch={fetchLogs}
          />
        </div>
      )}
    </div>
  );
}
