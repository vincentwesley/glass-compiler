# Security policy

The Glass series (Glass Compiler, the hub and the members that follow) is a set
of static web pages. They have no server, no accounts, no cookies, no analytics
and make no network requests to other sites. Programs you type run inside small
virtual machines written in TypeScript or Rust compiled to WebAssembly; nothing
is ever passed to `eval` or `new Function`. Files you load (for example a ROM in
Glass Console) stay in your browser. Every page carries a strict Content
Security Policy; pages that run WebAssembly add only `'wasm-unsafe-eval'`.

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
