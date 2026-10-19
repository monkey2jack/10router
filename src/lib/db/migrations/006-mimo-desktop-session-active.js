// Flip the Desktop card's never-validated session rows from "untested" to
// "active".
//
// A mimo-desktop row has no sk- key to test — its credential is the account
// session that was just read out of a signed-in MiMo Desktop at import time,
// so "untested" on a fresh add is noise (the badge implies a validation step
// that does not exist for this card). The import succeeding IS the check:
// a passToken was read, therefore the session was alive at that moment.
//
// Idempotent: rows whose testStatus is anything other than "untested"
// (including rows that later failed and recorded an error state) are left
// untouched. Fail-open: unreadable data blobs are skipped.
export default {
  version: 6,
  name: "mimo-desktop-session-active",
  up(db) {
    let rows;
    try {
      rows = db.all(`SELECT id, data FROM providerConnections WHERE provider = 'mimo-desktop'`);
    } catch (err) {
      console.warn("[migration] mimo-desktop-session-active: could not read connections:", err?.message || err);
      return;
    }

    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        if (data.testStatus !== "untested") continue;
        data.testStatus = "active";
        db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [JSON.stringify(data), row.id]);
      } catch {
        // Unreadable/undecodable blob — leave the row alone.
      }
    }
  },
};
