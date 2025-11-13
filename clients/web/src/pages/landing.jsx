// This is the main landing page for the app
// Explains the app and how to use
// Prompts user first for integration, for now this is only zoom
// When integration = zoom prompt for meeting id and meeting password

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/header";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import { IntegrationCard, ZoomForm } from "../components/integration-card.jsx";

import { BiLogoZoom } from "react-icons/bi";

export default function LandingPage() {
  const [integration, setIntegration] = useState(null);
  const navigate = useNavigate();

  const handleJoin = (type, sessionId) => {
    navigate(`/sessions/${type}/${sessionId}`);
  };

  const renderForm = () => {
    if (integration === "zoom") {
      return (
        <ZoomForm onSubmit={(sessionId) => handleJoin("zoom", sessionId)} />
      );
    }
    return null;
  };

  return (
    <>
      <Header>
        <ThemeToggle />
        <LanguageToggle />
      </Header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-md mx-auto space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-4 text-center">
              Choose your integration
            </h2>
            <div className="flex flex-wrap justify-center gap-4">
              <IntegrationCard
                id="zoom"
                title="Zoom"
                icon={<BiLogoZoom className="h-7 w-7 text-blue-500" />}
                selected={integration}
                onSelect={setIntegration}
              />
            </div>
          </div>

          <div className="transition-all">{renderForm()}</div>
        </div>
      </main>
    </>
  );
}
