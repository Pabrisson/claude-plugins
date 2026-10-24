# claude-plugins

Marketplace **`pabrisson`** pour Claude Code : un plugin par type de composant et par domaine, nommé `<type>-<domaine>`. Chacun s'active séparément.

## Plugins

| Plugin | Contenu | Appel |
|---|---|---|
| `mod-hud` | Bandeau au-dessus du prompt (modèle, effort, branche, outils, usage, contexte, coût, mise à jour) | — |
| `mod-ports` | Panneau à droite listant ce qui tourne pour le projet (Docker, Kubernetes, process) | icône ⇄ du HUD |
| `mod-code-fence` | Entoure d'un bloc ```` ```lang ```` le code collé dans le prompt | — |
| `hook-notify` | Notification desktop (macOS, Linux, Windows) à la fin d'une tâche ou en attente d'une saisie, durée de chaque prompt en SQLite | — |
| `command-docs` | `add-readme`, `add-changelog`, `summarize-implementation` | `/command-docs:add-readme` |
| `command-docs-templates` | `update-docs`, `create-architecture-documentation` et les autres commandes de documentation de davila7/claude-code-templates | `/command-docs-templates:update-docs` |
| `command-toolbox` | `fork-sync` | `/command-toolbox:fork-sync` |
| `skill-shadcn` | `shadcn` (tiré de shadcn-ui/ui) | `skill-shadcn:shadcn` |
| `skill-laravel` | `laravel-upgrade` | `skill-laravel:laravel-upgrade` |
| `skill-find-skills` | `find-skills` (tiré de vercel-labs/skills) | `skill-find-skills:find-skills` |
| `skill-video` | `video-editor` | `skill-video:video-editor` |
| `requesty` | Serveur MCP Requesty (`router.requesty.ai`) | outils `mcp__plugin_requesty_requesty__*` |
| `dbeaver` | Serveur MCP DBeaver (`omnisql-mcp`, lancé via `npx`, indépendant de la version Node active) | outils `mcp__plugin_dbeaver_dbeaver__*` |

Préfixes utilisés : `mod-`, `hook-`, `agent-`, `command-` et `skill-`. Les serveurs MCP n'ont pas de préfixe. Leurs réglages (clé API, connexions autorisées, lecture seule…) sont demandés à l'installation et se modifient ensuite dans `/config` ; la clé API est rangée dans le Keychain, jamais dans le repo. Pour un futur thème, output style, monitor ou exécutable : `theme-*` (`themes/*.json`), `output-style-*` (`output-styles/*.md`), `monitor-*` (`monitors/monitors.json`) ou `bin/` dans le plugin concerné.

`command-docs-templates`, `skill-shadcn` et `skill-find-skills` ne contiennent aucun fichier ici : leur entrée du marketplace pointe vers le dépôt d'origine (`git-subdir`), ces projets n'ayant pas de marketplace Claude. Tout ce qui a son propre marketplace ou existe nativement s'installe de là-bas :

- agents : `claude plugin marketplace add wshobson/agents` puis `frontend-mobile-development`, `backend-development`, `documentation-generation`, `llm-application-dev`
- revue de code : `/code-review` et `/simplify` (natifs), `code-review` / `pr-review-toolkit@claude-plugins-official`
- réflexion profonde : `/effort max` ou le mot-clé `ultrathink` (natifs)

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
- Studio de `skill-video` : après une modification du studio, lancer `npm run build` dans `plugins-src/skill-video/studio/` avant d'incrémenter la version (seul le build, `engine/studio/dist/`, est livré dans le plugin).