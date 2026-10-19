/**
 * Request headers that authenticate local CLI calls and password-gated
 * dashboard actions.
 *
 * Renamed from the inherited 9router `x-9r-*` names. The old names are still
 * ACCEPTED on the way in, so an already-installed CLI launcher or sync plugin
 * that predates the rename keeps working. Senders inside this app use only the
 * new names; external clients (cli/, zcode-plugin/) send both until servers
 * older than the rename are gone.
 *
 * Every server-side reader goes through readCliToken / readDashboardPassword —
 * the guard validates the CLI token value and the routes trust its presence, so
 * both sides must agree on exactly which header names count.
 */

export const CLI_TOKEN_HEADER = "x-10r-cli-token";
export const PASSWORD_HEADER = "x-10r-password";

export const LEGACY_CLI_TOKEN_HEADER = "x-9r-cli-token";
export const LEGACY_PASSWORD_HEADER = "x-9r-password";

export function readCliToken(request) {
  return request.headers.get(CLI_TOKEN_HEADER) || request.headers.get(LEGACY_CLI_TOKEN_HEADER) || null;
}

export function readDashboardPassword(request) {
  return request.headers.get(PASSWORD_HEADER) || request.headers.get(LEGACY_PASSWORD_HEADER) || null;
}
