# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, by email to **security@joinronde.com**, rather than in a public
issue or discussion. If you can, include:

- the version of Ronde (the image tag, or the commit) and whether it is self-hosted or the cloud;
- the steps to reproduce, and what an attacker gains;
- any proof of concept, logs or screenshots.

We acknowledge your report, keep you informed while we work on it, and credit you in the release notes
unless you prefer otherwise. Please give us a reasonable time to ship a fix before disclosing the issue.

## Supported versions

Fixes go into the latest release. Self-hosted instances should follow the releases: upgrading is a matter
of pulling the new images (see the [self-hosting guide](docs/self-hosting/README.md#upgrade)).

## Scope

In scope: the code of this repository (the Community edition and the `ee` folder), the published images
`ghcr.io/joinronde/*`, and the Ronde cloud (`app.joinronde.com`).

Out of scope: denial of service by volume, reports from automated scanners without a demonstrated impact,
missing security headers without an exploit, and issues in a self-hosted instance caused by its own
configuration (for example a reverse proxy that exposes the database).

Testing against the cloud must stay within your own workspaces and accounts: never access, change or
delete other people's data, and stop as soon as you reach data that is not yours.
