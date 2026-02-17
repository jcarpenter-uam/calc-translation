export const API_ROUTES = {
  auth: {
    login: "/api/auth/login",
    zoom: "/api/auth/zoom",
    standalone: "/api/auth/standalone",
    calendarJoin: "/api/auth/calendar-join",
    zoomLinkPending: "/api/auth/zoom/link-pending",
  },
  users: {
    base: "/api/users/",
    admin: (userId) => `/api/users/${userId}/admin`,
    byId: (userId) => `/api/users/${userId}`,
  },
  tenants: {
    base: "/api/tenant/",
    byId: (tenantId) => `/api/tenant/${tenantId}`,
  },
  metrics: {
    server: "/api/metrics/server",
    zoom: "/api/metrics/zoom",
  },
  logs: {
    byLines: (lines) => `/api/logs/?lines=${lines}`,
  },
  calendar: {
    base: "/api/calender/",
    sync: "/api/calender/sync",
  },
};

export function buildSessionPath(type, sessionId, token, isHost = false) {
  return `/sessions/${type}/${encodeURIComponent(sessionId)}?token=${token}${isHost ? "&isHost=true" : ""}`;
}

export function buildSessionWsUrl(integration, sessionId, token, language) {
  return `/ws/view/${integration}/${encodeURIComponent(sessionId)}?token=${token}&language=${language}`;
}
