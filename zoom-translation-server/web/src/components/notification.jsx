export default function Notification({ message, visible }) {
  return (
    <div
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-800 dark:bg-zinc-100 text-white dark:text-black rounded-full shadow-lg transition-opacity duration-300 ${
        visible ? "opacity-40" : "opacity-0"
      }`}
    >
      {message}
    </div>
  );
}
