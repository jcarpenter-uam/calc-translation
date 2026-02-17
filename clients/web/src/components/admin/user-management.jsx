import React, { useState } from "react";
import { FaEdit, FaTrash, FaSave, FaTimes } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import {
  AdminActionButton,
  AdminCard,
  AdminIconButton,
  AdminSection,
} from "./ui.jsx";

/**
 * A single row in the user list, handling its own edit state for admin toggling.
 */
function UserRow({ user, onToggleAdmin, onDelete }) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(user.is_admin);

  const handleSave = () => {
    if (isAdmin !== user.is_admin) {
      onToggleAdmin(user.id, isAdmin);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsAdmin(user.is_admin);
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (
      window.confirm(
        t("delete_confirm_user", { name: user.name || user.email }),
      )
    ) {
      onDelete(user.id);
    }
  };

  if (isEditing) {
    return (
      <AdminCard className="p-4 bg-white dark:bg-zinc-800">
        <div className="flex flex-col gap-3">
          <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
            {user.name || t("no_name_fallback")}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {user.email || t("no_email_fallback")}
          </p>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            <strong>{t("user_id_label")}</strong> {user.id}
          </div>

          <div className="mt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-zinc-900 dark:text-zinc-100">
                {t("set_admin_label")}
              </span>
            </label>
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <AdminActionButton
              onClick={handleSave}
              title={t("save_btn")}
              variant="primary"
            >
              <FaSave /> {t("save_btn")}
            </AdminActionButton>
            <AdminActionButton
              onClick={handleCancel}
              title={t("cancel_btn")}
              variant="secondary"
            >
              <FaTimes /> {t("cancel_btn")}
            </AdminActionButton>
          </div>
        </div>
      </AdminCard>
    );
  }

  return (
    <AdminCard className="p-4 bg-white dark:bg-zinc-800 flex justify-between items-start">
      <div>
        <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
          {user.name || t("no_name_fallback")}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {user.email || t("no_email_fallback")}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {user.is_admin && (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            {t("admin_badge")}
          </span>
        )}
        <div className="flex gap-2">
          <AdminIconButton
            onClick={() => setIsEditing(true)}
            title={t("edit_admin_status_title")}
            tone="blue"
          >
            <FaEdit />
          </AdminIconButton>
          <AdminIconButton
            onClick={handleDelete}
            title={t("delete_btn_title")}
            tone="red"
          >
            <FaTrash />
          </AdminIconButton>
        </div>
      </div>
    </AdminCard>
  );
}

/**
 * Stateless component to display a list of users and allow R, U, D operations.
 */
export default function UserManagement({
  users = [],
  onToggleAdmin,
  onDeleteUser,
}) {
  const { t } = useTranslation();
  return (
    <AdminSection>
      <h2 className="text-2xl font-semibold mb-6 text-center">
        {t("user_mgmt_title")}
      </h2>
      <div className="space-y-4">
        {users.length > 0 ? (
          users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              onToggleAdmin={onToggleAdmin}
              onDelete={onDeleteUser}
            />
          ))
        ) : (
          <p className="text-center text-zinc-500 dark:text-zinc-400">
            {t("no_users_found")}
          </p>
        )}
      </div>
    </AdminSection>
  );
}
