import UserManagement from "./user-management.jsx";
import TenantManagement from "./tenant-management.jsx";
import MetricsViewing from "./metrics.jsx";
import LogViewing from "./log-viewing.jsx";
import { useAdmin } from "../../context/admin.jsx";

export function UserManagementSection() {
  const { users } = useAdmin();

  return (
    <UserManagement
      users={users.data}
      onToggleAdmin={users.toggleUserAdmin}
      onDeleteUser={users.deleteUser}
    />
  );
}

export function TenantManagementSection() {
  const { tenants } = useAdmin();

  return (
    <TenantManagement
      tenants={tenants.data}
      onCreateTenant={tenants.createTenant}
      onUpdateTenant={tenants.updateTenant}
      onDeleteTenant={tenants.deleteTenant}
      onRefresh={tenants.refetchTenants}
    />
  );
}

export function MetricsSection() {
  const { metrics } = useAdmin();

  return (
    <MetricsViewing
      serverMetrics={metrics.serverMetrics}
      zoomMetrics={metrics.zoomMetrics}
      loading={metrics.loading}
      error={metrics.error}
      onRefresh={metrics.fetchMetrics}
    />
  );
}

export function LogViewingSection() {
  const { logs } = useAdmin();

  return (
    <LogViewing
      logs={logs.data}
      loading={logs.loading}
      error={logs.error}
      refetch={logs.fetchLogs}
    />
  );
}
