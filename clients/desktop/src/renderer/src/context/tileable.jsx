import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const TileableContext = createContext(null);

export function TileableProvider({ children }) {
  const [isTileable, setIsTileable] = useState(false);

  useEffect(() => {
    const getInitialTileableState = async () => {
      try {
        if (
          window.electron &&
          typeof window.electron.isTileable === "function"
        ) {
          const initialState = await window.electron.isTileable();
          setIsTileable(initialState);
        }
      } catch (error) {
        console.error("Failed to get initial tileable state:", error);
      }
    };
    getInitialTileableState();
  }, []);

  const toggleTileable = useCallback(async () => {
    try {
      if (
        window.electron &&
        typeof window.electron.toggleTileable === "function"
      ) {
        const newState = await window.electron.toggleTileable();
        setIsTileable(newState);
      } else {
        setIsTileable((prev) => !prev);
        console.warn(
          "window.electron.toggleTileable not found. Using local state.",
        );
      }
    } catch (error) {
      console.error("Failed to toggle tileable:", error);
    }
  }, []);

  const value = { isTileable, toggleTileable };

  return (
    <TileableContext.Provider value={value}>
      {children}
    </TileableContext.Provider>
  );
}

export function useTileable() {
  const context = useContext(TileableContext);
  if (!context) {
    throw new Error("useTileable must be used within a TileableProvider");
  }
  return context;
}
