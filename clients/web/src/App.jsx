import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/login";
import LandingPage from "./pages/landing";
import SessionPage from "./pages/session";
import Support from "./pages/support";
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";
import ScrollToTop from "./util/scroll-to-top";

export default function App() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={<LandingPage />} />

          <Route path="/sessions/:integration/*" element={<SessionPage />} />

          <Route path="/support" element={<Support />} />

          <Route path="/privacy" element={<Privacy />} />

          <Route path="/terms" element={<Terms />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
