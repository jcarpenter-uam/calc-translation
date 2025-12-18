import { StrictMode, Suspense } from "react"; // Import Suspense
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { ThemeProvider } from "./context/theme.jsx";
import { LanguageProvider } from "./context/language.jsx";
import { AuthProvider } from "./context/auth";
import { DisplayModeProvider } from "./context/display-mode.jsx";

import "./i18n";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Suspense fallback={null}>
      <AuthProvider>
        <ThemeProvider>
          <LanguageProvider>
            <DisplayModeProvider>
              <App />
            </DisplayModeProvider>
          </LanguageProvider>
        </ThemeProvider>
      </AuthProvider>
    </Suspense>
  </StrictMode>,
);
