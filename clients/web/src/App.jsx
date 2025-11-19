import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/landing";
import SessionPage from "./pages/session";

export default function App() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          <Route path="/sessions/:integration/*" element={<SessionPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
