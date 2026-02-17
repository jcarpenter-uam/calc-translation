function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function AdminSection({ className, children }) {
  return <div className={cn("w-full max-w-4xl mx-auto", className)}>{children}</div>;
}

export function AdminCard({ className, children }) {
  return (
    <div
      className={cn(
        "rounded-lg shadow border border-zinc-200 dark:border-zinc-700",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AdminActionButton({
  onClick,
  title,
  variant = "primary",
  className,
  children,
}) {
  const variantClass =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "bg-zinc-500 text-white hover:bg-zinc-600";

  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "px-3 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer",
        variantClass,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function AdminIconButton({
  onClick,
  title,
  tone = "blue",
  className,
  children,
}) {
  const toneClass =
    tone === "blue"
      ? "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      : "text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300";

  return (
    <button
      onClick={onClick}
      title={title}
      className={cn("p-2 transition-colors cursor-pointer", toneClass, className)}
    >
      {children}
    </button>
  );
}

export function AdminDangerTextButton({ onClick, className, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-xs text-red-600 hover:text-red-800 dark:text-red-400 flex items-center gap-1 cursor-pointer",
        className,
      )}
    >
      {children}
    </button>
  );
}
