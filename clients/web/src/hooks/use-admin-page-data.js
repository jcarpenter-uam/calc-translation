import { useMetrics } from "./use-metrics";
import { useLogs } from "./use-logs.js";
import { useUsers } from "./use-users.js";
import { useTenants } from "./use-tenants";

export function useAdminPageData() {
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

  return {
    isPageLoading,
    pageError,
    users: {
      data: users,
      toggleUserAdmin,
      deleteUser,
    },
    tenants: {
      data: tenants,
      createTenant,
      updateTenant,
      deleteTenant,
      refetchTenants,
    },
    metrics: {
      serverMetrics,
      zoomMetrics,
      loading: metricsLoading,
      error: metricsError,
      fetchMetrics,
    },
    logs: {
      data: logs,
      loading: logsLoading,
      error: logsError,
      fetchLogs,
    },
  };
}
