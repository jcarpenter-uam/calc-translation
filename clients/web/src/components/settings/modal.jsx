import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Theme from "./theme";
import Language from "./language";
import { FiX } from "react-icons/fi";

export default function SettingsModal({ isOpen, onClose }) {
  const modalRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Prevent background scrolling
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity">
      <div
        ref={modalRef}
        className="
          w-full max-w-md 
          bg-white dark:bg-zinc-900 
          rounded-xl 
          shadow-2xl 
          border border-zinc-200 dark:border-zinc-800
          overflow-hidden
          transform transition-all
        "
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="
              p-1 
              rounded-md 
              text-zinc-500 
              hover:bg-red-100 hover:text-red-700 
              dark:hover:bg-red-900 dark:hover:text-red-200 
              transition-colors
              cursor-pointer
            "
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Appearance
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-zinc-700 dark:text-zinc-200">Theme</span>
                <Theme />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Preferences
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-zinc-700 dark:text-zinc-200">
                  Language
                </span>
                <Language />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
