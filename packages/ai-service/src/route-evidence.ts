/**
 * The one rule for "this address has no such route": the provider answered that the endpoint does not exist (404 Not Found, 405 Method Not
 * Allowed, 501 Not Implemented). Authentication (401/403), quota (429), server (5xx other than 501) and network failures say nothing about
 * whether the route exists, so they are never taken for it. Text requests and picture requests read this same rule.
 */
export const ROUTE_MISSING_STATUSES: readonly number[] = [404, 405, 501]

export const routeMissing = (status: number) => ROUTE_MISSING_STATUSES.includes(status)
