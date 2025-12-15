import React, { useState, useEffect } from "react";
import Header from "../components/header/header";
import UserAvatar from "../components/header/user.jsx";
import Language from "../components/header/language.jsx";
import Footer from "../components/misc/footer.jsx";
import UserManagement from "../components/admin/user-management.jsx";
import TenantManagement from "../components/admin/tenant-management.jsx";

// TODO: Make this look better later

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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

      if (!response.ok) {
        throw new Error("Failed to update admin status");
      }

      const updatedUser = await response.json();

      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.id === userId ? { ...user, ...updatedUser } : user,
        ),
      );
    } catch (err) {
      console.error("Admin toggle error:", err);
      setError(err.message);
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete user");
      }

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
      console.error("Create tenant error:", err);
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
      console.error("Update tenant error:", err);
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
      console.error("Delete tenant error:", err);
      setError(err.message);
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="text-center text-zinc-500 dark:text-zinc-400">
          Loading admin data...
        </div>
      );
    }
    if (error) {
      return <div className="text-center text-red-500">Error: {error}</div>;
    }
    return (
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
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <UserAvatar />
        <Language />
      </Header>

      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </main>

      <Footer />
    </div>
  );
}
