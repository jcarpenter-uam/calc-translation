import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import { JSON_HEADERS, requestJson, requestText } from "../lib/api-client.js";

function buildKey(status) {
  return `${API_ROUTES.bugReports.base}?status=${status}`;
}

export function useAdminBugReports(status = "open") {
  const swr = useSWR(buildKey(status), (url) =>
    requestJson(url, {}, "Failed to fetch bug reports"),
  );

  const setResolved = async (reportId, isResolved) => {
    const updated = await requestJson(
      API_ROUTES.bugReports.resolve(reportId),
      {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ is_resolved: isResolved }),
      },
      "Failed to update bug report status",
    );
    await swr.mutate();
    return updated;
  };

  const getLog = (reportId) =>
    requestText(
      API_ROUTES.bugReports.log(reportId),
      {},
      "Failed to fetch bug report log",
    );

  return {
    bugReports: swr.data ?? [],
    loading: swr.isLoading,
    error: swr.error?.message ?? null,
    refetch: () => swr.mutate(),
    setResolved,
    getLog,
  };
}
