import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [appVersion, setAppVersion] = useState("");
  const [isBetaEnabled, setIsBetaEnabled] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    async function fetchVersion() {
      try {
        const version = await window.electron.getAppVersion();
        setAppVersion(version);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setAppVersion("N/A");
      }
    }

    async function getInitialPinState() {
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
    }

    const savedSetting = localStorage.getItem("betaChannelEnabled");
    const isEnabled = savedSetting === "true";
    setIsBetaEnabled(isEnabled);

    async function syncChannelSetting() {
      try {
        await window.electron.setUpdateChannel(isEnabled);
      } catch (error) {
        console.error("Failed to sync update channel on load:", error);
      }
    }

    fetchVersion();
    getInitialPinState();
    syncChannelSetting();
  }, []);

  const setBetaChannel = async (isEnabled) => {
    setIsBetaEnabled(isEnabled);
    localStorage.setItem("betaChannelEnabled", isEnabled);
    try {
      await window.electron.setUpdateChannel(isEnabled);
    } catch (error) {
      console.error("Failed to set update channel:", error);
    }
  };

  const togglePin = useCallback(async () => {
    try {
      const newState = await window.electron.toggleAlwaysOnTop();
      setIsPinned(newState);
    } catch (error) {
      console.error("Failed to toggle pin:", error);
    }
  }, []);

  const value = {
    appVersion,
    isBetaEnabled,
    setBetaChannel,
    isPinned,
    togglePin,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
};
