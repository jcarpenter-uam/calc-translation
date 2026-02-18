import React, { useCallback, useRef, useState } from "react";
import { useAuth } from "../../context/auth.jsx";
import SettingsModal from "../settings/modal.jsx";
import { useTranslation } from "react-i18next";
import { useClickOutside } from "../../hooks/use-click-outside.js";

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
  const { t } = useTranslation();
  const { user, isLoading, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  useClickOutside(dropdownRef, closeDropdown);

  if (isLoading || !user) {
    return null;
  }

  const { name, is_admin } = user;
  const initials = getInitials(name);

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          title={t("user_menu_tooltip", { name })}
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

        {isOpen && (
          <div
            className="
              absolute 
              left-0 
              top-full 
              mt-2 
              w-48 
              bg-white 
              dark:bg-zinc-800 
              border 
              border-zinc-200 
              dark:border-zinc-700 
              rounded-md 
              shadow-lg 
              z-50
              overflow-hidden
            "
          >
            <ul className="py-1">
              <li>
                <a
                  href="/"
                  className="
                    block 
                    px-4 py-2 
                    text-sm 
                    text-zinc-700 
                    dark:text-zinc-200 
                    hover:bg-zinc-100 
                    dark:hover:bg-zinc-700
                    transition-colors
                  "
                >
                  {t("menu_home")}
                </a>
              </li>

              <li>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setIsSettingsOpen(true);
                  }}
                  className="
                    block 
                    w-full
                    text-left
                    px-4 py-2 
                    text-sm 
                    text-zinc-700 
                    dark:text-zinc-200 
                    hover:bg-zinc-100 
                    dark:hover:bg-zinc-700
                    transition-colors
                    cursor-pointer
                  "
                >
                  {t("menu_settings")}
                </button>
              </li>

              {is_admin && (
                <li>
                  <a
                    href="/admin"
                    className="
                      block 
                      px-4 py-2 
                      text-sm 
                      text-zinc-700 
                      dark:text-zinc-200 
                      hover:bg-zinc-100 
                      dark:hover:bg-zinc-700
                      transition-colors
                    "
                  >
                    {t("menu_admin")}
                  </a>
                </li>
              )}

              <li>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    logout();
                  }}
                  className="
                    block 
                    w-full 
                    text-left 
                    px-4 py-2 
                    text-sm 
                    text-zinc-700 
                    dark:text-zinc-200 
                    hover:bg-zinc-100 
                    dark:hover:bg-zinc-700
                    transition-colors
                    cursor-pointer
                  "
                >
                  {t("menu_logout")}
                </button>
              </li>
            </ul>
          </div>
        )}
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
}
