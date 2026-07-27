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
