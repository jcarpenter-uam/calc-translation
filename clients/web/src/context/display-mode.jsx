import React, { createContext, useContext, useState, useEffect } from "react";

const DisplayModeContext = createContext();

export const DisplayModeProvider = ({ children }) => {
  const [displayMode, setDisplayMode] = useState(() => {
    return localStorage.getItem("display_mode_preference") || "both";
  });

  useEffect(() => {
    localStorage.setItem("display_mode_preference", displayMode);
  }, [displayMode]);

  return (
    <DisplayModeContext.Provider value={{ displayMode, setDisplayMode }}>
      {children}
    </DisplayModeContext.Provider>
  );
};

export const useDisplayMode = () => useContext(DisplayModeContext);
