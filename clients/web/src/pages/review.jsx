import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_ROUTES } from "../constants/routes.js";
import { JSON_HEADERS, requestJson } from "../lib/api-client.js";

const STARS = [1, 2, 3, 4, 5];

export default function ReviewPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [rating, setRating] = useState(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("Missing review token in the link.");
      return;
    }
    if (!rating) {
      setError("A rating is required.");
      return;
    }
    if (!note.trim()) {
      setError("A note is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestJson(
        API_ROUTES.reviews.submit,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            token,
            rating,
            note,
          }),
        },
        "Failed to submit review.",
      );
      setIsSubmitted(true);
    } catch (submitError) {
      setError(submitError.message || "Failed to submit review.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto w-full">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Leave a Review
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Rate your experience from 1 to 5 stars and share feedback.
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This goes directly to the developer. Use it to report issues, suggest features, or share what you liked or disliked.
        </p>

        {!token && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            This link is missing a review token.
          </div>
        )}

        {isSubmitted ? (
          <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            Thanks for your feedback.
          </div>
        ) : (
          <form className="mt-6 space-y-6" onSubmit={onSubmit}>
            <div>
              <label className="block text-sm font-medium mb-2">Rating *</label>
              <div
                className="flex items-center gap-2"
                role="radiogroup"
                aria-label="Star rating"
              >
                {STARS.map((value) => {
                  const selected = rating !== null && value <= rating;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setRating(value)}
                      className={`cursor-pointer text-3xl leading-none transition-colors ${
                        selected
                          ? "text-amber-500"
                          : "text-zinc-300 hover:text-zinc-400 dark:text-zinc-700 dark:hover:text-zinc-600"
                      }`}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="note" className="block text-sm font-medium mb-2">
                Note *
              </label>
              <textarea
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Report an issue, suggest a feature, or share what you liked or disliked."
                rows={5}
                required
                maxLength={2000}
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !token || !rating || !note.trim()}
              className="cursor-pointer inline-flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2"
            >
              {isSubmitting ? "Submitting..." : "Submit Review"}
            </button>
          </form>
        )}

        <Link
          to="/"
          className="mt-6 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
