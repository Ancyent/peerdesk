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
