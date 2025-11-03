import React from "react";
import { SquaresFour } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { Square } from "@phosphor-icons/react/dist/csr/Square";
import { useTileable } from "../context/tileable.jsx";

/**
 * Button to change between tileable and nontileable.
 */
export default function TileableToggle() {
  const { isTileable, toggleTileable } = useTileable();

  return (
    <button
      onClick={toggleTileable}
      className="p-2 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900"
      aria-label="Toggle tileable"
      aria-pressed={isTileable}
    >
      {isTileable ? (
        <SquaresFour className="w-5 h-5" />
      ) : (
        <Square className="w-5 h-5" />
      )}
    </button>
  );
}
