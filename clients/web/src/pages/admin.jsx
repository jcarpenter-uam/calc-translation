import React, { useState, useEffect } from "react";
import Header from "../components/header";
import UserAvatar from "../components/user.jsx";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import Footer from "../components/footer.jsx";
import UserManagement from "../components/user-management.jsx";

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/users/");
        if (!response.ok) {
          throw new Error("Failed to fetch users");
        }
        const data = await response.json();
        setUsers(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const handleToggleAdmin = async (userId, newAdminStatus) => {
    try {
      const response = await fetch(`/api/users/${userId}/admin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_admin: newAdminStatus }),
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
      console.error("Admin update error:", err);
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

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="text-center text-zinc-500 dark:text-zinc-400">
          Loading users...
        </div>
      );
    }
    if (error) {
      return <div className="text-center text-red-500">Error: {error}</div>;
    }
    return (
      <UserManagement
        users={users}
        onToggleAdmin={handleToggleAdmin}
        onDeleteUser={handleDeleteUser}
      />
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <UserAvatar />
        <ThemeToggle />
        <LanguageToggle />
      </Header>

      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </main>

      <Footer />
    </div>
  );
}
