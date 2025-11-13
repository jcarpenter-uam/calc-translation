// This is the main landing page for the app
// Explains the app and how to use
// Prompts user first for integration, for now this is only zoom
// When integration = zoom prompt for meeting id and meeting password

import Header from "../components/header";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";

export default function LandingPage() {
  return (
    <Header>
      <ThemeToggle />
      <LanguageToggle />
    </Header>
  );
}
