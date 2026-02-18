import { Suspense } from "react";
import { SWRConfig } from "swr";
import { ThemeProvider } from "./theme.jsx";
import { LanguageProvider } from "./language.jsx";
import { AuthProvider } from "./auth.jsx";
import { DisplayModeProvider } from "./display-mode.jsx";

export default function AppProviders({ children }) {
  return (
    <Suspense fallback={null}>
      <SWRConfig
        value={{
          dedupingInterval: 10_000,
          revalidateOnFocus: false,
          shouldRetryOnError: false,
        }}
      >
        <AuthProvider>
          <ThemeProvider>
            <LanguageProvider>
              <DisplayModeProvider>{children}</DisplayModeProvider>
            </LanguageProvider>
          </ThemeProvider>
        </AuthProvider>
      </SWRConfig>
    </Suspense>
  );
}
