import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/auth/protected-route";
import Layout from "./components/general/layout";
import Login from "./pages/login";
import LandingPage from "./pages/landing";
import SessionPage from "./pages/session";
import Support from "./pages/support";
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";
import ScrollToTop from "./components/misc/scroll-to-top";
import AdminPage from "./pages/admin";
import NotFound from "./pages/not-found";

export default function App() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<Layout />}>
            <Route path="/support" element={<Support />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />

            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<LandingPage />} />
              <Route
                path="/sessions/:integration/*"
                element={<SessionPage />}
              />
            </Route>

            <Route element={<ProtectedRoute adminOnly={true} />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </div>
  );
}
