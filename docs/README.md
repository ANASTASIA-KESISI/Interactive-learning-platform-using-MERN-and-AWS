# docs/

| File | What it is |
|---|---|
| `ARCHITECTURE.adoc` | The architecture reference. **Source of truth** — edit this. |
| `generate-diagrams.js` | Emits the `.drawio` and the three `.svg` files from one layout description. **Source of truth for the diagrams** — edit this, not the outputs. |
| `learncode-architecture.drawio` | Generated. Editable in draw.io; three pages. |
| `*.svg` | Generated. Vector figures, one per diagram page. |
| `*.png` | Generated. 2× raster of each figure, for Word or anywhere SVG is awkward. |
| `ARCHITECTURE.html`, `ARCHITECTURE.pdf` | Generated. Gitignored (HTML) — see below. |

## Regenerating

### Diagrams

```bash
node docs/generate-diagrams.js
```

Rewrites the `.drawio` and all three `.svg` files. It self-checks that every
entity box's height matches its field count, which is the failure that
otherwise puts the last field outside its box.

Then rasterise to PNG. There is no CLI renderer installed, so this uses Chrome
headless — one command per figure, with `--window-size` matching the SVG's own
dimensions and `--force-device-scale-factor=2` for print resolution:

```powershell
$chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
& $chrome --headless=new --hide-scrollbars --default-background-color=FFFFFFFF `
  --force-device-scale-factor=2 --window-size=1080,570 `
  --screenshot=docs/data-model-people.png file:///.../docs/data-model-people.svg
```

Sizes: `data-model-people` 1080×570, `data-model-content` 1460×860,
`aws-topology` 1280×790. They are printed at the top of the generator's output.

### The document

```bash
npx asciidoctor -o docs/ARCHITECTURE.html docs/ARCHITECTURE.adoc
```

For PDF, print that HTML with Chrome headless:

```powershell
& $chrome --headless=new --no-pdf-header-footer `
  --print-to-pdf=docs/ARCHITECTURE.pdf docs/ARCHITECTURE.html
```

`asciidoctor-pdf` would be the direct route, but it is a Ruby gem and there is
no Ruby here.

> **Note.** The HTML carries an injected print stylesheet — A4 margins, forced
> background colours, page-break rules, and the fixed-position TOC sidebar
> converted to a static block. Without it Chrome prints the TOC on top of the
> body text and drops every admonition tint. Re-running plain `asciidoctor`
> discards those rules, so re-inject them before printing.

## Why the outputs are committed

`.svg` and `.png` are generated but tracked, because they are the figures the
thesis cites and a reader should not need Node and Chrome to see them.
`ARCHITECTURE.html` is not tracked: it is a build artifact with no audience.
`ARCHITECTURE.pdf` is tracked deliberately, so the document can be read without
a toolchain.
