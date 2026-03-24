import UserManagement from "./user-management.jsx";
import TenantManagement from "./tenant-management.jsx";
import LogViewing from "./log-viewing.jsx";
import ReviewsManagement from "./reviews.jsx";
import BugReportsManagement from "./bug-reports.jsx";
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

export function LogViewingSection() {
  const { logs } = useAdmin();

  return (
    <LogViewing
      logs={logs.data}
      loading={logs.loading}
      error={logs.error}
      onRefresh={logs.fetchLogs}
    />
  );
}

export function ReviewsSection() {
  const { reviews } = useAdmin();

  return (
    <ReviewsManagement
      reviews={reviews.data}
      loading={reviews.loading}
      error={reviews.error}
      onRefresh={reviews.refetchReviews}
    />
  );
}

export function BugReportsSection() {
  const { bugReports } = useAdmin();

  return (
    <BugReportsManagement
      reports={bugReports.data}
      loading={bugReports.loading}
      error={bugReports.error}
      filter={bugReports.status}
      onFilterChange={bugReports.setStatus}
      onRefresh={bugReports.refetchBugReports}
      onViewLog={bugReports.getBugReportLog}
      onSetResolved={bugReports.setBugReportResolved}
    />
  );
}
