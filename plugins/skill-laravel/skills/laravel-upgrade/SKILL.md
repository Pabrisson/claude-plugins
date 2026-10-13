---
name: laravel-upgrade
description: Upgrade Laravel framework version by version with testing pauses. Handles any version jump (e.g., 9→12) by upgrading one major version at a time and asking the user to test between each step.
---

# Laravel Framework Upgrade — Version by Version

Upgrade Laravel to version: $ARGUMENTS

## Philosophy

### Modern Patterns First — ALWAYS the Latest Structure
- **Adopt ALL new features** at each version step, even if marked "optional"
- **Use new architecture immediately**, remove deprecated code completely
- **No backward compatibility hacks** — the codebase should look like it was built fresh on each target version
- **ALWAYS use the newest project structure** — when Laravel supports both an old and a new structure (e.g., Kernel.php vs bootstrap/app.php), ALWAYS use only the new one and DELETE the old one
- **The skeleton must match a fresh `laravel new` of that version** — if a fresh install of the target version doesn't have a file, delete it. If it has a new file, create it. If it organizes things differently, reorganize.

### Structure Rule: If Both Work, Keep Only the New One
Laravel often introduces new structures while keeping the old ones working for backward compatibility. **We never keep the old structure.** Examples:
- `app/Http/Kernel.php` still works in Laravel 11 → **DELETE it**, use `bootstrap/app.php`
- `app/Console/Kernel.php` still works in Laravel 11 → **DELETE it**, use `routes/console.php`
- `app/Exceptions/Handler.php` still works in Laravel 11 → **DELETE it**, use `bootstrap/app.php`
- `$casts` property still works → **REPLACE with `casts()` method**
- Old config files still work → **REPLACE with new format/defaults**
- Multiple service providers still work in Laravel 11 → **CONSOLIDATE into `bootstrap/providers.php`**

This rule applies to ALL versions: always check `https://github.com/laravel/laravel/tree/{version}.x` to see what a fresh install looks like, and mirror that structure exactly (while preserving custom business logic).

### Version-by-Version Approach
- **Never skip major versions** — always upgrade one major version at a time
- **Pause after each version** — let the user test before continuing
- **Each step is a complete upgrade** — the app must work before moving to the next version

## Step 0: Detection & Planning

### Detect Current State

Run these checks:

- Current Laravel version: !`cat composer.json 2>/dev/null | grep -E '"laravel/framework"' || echo "NOT FOUND"`
- Current PHP version: !`cat composer.json 2>/dev/null | grep -E '"php"' || echo "NOT FOUND"`

### Build Upgrade Path

From the detected current version to the target version ($ARGUMENTS), build the list of intermediate versions.

Example paths:
- Current 9.x → Target 12: upgrade path is **9→10→11→12**
- Current 10.x → Target 12: upgrade path is **10→11→12**
- Current 11.x → Target 12: upgrade path is **11→12**

**CRITICAL**: If there are uncommitted changes, STOP and ask the user to commit or stash first.

Present the upgrade path to the user and ask for confirmation before starting.

## Step 1: For EACH Version in the Upgrade Path

Repeat the following process for each major version step (e.g., first 10→11, then 11→12):

---

### 1.1 Fetch Official Upgrade Guide

- Fetch: `https://laravel.com/docs/{next-version}.x/upgrade`
- Read and extract ALL breaking changes, deprecations, and new features
- Note PHP version requirements — if the current PHP version is too old, warn the user immediately

### 1.2 Fetch GitHub Skeleton Comparison & Fresh Skeleton Reference

- Fetch the diff: `https://github.com/laravel/laravel/compare/{current}.x...{next}.x`
- Fetch the fresh skeleton tree: `https://github.com/laravel/laravel/tree/{next}.x`
- Analyze ALL changed files:
  - `composer.json` dependencies
  - Configuration files (`config/*`)
  - Bootstrap files (`bootstrap/`)
  - Service providers (`app/Providers/`)
  - Middleware
  - `.env.example`
  - `public/index.php`
  - `vite.config.js` / `webpack.mix.js`
  - etc...
