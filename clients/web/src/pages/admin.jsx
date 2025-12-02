import Header from "../components/header";
import UserAvatar from "../components/user.jsx";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import Footer from "../components/footer.jsx";

export default function AdminPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <UserAvatar />
        <ThemeToggle />
        <LanguageToggle />
      </Header>

      <main className="flex-grow flex items-center justify-center container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-4 text-center">
              Admin page
            </h2>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
