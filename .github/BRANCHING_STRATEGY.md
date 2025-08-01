# Git Branching Strategy

## Branch Structure

### Main Branches
- **`main`** - Production-ready code, stable releases
- **`develop`** - Integration branch for features, pre-release testing

### Feature Branches
- **`feature/branch-name`** - New features and enhancements
- **`fix/branch-name`** - Bug fixes and patches
- **`docs/branch-name`** - Documentation updates
- **`chore/branch-name`** - Maintenance, dependencies, tooling

## Workflow

### For New Features:
1. `git checkout -b feature/feature-name develop`
2. Make changes and commit
3. `git push origin feature/feature-name`
4. Create Pull Request to `develop`
5. After review, merge to `develop`
6. Periodically merge `develop` to `main` for releases

### For Bug Fixes:
1. `git checkout -b fix/bug-description main`
2. Make changes and commit
3. `git push origin fix/bug-description`
4. Create Pull Request to `main`
5. After fix, also merge to `develop` if needed

### For Documentation:
1. `git checkout -b docs/update-description main`
2. Make changes and commit
3. `git push origin docs/update-description`
4. Create Pull Request to `main`

## Commit Message Format

Use conventional commits:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `style:` - Code formatting

## Branch Protection

- `main` branch should be protected
- Require Pull Request reviews
- Require status checks to pass
- Require branches to be up to date

## Example Branches for This Project

- `feature/enhanced-status-detection`
- `feature/multi-endpoint-support`
- `fix/success-rate-calculation`
- `docs/api-usage-guide`
- `chore/update-dependencies`
