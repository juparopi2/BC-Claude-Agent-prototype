# Development Workflow

## Branch Strategy

```
main              # Production
├── develop       # Development
├── feature/*     # Features
├── bugfix/*      # Bug fixes
└── hotfix/*      # Production hotfixes
```

## Feature Development

### 1. Create Branch
```bash
git checkout develop
git pull
git checkout -b feature/user-authentication
```

### 2. Develop
```bash
# Make changes
# Test locally
npm run dev
```

### 3. Test
```bash
npm run test
npm run lint
npm run type-check
```

### 4. Commit
```bash
git add .
git commit -m "feat: add user authentication"
```

### 5. Push & PR
```bash
git push -u origin feature/user-authentication
# Create Pull Request on GitHub
```

## Commit Convention

Follow Conventional Commits:

```
feat: Add new feature
fix: Bug fix
docs: Documentation
style: Formatting
refactor: Code refactoring
test: Tests
chore: Maintenance
```

## Code Review Checklist

- [ ] Tests pass
- [ ] No linting errors
- [ ] Type-safe
- [ ] Documentation updated
- [ ] No console.logs
- [ ] Performance considered

---

**Versión**: 1.0