- **Identify files that NO LONGER exist in the fresh skeleton** → these must be DELETED from the project
- **Identify NEW files in the fresh skeleton** → these must be CREATED in the project
- **The project structure must mirror the fresh skeleton** (plus the user's custom code)

### 1.3 Update Dependencies — MUST SUCCEED

This is the most critical step. `composer update` **must pass** before continuing.

#### 1.3.1 Update composer.json
- Update `laravel/framework` version constraint
- Update all first-party Laravel packages (`laravel/sanctum`, `laravel/tinker`, `laravel/passport`, `laravel/horizon`, etc.)
- Update testing packages (`phpunit/phpunit`, `nunomaduro/collision`, `pestphp/pest`, etc.)

#### 1.3.2 Run composer update
```bash
composer update --update-with-all-dependencies
```

#### 1.3.3 If composer update FAILS — Resolve Conflicts

**DO NOT skip this. DO NOT move on with broken dependencies.**

When `composer update` fails, follow this resolution strategy:

1. **Read the error message carefully** — identify which package(s) block the upgrade
2. **For each blocking package**, check if a compatible version exists:
   - Run `composer show {package} --all` to see available versions
   - Check Packagist (`https://packagist.org/packages/{vendor}/{package}`) for the latest version and Laravel compatibility
3. **Try upgrading the blocking package first**:
   - Update its version constraint in `composer.json` and retry
4. **If no compatible version exists**, present the user with options:
   - **Option A**: Find an alternative package that provides the same functionality and supports the target Laravel version. Search Packagist for alternatives and present them with pros/cons.
   - **Option B**: Fork the package — if it's a small package with a simple incompatibility, propose a quick fix
   - **Option C**: Remove the package — if the functionality is now built into Laravel or is no longer needed
   - **Option D**: Temporarily skip this package — mark it with `"*"` constraint and warn the user it needs attention
5. **Ask the user which option they prefer** before proceeding
6. **Retry `composer update`** after each fix until it passes cleanly

#### 1.3.4 Verify success
```bash
composer validate
composer dump-autoload
```

**NEVER proceed to step 1.4 if composer update has not completed successfully.**

### 1.4 Synchronize Configuration Files

**CRITICAL**: Config files must be up to date with the new Laravel version. Use the GitHub skeleton comparison (step 1.2) as the source of truth.

For EACH config file in `config/`:

#### 1.4.1 Fetch the new version of the config file
- Get the fresh config from `https://github.com/laravel/laravel/blob/{next}.x/config/{file}.php`
- Compare it line by line with the project's current config file

#### 1.4.2 Apply changes with these rules

**NEVER overwrite the file blindly. Merge surgically:**

| Situation | Action |
|-----------|--------|
| New key added in the new version | **ADD it** to the project's config with the new default value |
| Key removed in the new version | **REMOVE it** from the project's config |
| Default value changed in the new version, but project uses the OLD default | **UPDATE** to the new default (the user never customized it) |
| Default value changed in the new version, but project has a CUSTOM value | **KEEP the custom value** — do NOT overwrite it |
| Key renamed in the new version | **RENAME it**, preserve the custom value if any |
| New config file added (didn't exist before) | **CREATE it** with the fresh skeleton content |
| Config file removed from skeleton | **DELETE it** from the project |
| Structure/nesting changed | **Reorganize** to match new structure, migrate custom values to their new location |

#### 1.4.3 How to detect custom vs default values
- Read the project's current config value
- Compare with the DEFAULT value from the CURRENT Laravel version (not the new one)
- If they match → the user never customized it → safe to update to the new default
- If they differ → the user customized it → **KEEP their value**

#### 1.4.4 Config files to always check
- `config/app.php` (often has significant changes between versions)
- `config/auth.php`
- `config/cache.php`
- `config/database.php`
- `config/filesystems.php`
- `config/logging.php`
- `config/mail.php`
- `config/queue.php`
- `config/session.php`
- `config/hashing.php`
- Any other config file present in the fresh skeleton

#### 1.4.5 Also sync `.env.example`
- Add new environment variables from the fresh skeleton
- Keep existing custom variables
- Update default values only if the user hasn't changed them
- Remove variables that no longer exist in the new version

### 1.5 Apply Code Changes

Apply ALL changes from the upgrade guide, including:

**For any version:**
- Replace deprecated methods, classes, facades
- Update middleware references
- Update service provider registrations
- Update route definitions if syntax changed
- Update Blade directives if changed
- Update Eloquent casting syntax to latest


### 1.6 Search & Replace Deprecated Code

1. For each breaking change in the guide, scan the codebase and apply fixes:

**High Impact** (always check):
* composer.json dependency versions
* PHP version requirements
* Database migrations using deprecated methods

**Medium Impact** (check relevant files):
* Model $dates property → $casts (9→10)
* Database expressions with (string) casting (9→10)
* Column modification migrations missing attributes (10→11)
* HasUuids trait behavior change (11→12)

**Low Impact** (check if patterns found):
* Deprecated method calls (Bus::dispatchNow, Redirect::home, etc.)
* Contract interface changes
* Configuration file updates

2. Replace every occurrence with the modern equivalent
3. Verify no occurrences remain

### 1.7 Clear ALL Caches & Validate

**CRITICAL**: After an upgrade, stale cached files (especially in `bootstrap/cache/`) can cause cryptic errors. Always perform a FULL cache purge.

```bash
# 1. Delete all compiled/cached files in bootstrap/cache/
rm -f bootstrap/cache/*.php
rm -f bootstrap/cache/*.json

# 2. Clear all Laravel caches
php artisan config:clear
php artisan cache:clear
php artisan view:clear
php artisan route:clear
php artisan event:clear

# 3. Rebuild autoload and package discovery
composer dump-autoload
php artisan package:discover

# 4. Verify artisan works
php artisan list
```

**DO NOT skip the `bootstrap/cache/` cleanup.** Files like `config.php`, `packages.php`, `services.php`, and `routes-v7.php` in this directory contain cached data from the previous Laravel version and WILL cause issues if left behind.

### 1.8 PAUSE — Ask User to Test

**STOP HERE and ask the user to test the application.**

Present a message like:

> **Laravel X → Y upgrade complete.**
>
> Changes applied:
> - [list key changes made]
>
> Please test your application:
> 1. Run `php artisan serve` and check the app works
> 2. Run your test suite (`php artisan test`)
> 3. Test critical features manually
> 4. Commit "Laravel Y"
>
> **When you're ready, tell me to continue to the next version (Y → Z), or tell me about any issues you found.**

**DO NOT proceed to the next version until the user confirms everything works.**

If the user reports issues, fix them before continuing.

---

## After All Versions Are Done

### Final Report

Once all version steps are complete and tested, generate a summary:

1. **Upgrade Path Completed**: e.g., Laravel 9 → 10 → 11 → 12
2. **Total Files Modified**: list with descriptions
3. **Breaking Changes Applied**: per version
4. **Removed/Deleted Files**: list of legacy files removed
5. **New Features Adopted**: per version
6. **Dependencies Updated**: all composer package changes
7. **Remaining Manual Steps**: anything that needs human verification

### Final Checklist

- [ ] All deprecated code replaced
- [ ] Configuration files updated for each version
- [ ] Middleware migrated to modern pattern
- [ ] Service providers updated
- [ ] Routes reviewed
- [ ] Environment variables checked
- [ ] All tests passing
- [ ] Application boots and serves correctly

## Important Reminders

- **One version at a time** — never skip a major version
- **Test between each version** — always wait for user confirmation
- **Modern patterns only** — if it's deprecated, remove it even if it still works
- **Always the latest structure** — if Laravel supports both old and new, keep ONLY the new
- **Preserve custom logic** — update the framework code, keep the business logic
- **Check PHP requirements** — some Laravel versions require newer PHP
