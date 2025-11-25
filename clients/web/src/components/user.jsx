import React from "react";
import { useAuth } from "../context/auth";

/**
 * Generates initials from a full name.
 * @param {string} name - The user's full name (e.g., "Jonah Carpenter").
 * @returns {string} The uppercase initials (e.g., "JC").
 */
const getInitials = (name) => {
  if (!name || typeof name !== "string") {
    return "?";
  }
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const firstInitial = parts[0][0];
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (firstInitial + lastInitial).toUpperCase();
};

export default function UserAvatar() {
  const { user, isLoading, logout } = useAuth();

  if (isLoading || !user) {
    return null;
  }

  const { name } = user;
  const initials = getInitials(name);

  return (
    <button
      onClick={logout}
      title={`Logged in as ${name}. Click to log out.`}
      className="
        flex 
        items-center 
        justify-center 
        h-10 w-10 
        rounded-full 
        bg-blue-600 
        dark:bg-blue-700 
        text-white 
        font-semibold 
        text-sm 
        select-none
        flex-shrink-0
        cursor-pointer
        hover:bg-blue-700
        dark:hover:bg-blue-800
        focus:outline-none
        focus:ring-2
        focus:ring-blue-500
        focus:ring-offset-2
        dark:focus:ring-offset-zinc-900
        transition-colors
      "
    >
      {initials}
    </button>
  );
}
