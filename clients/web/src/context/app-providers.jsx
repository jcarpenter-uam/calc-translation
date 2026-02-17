import { Suspense } from "react";
import { ThemeProvider } from "./theme.jsx";
import { LanguageProvider } from "./language.jsx";
import { AuthProvider } from "./auth.jsx";
import { DisplayModeProvider } from "./display-mode.jsx";

export default function AppProviders({ children }) {
  return (
    <Suspense fallback={null}>
      <AuthProvider>
        <ThemeProvider>
          <LanguageProvider>
            <DisplayModeProvider>{children}</DisplayModeProvider>
          </LanguageProvider>
        </ThemeProvider>
      </AuthProvider>
    </Suspense>
  );
}
