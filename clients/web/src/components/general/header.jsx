import React, { useState } from "react";
import { useAuth } from "../../context/auth";
import UserAvatar from "./user";
import SettingsModal from "../settings/modal";
import { FiSettings } from "react-icons/fi";

export default function Header() {
  const { user, isLoading } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            {!isLoading && (
              <>
                {user ? (
                  <UserAvatar />
                ) : (
                  <>
                    <button
                      onClick={() => setIsSettingsOpen(true)}
                      aria-label="Open Settings"
                      className="
                        p-2 
                        rounded-full 
                        text-zinc-500 
                        hover:bg-zinc-100 
                        dark:text-zinc-400 
                        dark:hover:bg-zinc-800 
                        transition-colors
                        focus:outline-none 
                        focus:ring-2 
                        focus:ring-blue-500 
                        focus:ring-offset-2 
                        dark:focus:ring-offset-zinc-900
                      "
                    >
                      <FiSettings className="w-5 h-5" />
                    </button>

                    <SettingsModal
                      isOpen={isSettingsOpen}
                      onClose={() => setIsSettingsOpen(false)}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
