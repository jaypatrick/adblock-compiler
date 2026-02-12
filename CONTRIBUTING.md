# Contributing to Adblock Compiler

Thank you for your interest in contributing to the Adblock Compiler project! This guide will help you get started.

## Development Setup

1. **Prerequisites**
   - [Deno](https://deno.land/) 2.x or higher
   - Git

2. **Clone and Setup**
   ```bash
   git clone https://github.com/jaypatrick/adblock-compiler.git
   cd adblock-compiler
   deno cache src/index.ts
   ```

3. **Run Tests**
   ```bash
   deno task test
   ```

## Commit Message Guidelines

We use **Conventional Commits** for automatic version bumping and changelog generation.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

### Types

- `feat:` - New feature (triggers **minor** version bump: 0.12.0 → 0.13.0)
- `fix:` - Bug fix (triggers **patch** version bump: 0.12.0 → 0.12.1)
- `perf:` - Performance improvement (triggers **patch** version bump)
- `docs:` - Documentation changes (no version bump)
- `style:` - Code style changes (no version bump)
- `refactor:` - Code refactoring (no version bump)
- `test:` - Adding or updating tests (no version bump)
- `chore:` - Maintenance tasks (no version bump)
- `ci:` - CI/CD changes (no version bump)

### Breaking Changes

For breaking changes, add `!` after type or include `BREAKING CHANGE:` in footer:

```bash
# Option 1: Using !
feat!: change API to async-only

# Option 2: Using footer
feat: migrate to new configuration format

BREAKING CHANGE: Configuration schema has changed.
Old format is no longer supported.
```

This triggers a **major** version bump: 0.12.0 → 1.0.0

### Examples

✅ **Good Examples:**

```bash
feat: add WebSocket support for real-time compilation
feat(worker): implement queue-based processing
fix: resolve memory leak in rule parser
fix(validation): handle edge case for IPv6 addresses
perf: optimize deduplication algorithm by 50%
docs: add API documentation for streaming endpoint
test: add integration tests for batch compilation
chore: update dependencies to latest versions
```

❌ **Bad Examples:**

```bash
added feature              # Missing type prefix
Fix bug                    # Incorrect capitalization
feat add new feature       # Missing colon
update code                # Too vague, missing type
```

## Pull Request Process

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make Your Changes**
   - Write code following the project's style guide
   - Add tests for new functionality
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   deno task test           # Run tests
   deno task fmt            # Format code
   deno task lint           # Lint code
   deno task check          # Type check
   ```

4. **Commit with Conventional Format**
   ```bash
   git add .
   git commit -m "feat: add new transformation for rule validation"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a Pull Request on GitHub

6. **Automatic Version Bump**
   - When your PR is merged to `main`, the version will be automatically bumped based on your commit message
   - `feat:` commits → minor version bump
   - `fix:` or `perf:` commits → patch version bump
   - Breaking changes → major version bump

## Code Style

- **Indentation**: 4 spaces (not tabs)
- **Line width**: 180 characters maximum
- **Quotes**: Single quotes for strings
- **Semicolons**: Always use semicolons
- **TypeScript**: Strict typing, no `any` types

Run `deno task fmt` to automatically format your code.

## Testing

- **Location**: Co-locate tests with source files (`*.test.ts`)
- **Framework**: Use Deno's built-in test framework
- **Coverage**: Aim for comprehensive test coverage
- **Commands**:
  ```bash
  deno task test              # Run all tests
  deno task test:watch        # Watch mode
  deno task test:coverage     # With coverage
  ```

## Documentation

- Update README.md for user-facing changes
- Update relevant docs in `docs/` directory
- Add JSDoc comments to public APIs
- Include examples for complex features

## Project Structure

```
src/
├── cli/              # Command-line interface
├── compiler/         # Core compilation logic
├── configuration/    # Configuration validation
├── downloader/       # Filter list downloading
├── platform/         # Platform abstraction (Worker, Node)
├── transformations/  # Rule transformation implementations
├── types/            # TypeScript type definitions
└── utils/            # Utility functions

worker/               # Cloudflare Worker implementation
public/               # Static web UI files
docs/                 # Documentation
examples/             # Example implementations
```

## Questions or Help?

- Create an issue on GitHub
- Check existing documentation in `docs/`
- Review the [README.md](README.md)

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

## Additional Resources

- [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md) - Version synchronization details
- [docs/AUTO_VERSION_BUMP.md](docs/AUTO_VERSION_BUMP.md) - Automatic version bumping
- [Conventional Commits](https://www.conventionalcommits.org/) - Official specification
- [Semantic Versioning](https://semver.org/) - SemVer specification
