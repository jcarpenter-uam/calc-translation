import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { ThemeProvider } from "./context/theme.jsx";
import { LanguageProvider } from "./context/language.jsx";
import { PinProvider } from "./context/pin.jsx";
import { TileableProvider } from "./context/tileable.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <PinProvider>
          <TileableProvider>
            <App />
          </TileableProvider>
        </PinProvider>
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);
