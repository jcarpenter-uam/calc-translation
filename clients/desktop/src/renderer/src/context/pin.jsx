import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const PinContext = createContext(null);

export function PinProvider({ children }) {
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    const getInitialPinState = async () => {
      try {
        if (
          window.electron &&
          typeof window.electron.isAlwaysOnTop === "function"
        ) {
          const initialState = await window.electron.isAlwaysOnTop();
          setIsPinned(initialState);
        }
      } catch (error) {
        console.error("Failed to get initial pin state:", error);
      }
    };
    getInitialPinState();
  }, []);

  const togglePin = useCallback(async () => {
    try {
      const newState = await window.electron.toggleAlwaysOnTop();
      setIsPinned(newState);
    } catch (error) {
      console.error("Failed to toggle pin:", error);
    }
  }, []);

  const value = { isPinned, togglePin };

  return <PinContext.Provider value={value}>{children}</PinContext.Provider>;
}

export function usePin() {
  const context = useContext(PinContext);
  if (!context) {
    throw new Error("usePin must be used within a PinProvider");
  }
  return context;
}
