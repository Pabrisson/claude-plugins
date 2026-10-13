# claude-plugins

Marketplace **`pabrisson`** pour Claude Code : un plugin par type de composant et par domaine, nommé `<type>-<domaine>`. Chacun s'active séparément.

## Plugins

| Plugin | Contenu | Appel |
|---|---|---|
| `mod-hud` | Bandeau au-dessus du prompt (modèle, effort, branche, outils, usage, contexte, coût, mise à jour) | — |
| `mod-ports` | Panneau à droite listant ce qui tourne pour le projet (Docker, Kubernetes, process) | icône ⇄ du HUD |
| `mod-code-fence` | Entoure d'un bloc ```` ```lang ```` le code collé dans le prompt | — |
| `hook-notify` | Notification macOS à la fin d'une tâche ou en attente d'une saisie, durée de chaque prompt en SQLite | — |
| `agent-frontend` | `frontend-developer`, `ui-ux-designer` | `agent-frontend:frontend-developer` |
| `agent-backend` | `backend-architect`, `api-documenter` | `agent-backend:backend-architect` |
| `agent-review` | `code-reviewer` | `agent-review:code-reviewer` |
| `agent-prompt` | `prompt-engineer` | `agent-prompt:prompt-engineer` |
| `command-docs` | `add-readme`, `add-changelog`, `update-docs`, `create-architecture-documentation`, `summarize-implementation` | `/command-docs:add-readme` |
| `command-review` | `code-review`, `refactor-code` | `/command-review:code-review` |
| `command-toolbox` | `ultra-think`, `fork-sync` | `/command-toolbox:ultra-think` |
| `skill-shadcn` | `shadcn` | `skill-shadcn:shadcn` |
| `skill-laravel` | `laravel-upgrade` | `skill-laravel:laravel-upgrade` |
| `skill-find-skills` | `find-skills` | `skill-find-skills:find-skills` |

Préfixes utilisés : `mod-`, `hook-`, `agent-`, `command-` et `skill-`. Pour un futur thème, output style, monitor ou exécutable : `theme-*` (`themes/*.json`), `output-style-*` (`output-styles/*.md`), `monitor-*` (`monitors/monitors.json`) ou `bin/` dans le plugin concerné.

## Installation

```bash
claude plugin marketplace add Pabrisson/claude-plugins
claude plugin install command-docs@pabrisson
```

## Développement

- Les plugins installés depuis le marketplace sont **copiés** dans `~/.claude/plugins/cache/pabrisson/<plugin>/<version>/`. Après une modification, incrémenter `version` dans `plugins/<plugin>/.claude-plugin/plugin.json`, pousser sur `main`, puis lancer `claude plugin marketplace update pabrisson && claude plugin update <plugin>@pabrisson` et redémarrer la session.
- Essayer une modification sans la publier : `claude --plugin-dir plugins/<plugin>` (session seulement, remplace la version installée du même nom).
- Valider : `claude plugin validate .` (marketplace) ou `claude plugin validate plugins/<plugin>`.
- Tester un mod : `claude plugin test plugins/mod-hud`.