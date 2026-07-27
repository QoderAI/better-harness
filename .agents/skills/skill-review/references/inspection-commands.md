# Fast Inspection Commands

Use these as starting points, adapted to the repo:

```bash
rg --files -g 'SKILL.md' -g '*.md' -g '*.mjs' -g '*.ts' -g '*.tsx'
rg -n "TODO|placeholder|subagent|Canvas|qoder/canvas|Moderate|<dimension>"
wc -l path/to/SKILL.md path/to/references/*.md path/to/templates/*.md
git diff --check -- <reviewed-paths>
```
