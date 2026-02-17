export const JSON_HEADERS = { "Content-Type": "application/json" };

export async function apiFetch(url, options = {}) {
  return fetch(url, options);
}

export async function getErrorMessage(response, fallbackMessage) {
  const fallback = fallbackMessage || "Request failed";

  try {
    const data = await response.json();
    return data?.detail || data?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function requestJson(url, options = {}, fallbackMessage) {
  const response = await apiFetch(url, options);

  if (!response.ok) {
    const message = await getErrorMessage(response, fallbackMessage);
    throw new Error(message);
  }

  return response.json();
}

export async function requestText(url, options = {}, fallbackMessage) {
  const response = await apiFetch(url, options);

  if (!response.ok) {
    const message = await getErrorMessage(response, fallbackMessage);
    throw new Error(message);
  }

  return response.text();
}
