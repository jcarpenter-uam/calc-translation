import { useState } from "react";
import { useLogs } from "./use-logs.js";
import { useUsers } from "./use-users.js";
import { useTenants } from "./use-tenants";
import { useAdminReviews } from "./use-admin-reviews.js";
import { useAdminBugReports } from "./use-admin-bug-reports.js";

export function useAdminPageData() {
  const [bugReportStatus, setBugReportStatus] = useState("open");
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
    logs,
    loading: logsLoading,
    error: logsError,
    refetch: fetchLogs,
  } = useLogs(3000);

  const {
    reviews,
    loading: reviewsLoading,
    error: reviewsError,
    refetch: refetchReviews,
  } = useAdminReviews();

  const {
    bugReports,
    loading: bugReportsLoading,
    error: bugReportsError,
    refetch: refetchBugReports,
    setResolved: setBugReportResolved,
    getLog: getBugReportLog,
  } = useAdminBugReports(bugReportStatus);

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
    logs: {
      data: logs,
      loading: logsLoading,
      error: logsError,
      fetchLogs,
    },
    reviews: {
      data: reviews,
      loading: reviewsLoading,
      error: reviewsError,
      refetchReviews,
    },
    bugReports: {
      data: bugReports,
      loading: bugReportsLoading,
      error: bugReportsError,
      refetchBugReports,
      setBugReportResolved,
      getBugReportLog,
      status: bugReportStatus,
      setStatus: setBugReportStatus,
    },
  };
}
