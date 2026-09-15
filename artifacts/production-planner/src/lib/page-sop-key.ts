/**
 * The key a page's SOP links hang off: the route path, normalised so every
 * copy of a parameterised page shares one set of SOPs. "/plans/123/station"
 * and "/plans/456/station" are the same PAGE — an SOP attached while looking
 * at one plan must show on all of them, so numeric id segments collapse to
 * "*". Query strings are views of a page, not pages, and are dropped.
 */
export function pageSopKey(pathname: string): string {
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  if (!path) return "/";
  return path
    .split("/")
    .map(seg => (/^\d+$/.test(seg) ? "*" : seg))
    .join("/");
}
