# Security notes

A standing register of accepted risks. Each entry says what the risk is, why it
was accepted, and what would remove it. Append; do not rewrite history.

## API keys are stored in plaintext

**Status:** accepted, 2026-07-27, at the project owner's explicit instruction.

`api_keys.key` is a plain `varchar(40)`. Any database dump exposes every API key
in directly usable form.

`POST /api-keys/{id}/reveal` does not create this risk — it already existed —
but it commits the project to keeping keys recoverable, which forecloses
hashing them later without a migration and a user-visible behaviour change.

**What would remove it:** store only a hash, show the key once at creation, and
make a lost key mean issuing a new one. That is now cheap operationally: a
reinstalled agent given a fresh key re-enrols itself automatically (commit
`148fe74`), so replacing a key no longer means touching the machine.

**Revisit when** convenience stops outweighing the exposure — for example
before any third party is given database access, or before the first customer
deployment this project does not itself operate.

`POST /api-keys/{id}/reveal` also creates a second consequence beyond
plaintext storage: it is an authenticated, 2FA-free, unthrottled
password-verification oracle. `/auth/login` requires a second factor for
users who have 2FA enabled; reveal checks the password alone, so a stolen
refresh token gives an attacker a password oracle for the life of that
token, bypassing 2FA entirely for that one check. bcrypt bounds the
achievable rate, and the project has no rate limiting anywhere, including on
login, so this endpoint is not a bypass of an existing control — nothing
here throttles login either — but it belongs in this register as its own
recorded risk.

Reveals are also not audited: nothing logs who called this endpoint or when,
so a compromised admin session can exfiltrate every key in the account and
leave no record of having done so.

## The access token is sent over the signaling websocket

**Status:** accepted, 2026-07-28.

A viewer's access token is attached to the `join` message so the signaling
server can resolve who is connecting. In production nginx terminates TLS and the
signaling path is `wss`, so it is encrypted in transit, but the token now
appears in a second channel rather than only on API calls.

Signaling never stores the token and never holds `JWT_SECRET` — it forwards the
token once to `GET /users/me` and keeps only the resulting id and name. A
compromise of the signaling service therefore cannot forge tokens, though it
could observe tokens presented to it while the compromise lasts.

**What would remove it:** issue a short-lived, single-use ticket from the API
and present that to signaling instead, so the access token never leaves the API
connection. That was considered and set aside as more moving parts than the risk
warranted; it remains the upgrade path if signaling ever runs somewhere less
trusted than the API.
