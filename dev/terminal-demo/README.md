# Terminal History Demo

`play-better-harness-history.mjs` renders one project's historical `findings.json` files
as an animated five-dimension Agent Work Loop trend.

For the English-only `twenty` evaluation demo:

```sh
asciinema rec --overwrite --window-size 100x30 --idle-time-limit 1 \
  --command "node dev/terminal-demo/play-better-harness-history.mjs \
    --history-root /path/to/project/.qoder/better-harness \
    --since 2026-07-17" \
  dev/terminal-demo/twenty-history.cast

agg --theme github-dark --font-size 22 --fps-cap 15 \
  --last-frame-duration 3 \
  dev/terminal-demo/twenty-history.cast \
  assets/demo/twenty-history.gif

ffmpeg -i assets/demo/twenty-history.gif -vf reverse -frames:v 1 assets/demo/twenty-history.png
```

The repository keeps the GIF as the recording source. The public website uses
the static final-frame PNG so it does not autoplay or loop. Regenerate both
files together after changing the recording; the `reverse` filter makes the
GIF's last frame the single PNG output frame.

Run without a root to discover history below the current workspace, or select a
workspace explicitly:

```sh
node dev/terminal-demo/play-better-harness-history.mjs --workspace /path/to/project
```

Discovery combines `.qoder/better-harness` and `.codex/better-harness`
histories for that one project. The same product directory below another
first-level hidden host directory is also recognized.

For a host-level location, pass one or more explicit roots. Home shorthand is
expanded by the script, including when the argument is quoted:

```sh
node dev/terminal-demo/play-better-harness-history.mjs \
  --history-root '~/.qoder/better-harness' \
  --history-root '~/.xx/better-harness'
```

Point at one project-specific report root so unrelated histories are not mixed.

Use `--limit N` to retain only the latest N scans, or
`--no-animate --no-color` for a stable text snapshot.

Use `--since YYYY-MM-DD` to exclude earlier report runs with known-invalid
scores. The Twenty recording starts on 2026-07-17 and continues through the
latest available scan.

`--omit-zero learning-capture` keeps each scan and its other four scores, but
removes zero-valued Learning Capture anomalies from that dimension's trend. A
legend count records how many values were omitted. It does not rewrite the
source `findings.json` files.
