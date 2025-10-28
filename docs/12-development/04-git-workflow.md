# Git Workflow

## Daily Workflow

```bash
# Start of day
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/my-feature

# Work on feature
# ... make changes ...

# Commit frequently
git add .
git commit -m "feat: implement user approval dialog"

# Push to remote
git push -u origin feature/my-feature

# Create Pull Request
gh pr create --title "Add user approval dialog" --body "..."

# After PR approval and merge
git checkout develop
git pull origin develop
git branch -d feature/my-feature
```

## Commit Messages

```
<type>(<scope>): <subject>

<body>

<footer>
```

Example:
```
feat(agent): add approval workflow

- Implement approval dialog
- Add change summary component
- Integrate with backend API

Closes #123
```

---

**Versión**: 1.0
