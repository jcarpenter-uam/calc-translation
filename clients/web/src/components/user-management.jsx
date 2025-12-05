import React, { useState } from "react";
import { FaEdit, FaTrash, FaSave, FaTimes } from "react-icons/fa";

/**
 * A single row in the user list, handling its own edit state for admin toggling.
 */
function UserRow({ user, onToggleAdmin, onDelete }) {
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
        `Are you sure you want to delete ${user.name || user.email}?`,
      )
    ) {
      onDelete(user.id);
    }
  };

  if (isEditing) {
    return (
      <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm">
        <div className="flex flex-col gap-3">
          <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
            {user.name || "(No Name)"}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {user.email || "(No Email)"}
          </p>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            <strong>ID:</strong> {user.id}
          </div>

          <div className="mt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-zinc-900 dark:text-zinc-100">
                Set as Administrator
              </span>
            </label>
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <button
              onClick={handleSave}
              title="Save"
              className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1"
            >
              <FaSave /> Save
            </button>
            <button
              onClick={handleCancel}
              title="Cancel"
              className="px-3 py-1 bg-zinc-500 text-white rounded-md hover:bg-zinc-600 transition-colors flex items-center gap-1"
            >
              <FaTimes /> Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm flex justify-between items-start">
      <div>
        <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
          {user.name || "(No Name)"}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {user.email || "(No Email)"}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {user.is_admin && (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Admin
          </span>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setIsEditing(true)}
            title="Edit Admin Status"
            className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            <FaEdit />
          </button>
          <button
            onClick={handleDelete}
            title="Delete"
            className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            <FaTrash />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Stateless component to display a list of users and allow R, U, D operations.
 * @param {object[]} users - Array of user objects
 * @param {function} onToggleAdmin - (userId, newAdminStatus) => void
 * @param {function} onDeleteUser - (userId) => void
 */
export default function UserManagement({
  users = [],
  onToggleAdmin,
  onDeleteUser,
}) {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6 text-center">
        User Management
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
            No users found.
          </p>
        )}
      </div>
    </div>
  );
}
