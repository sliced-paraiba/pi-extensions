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

### web-tools

Two tools backed by a local [SearXNG](https://github.com/searxng/searxng) instance:

- **web_search** — Search the web. Returns URLs, titles, and snippets.
- **web_fetch** — Fetch a URL and convert it to markdown. Use this to read pages found via `web_search`.

**Prerequisite:** These tools require a SearXNG instance running locally. [SearXNG](https://github.com/searxng/searxng) is a free internet metasearch engine that aggregates results from many search engines. The quickest way to get started is the [Docker installation](https://docs.searxng.org/admin/installation-docker.html) — just pull the image and run it. For other options, see the full [SearXNG installation guide](https://docs.searxng.org/admin/installation.html).

Set `SEARX_URL` to override the default `http://127.0.0.1:8081/search`.

## Install

```bash
pi install https://github.com/sliced-paraiba/pi-extensions
```
