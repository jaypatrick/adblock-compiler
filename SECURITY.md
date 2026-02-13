# Security Policy

## Supported Versions

Security updates are provided for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.12.x  | :white_check_mark: |
| < 0.12  | :x:                |

## Security Features

### SSRF Protection

The adblock-compiler includes comprehensive Server-Side Request Forgery (SSRF) protection to prevent malicious source URLs from accessing internal network resources:

- **Localhost blocking**: Prevents access to localhost, 127.0.0.0/8, ::1, and other loopback addresses
- **Private IP blocking**: Blocks access to private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
- **Link-local blocking**: Prevents access to link-local addresses (169.254.0.0/16, fe80::/10)
- **Protocol validation**: Only HTTP and HTTPS protocols are allowed

All URL fetching operations are validated before execution to prevent:
- Access to internal network resources
- Exposure of sensitive data from internal services
- Network topology probing
- Firewall bypass attempts

### Safe Expression Parsing

The compiler uses a safe boolean expression parser that does not use `eval()` or the `Function` constructor, preventing code injection attacks.

### Input Validation

All configuration inputs are validated using TypeScript type checking and runtime validation to ensure data integrity and prevent malicious inputs.

## Reporting a Vulnerability

If you discover a security vulnerability in the adblock-compiler, please report it by:

1. **DO NOT** open a public GitHub issue
2. Email the maintainers at: [security contact needed]
3. Include:
   - A description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact
   - Suggested fix (if available)

### What to Expect

- **Initial Response**: Within 48 hours
- **Triage**: Within 5 business days
- **Fix Timeline**: Critical vulnerabilities will be addressed within 7-14 days
- **Disclosure**: Coordinated disclosure after a fix is available

### Security Updates

Security patches will be released as soon as possible after verification. Users will be notified via:
- GitHub Security Advisories
- Release notes
- CHANGELOG.md

Thank you for helping keep adblock-compiler secure!
