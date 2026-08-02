# Vault custody: password-locked interface, gitignored vault, external backup

Access control lives at the interface: when ELICIT_PASSWORD is set, all
routes require a session cookie (constant-time compare). The vault and all
personal content stay permanently gitignored from the project repo —
separation of code from corpus. No encryption at rest: single-user machines
on a home LAN, and key-loss would forfeit the self-archive, a worse expected
outcome than the threat it counters. Backup is delegated to the user's
existing file-backup infrastructure (the vault is plain markdown by design,
Q-3); ticket "Put vault/ inside a backup regime" tracks it. Host-binding
beyond localhost (ELICIT_HOST) must not precede the password gate.

## Considered Options

- Vault as private git repo pushed to self-hosted Forgejo (rejected by user:
  personal folders stay out of git entirely)
- Encryption at rest (rejected for now: key-management risk exceeds threat;
  revisit if the vault ever syncs off-premises)
- Password-locked interface + gitignore + external backup (chosen — Q-25)
