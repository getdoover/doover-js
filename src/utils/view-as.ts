/** The view-as session the app started, if any (set by the site's "View as"). */
export function viewAsSession(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem("view_as_session");
}
