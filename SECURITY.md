# Security policy

Glass Compiler is a static web page. It has no server, no accounts, no cookies,
no analytics and makes no network requests after the page loads. Programs you
type run inside a small virtual machine written in TypeScript; nothing is ever
passed to `eval` or `new Function`.

## Supported versions

Only the latest version on the `main` branch (the one deployed to GitHub Pages)
is supported.

## Reporting a vulnerability

Please report security problems privately using GitHub's
**Security → Report a vulnerability** form on this repository
(private vulnerability reporting). Please don't open a public issue for a
security problem.

Include what you found, how to reproduce it and what impact you think it has.
This is a personal open-source project maintained in spare time, so there is no
guaranteed response time, but reports are read and taken seriously.

The project is provided as is, without warranty of any kind (see `LICENSE`).
