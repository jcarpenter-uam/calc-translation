import { useCallback } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import { requestJson } from "../lib/api-client.js";

async function fetchReviews() {
  return requestJson(API_ROUTES.reviews.base, {}, "Failed to fetch reviews");
}

export function useAdminReviews() {
  const { data, error, isLoading, mutate } = useSWR(
    API_ROUTES.reviews.base,
    fetchReviews,
  );

  const refetch = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    reviews: data ?? [],
    loading: isLoading,
    error: error?.message || null,
    refetch,
  };
}
