export default function Header({ children }) {
  return (
    <header className="sticky top-0 z-50 w-full bg-white/80 dark:bg-zinc-900/80">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex items-center justify-start h-16">
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* It just renders whatever components the parent page gives it */}
            {children}
          </div>
        </div>
      </div>
    </header>
  );
}
