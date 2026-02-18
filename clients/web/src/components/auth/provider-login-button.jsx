export default function ProviderLoginButton({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer w-full py-2.5 px-4 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-zinc-100 font-medium rounded-md border border-zinc-300 dark:border-zinc-600 flex items-center justify-center gap-3 transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}
