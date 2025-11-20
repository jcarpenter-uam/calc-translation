import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/landing";
import SessionPage from "./pages/session";
import HowItWorks from "./pages/how-it-works";
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";

export default function App() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          <Route path="/sessions/:integration/*" element={<SessionPage />} />

          <Route path="/how-it-works" element={<HowItWorks />} />

          <Route path="/privacy" element={<Privacy />} />

          <Route path="/terms" element={<Terms />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
