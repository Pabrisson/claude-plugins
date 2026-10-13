---
allowed-tools: Bash, Read, Grep, Glob
argument-hint: [upstream-branch] | --rebase | --merge
description: Synchronize fork with upstream repository while preserving local changes
model: sonnet
---

# Fork Synchronization

Synchronize your fork with the upstream repository while preserving all local features and changes: $ARGUMENTS

## Current Repository State

- Current branch: !`git branch --show-current`
- Git status: !`git status --porcelain`
- Local branches: !`git branch -vv`
- Remote configuration: !`git remote -v`
- Recent commits: !`git log --oneline -10`
- Uncommitted changes: !`git diff --stat`

## Task

Perform a safe fork synchronization following these steps:

### 1. **Pre-Sync Verification**
   - Verify this is a Git repository with a fork relationship
   - Check for uncommitted changes (stash if necessary)
   - Identify the current branch and its tracking status
   - Verify upstream remote exists (usually 'upstream' or 'origin')
   - Check for local commits that aren't pushed

### 2. **Backup Current State**
   - Create a backup branch: `backup-fork-sync-TIMESTAMP`
   - Document current HEAD position for recovery if needed
   - List all local branches that might be affected

### 3. **Configure Upstream Remote**
   - Check if 'upstream' remote exists: `git remote -v`
   - If missing, help identify the source repository from:
     - GitHub fork metadata
     - .git/config inspection
     - Ask user for upstream URL
   - Add upstream remote if needed: `git remote add upstream <URL>`

### 4. **Fetch Upstream Changes**
   - Fetch all upstream branches: `git fetch upstream`
   - Fetch all tags: `git fetch upstream --tags`
   - Show summary of upstream changes: `git log HEAD..upstream/main --oneline`

### 5. **Analyze Divergence**
   - Compare local and upstream branches
   - Identify files with potential conflicts
   - Check for:
     - Files modified both locally and upstream
     - New upstream features that might conflict
     - Deleted files that were modified locally
   - Suggest merge strategy (merge vs rebase) based on:
     - History complexity
     - Number of local commits
     - Presence of merge commits

### 6. **Sync Strategy Selection**

   **Option A - Merge (Recommended for shared branches):**
   ```bash
   git merge upstream/main
   ```
   - Preserves complete history
   - Creates merge commit
   - Safer for public branches

   **Option B - Rebase (For clean history):**
   ```bash
   git rebase upstream/main
   ```
   - Linear history
   - Rewrites commits
   - Best for private branches

### 7. **Execute Synchronization**
   - Stash uncommitted changes if present
   - Execute chosen strategy (merge or rebase)
   - Monitor for conflicts
   - If conflicts occur:
     - List conflicted files
     - Show conflict markers
     - Provide resolution guidance
     - Don't auto-resolve conflicts - ask user

### 8. **Conflict Resolution (if needed)**
   - List all conflicts: `git status --short`
   - For each conflicted file:
     - Show the conflict: `git diff <file>`
     - Explain the conflicting changes
     - Suggest resolution strategy
     - Wait for user decision before resolving
   - After manual resolution:
     - Stage resolved files
     - Continue merge/rebase

### 9. **Post-Sync Verification**
   - Verify build still works (if build commands exist)
   - Run tests if test suite exists
   - Check that local features still work:
     - List custom files/directories
     - Verify key functionality
   - Show summary of changes: `git log --oneline HEAD~10..HEAD`

### 10. **Push Updates**
   - Review changes before pushing
   - Push to origin: `git push origin <branch>`
   - Update any related branches if needed
   - If force push needed (after rebase), warn user and require confirmation

### 11. **Cleanup**
   - Remove backup branch if sync successful: `git branch -d backup-fork-sync-TIMESTAMP`
   - Clean up any temporary files
   - Restore stashed changes if any: `git stash pop`

## Important Safeguards

- **NEVER force push to main/master without explicit user confirmation**
- **NEVER delete branches without user approval**
- **ALWAYS create backup before destructive operations**
- **STOP and ask user if conflicts seem complex or risky**
- **Verify tests pass before considering sync complete**
- **Preserve all local configuration files and environment files**

## Recovery Instructions

If something goes wrong, provide recovery steps:
1. Reset to backup: `git reset --hard backup-fork-sync-TIMESTAMP`
2. Restore from reflog: `git reflog` and `git reset --hard HEAD@{n}`
3. Re-apply stashed changes: `git stash list` and `git stash apply`

## Output Format

Provide a clear summary:
- ✓ Successfully synced commits from upstream
- ✓ Local features preserved
- ⚠ Conflicts resolved (if any)
- ⚠ Manual testing recommended for: [list areas]
- 📋 Next steps: [actionable items]

Be thorough but focused on preserving the user's work while staying current with upstream.
