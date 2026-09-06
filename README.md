# zero-vision

**Read a page, a screenshot, or a video as text. Default path never sends pixels off the machine.**

Public. Apache-2.0. Crew: [unfoundbox-crew](https://github.com/unfoundbox-crew).

| Surface | Name |
| --- | --- |
| GitHub | `unfoundbox-crew/zero-vision` |
| npm package | `zero-vision` |
| CLI / bin | `zrv` |

`zrv` as an **unscoped npm name is taken** (a 2020 React/Redux leftover, last publish 2020-05-25). Do not publish `zrv`. The package is `zero-vision`; install puts `zrv` on `PATH`. `npx zrv` hits the zombie. Use `npx zero-vision`.

## What it does

Most agent "vision" is transcription. A 168-session audit on this fleet: 65% verbatim OCR, 27% contact-sheet / title-card text, 8% real aesthetic judgment.

Default engine is Apple Vision on-device. A VLM is opt-in.

Not a browser driver. Does not click. Chrome DevTools MCP and Playwright MCP already do that.

## Spec

Implementation contract: [`docs/spec.md`](docs/spec.md).

## Status

Repo is new. Code is not here yet. Spec is.

## License

Apache License 2.0. See [LICENSE](LICENSE).
