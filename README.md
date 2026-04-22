# pi-extensions

Personal [pi coding agent](https://github.com/mariozechner/pi-coding-agent) extensions.

## Extensions

### whimsical

Dynamic LLM-generated loading messages. Uses Z.ai's `glm-4.7-flash` to create unique, creative status messages on each turn. Falls back to a static list if the API call fails or times out.

### noctalia-sync

Syncs the pi web UI theme with [Noctalia](https://github.com/user/noctalia) colors. Watches `~/.config/noctalia/colors.json` for live updates and auto-applies the theme on session start.

Commands:
- `/noctalia-sync` — Manually re-sync the theme
- `/noctalia-off` — Revert to the default theme

### web-search

Web search tool backed by a local [SearXNG](https://github.com/searxng/searxng) instance. Returns URLs, titles, and snippets. Optionally fetches result pages and converts them to markdown for full content.

Set `SEARX_URL` to override the default `http://127.0.0.1:8081/search`.

## Install

```bash
pi install https://github.com/sliced-paraiba/pi-extensions
```
