// Resolves the UI's own origin at runtime so all API/stream calls hit the
// same host the browser loaded the page from. Works for localhost, LAN IP,
// and Tailscale MagicDNS without any hardcoded host strings.
export const API_BASE_URL = window.location.origin;
