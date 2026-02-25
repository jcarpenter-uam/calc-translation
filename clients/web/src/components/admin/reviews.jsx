import React from "react";
import { AdminCard, AdminSection } from "./ui.jsx";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ReviewsManagement({ reviews = [], loading, error, onRefresh }) {
  return (
    <AdminSection className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Reviews
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          Failed to load reviews: {error}
        </div>
      ) : (
        <AdminCard className="overflow-hidden bg-white dark:bg-zinc-900">
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
              <thead className="bg-zinc-50 dark:bg-zinc-800">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">
                    User
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">
                    Rating
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">
                    Note
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase">
                    Left At
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {reviews.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-sm text-center text-zinc-500 dark:text-zinc-400"
                    >
                      No reviews yet.
                    </td>
                  </tr>
                ) : (
                  reviews.map((review) => (
                    <tr key={review.id} className="align-top">
                      <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {review.user_name || "Unknown"}
                        </div>
                        <div className="text-zinc-500 dark:text-zinc-400">
                          {review.user_email || review.user_id}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                        ({review.rating}-5)
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300 max-w-md whitespace-pre-wrap break-words">
                        {review.note || "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {formatDate(review.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
    </AdminSection>
  );
}
