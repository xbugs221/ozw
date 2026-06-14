# Security Policy

ozw is a local web workbench that can read repositories, run shell commands, access provider credentials through local provider configuration, and manage workflow state. Treat it as developer tooling with access to your local machine.

## Supported Versions

Security fixes target the latest released version on the default branch. Older tags may not receive backports.

## Reporting a Vulnerability

Please report security issues privately instead of opening a public issue.

If GitHub private vulnerability reporting is enabled for the repository, use that channel. Otherwise contact the maintainer through the repository owner's published GitHub contact route.

Include:

- affected version or commit;
- operating system and install method;
- reproduction steps;
- expected and actual impact;
- whether credentials, repository contents, or shell access are involved.

## Local Deployment Notes

- Run ozw only on machines and networks you trust.
- Bind to localhost when exposing ozw outside a trusted development network is not required.
- Do not commit `.env`, provider credentials, runtime databases, or state directories.
- Review agent-generated changes before applying or publishing them.
- Avoid running ozw with access to production secrets unless you have a clear operational reason.
