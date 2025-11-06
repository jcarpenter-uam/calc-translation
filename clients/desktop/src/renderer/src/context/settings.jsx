import React, { createContext, useContext, useState, useEffect } from "react";

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
  const [appVersion, setAppVersion] = useState("");
  const [isBetaEnabled, setIsBetaEnabled] = useState(false);

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
    fetchVersion();

    const savedSetting = localStorage.getItem("betaChannelEnabled");
    setIsBetaEnabled(savedSetting === "true");
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

  const value = {
    appVersion,
    isBetaEnabled,
    setBetaChannel,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => {
  return useContext(SettingsContext);
};
