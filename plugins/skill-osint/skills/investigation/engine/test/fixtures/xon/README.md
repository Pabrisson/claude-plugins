# XposedOrNot (recorded: 2026-11-06)

- `test@example.com.json`: `GET https://api.xposedornot.com/v1/check-email/test@example.com` → 200, `{ breaches: [[215 names]], email, status: "success" }` (an address the IANA reserves for examples).
- `no-such-mailbox-skill-osint@example.org.json`: the same call for an unknown address → **200** `{"Error":"Not found","email":null}` (not a 404: the service says « unknown » with a 200 today; the engine reads both).
- `contact@durand-bakery.example.json`, `jeanne@durand-bakery.example.json`: invented (the demo's company); not recorded.

No « found » answer exists for another public address in XposedOrNot's documentation, so none was added. Gravatar: `../gravatar/*.404.json` are real 404 answers (`{"error":"Profile not found"}`, 2026-11-06 for `test@example.com`); the Gravatar profile fixture of the demo is invented (no public profile of an organisation was known).
