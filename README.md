# wiktionary-builder

Builds a small, filtered SQLite dictionary from the [kaikki.org](https://kaikki.org/dictionary/English/index.html)
Wiktionary extraction (produced by [wiktextract](https://github.com/tatuylonen/wiktextract)), and publishes it as a
GitHub Release asset.

The raw kaikki English JSONL is ~2.9GB and includes far more than a flashcard app needs (etymology, pronunciation,
translations, inflected forms, quotations, etc). This script streams that file line by line, keeps only
`word` / `pos` / a couple of glosses / one example per sense, and writes the result into a compact SQLite file
(`dictionary.sqlite`), gzipped for the release.

## Usage

Trigger the "Build dictionary" workflow manually from the Actions tab (or `gh workflow run build.yml`). It:

1. Downloads the latest kaikki English JSONL dump.
2. Streams it into `dictionary.sqlite` (word, pos, gloss, example — indexed on word).
3. Gzips the result and attaches it to a new GitHub Release tagged with the kaikki dump date.

Consumers (e.g. wordPrep) download `dictionary.sqlite.gz` from the latest release and query it directly with
`bun:sqlite` — no runtime dependency on kaikki.org or Wiktionary's live site.

## License

The underlying data is Wiktionary content, licensed **CC BY-SA 3.0**. Any app using the built dictionary must
attribute Wiktionary and keep the same share-alike terms for the data itself (the build scripts here are just
tooling, not the data).
