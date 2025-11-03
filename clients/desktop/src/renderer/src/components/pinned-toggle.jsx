import React from "react";
import { PushPin, PushPinSlash } from "@phosphor-icons/react";
import { usePin } from "../context/pin.jsx";

/**
 * A component to toggle the window's "always on top" state.
 * Color-matched to the ThemeToggle button for visual consistency.
 */
export default function PinToggle() {
  const { isPinned, togglePin } = usePin();

  return (
    <button
      onClick={togglePin}
      aria-pressed={isPinned}
      aria-label={isPinned ? "Unpin window" : "Pin window"}
      title={isPinned ? "Unpin window" : "Pin window"}
      className={[
        "p-2 rounded-full transition-colors duration-150",
        "flex items-center justify-center",
        "text-zinc-500 dark:text-zinc-400",
        "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        "focus:outline-none focus:ring-2 focus:ring-offset-2",
        "focus:ring-blue-500 dark:focus:ring-offset-zinc-900",
        isPinned
          ? "text-blue-500 bg-zinc-100 dark:bg-zinc-800"
          : "hover:text-zinc-700 dark:hover:text-zinc-300",
      ].join(" ")}
    >
      {isPinned ? (
        <PushPin className="w-5 h-5" />
      ) : (
        <PushPinSlash className="w-5 h-5" />
      )}
    </button>
  );
}
