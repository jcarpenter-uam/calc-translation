import React from "react";
import { useTranslation } from "react-i18next";
import { useAdminPageData } from "../hooks/use-admin-page-data.js";
import { AdminProvider } from "../context/admin.jsx";
import {
  UserManagementSection,
  TenantManagementSection,
  MetricsSection,
  LogViewingSection,
} from "../components/admin/sections.jsx";

export default function AdminPage() {
  const { t } = useTranslation();
  const adminData = useAdminPageData();

  if (adminData.isPageLoading) {
    return (
      <div className="w-full">
        <div className="text-center text-zinc-500 dark:text-zinc-400">
          {t("loading_admin")}
        </div>
      </div>
    );
  }

  if (adminData.pageError) {
    return (
      <div className="w-full">
        <div className="text-center text-red-500">Error: {adminData.pageError}</div>
      </div>
    );
  }

  return (
    <AdminProvider value={adminData}>
      <div className="w-full">
        <div className="space-y-12">
          <UserManagementSection />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <TenantManagementSection />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <MetricsSection />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <LogViewingSection />
        </div>
      </div>
    </AdminProvider>
  );
}
