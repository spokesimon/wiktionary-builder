import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";

// kaikki.org marks this URL "deprecated" but it's still the only complete
// single-file JSONL download for English as of 2026-09. If it 404s, check
// https://kaikki.org/dictionary/English/index.html for the current link.
const SOURCE_URL =
  "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl";

const RAW_PATH = "./raw.jsonl";
const DB_PATH = "./dictionary.sqlite";

// Wiktionary tags glosses/senses with these to mark them non-standard or
// low-value for a general-purpose dictionary (dialectal spellings, obsolete
// senses, etc). Skip senses carrying any of these.
const SKIP_TAGS = new Set([
  "obsolete",
  "archaic",
  "rare",
  "misspelling",
  "alt-of",
  "form-of",
]);

interface KaikkiSense {
  glosses?: string[];
  raw_glosses?: string[];
  examples?: Array<{ text?: string }>;
  tags?: string[];
}

interface KaikkiEntry {
  word: string;
  pos: string;
  lang_code: string;
  senses?: KaikkiSense[];
}

async function download() {
  if (existsSync(RAW_PATH)) {
    console.log("raw.jsonl already present, skipping download");
    return;
  }
  console.log(`Downloading ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  await Bun.write(RAW_PATH, res);
  console.log("Download complete");
}

// Stable across rebuilds as long as this exact sense's wording doesn't
// change: derived from content, not row order, so a client's saved
// senseId keeps pointing at the same definition even if kaikki reshuffles
// or adds other senses around it.
function senseId(word: string, pos: string, gloss: string): string {
  return createHash("sha1").update(`${word}|${pos}|${gloss}`).digest("hex").slice(0, 16);
}

async function build() {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  mkdirSync("./", { recursive: true });

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = OFF;");
  db.exec("PRAGMA synchronous = OFF;");
  db.exec(`
    CREATE TABLE senses (
      id      TEXT PRIMARY KEY,
      word    TEXT NOT NULL,
      pos     TEXT NOT NULL,
      rank    INTEGER NOT NULL,
      gloss   TEXT NOT NULL,
      example TEXT
    );
  `);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO senses (id, word, pos, rank, gloss, example) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const rl = createInterface({
    input: createReadStream(RAW_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let kept = 0;

  const insertMany = db.transaction(
    (rows: [string, string, string, number, string, string | null][]) => {
      for (const row of rows) insert.run(...row);
    }
  );
  let batch: [string, string, string, number, string, string | null][] = [];

  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;

    let entry: KaikkiEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.lang_code !== "en") continue;
    if (!entry.word || !entry.pos || !entry.senses) continue;

    const word = entry.word.toLowerCase();

    // `rank` is the sense's position in Wiktionary's own ordering for this
    // word+pos (roughly most-common-first), preserved even though some
    // senses at other indices get filtered out below.
    entry.senses.forEach((sense, rank) => {
      const tags = sense.tags ?? [];
      if (tags.some((t) => SKIP_TAGS.has(t))) return;
      const gloss = sense.glosses?.[0];
      if (!gloss) return;
      const example = sense.examples?.find((e) => e.text)?.text ?? null;

      batch.push([senseId(word, entry.pos, gloss), word, entry.pos, rank, gloss, example]);
      kept++;
    });

    if (batch.length >= 5000) {
      insertMany(batch);
      batch = [];
    }

    if (lineNo % 200000 === 0) {
      console.log(`  processed ${lineNo} lines, kept ${kept} senses`);
    }
  }
  if (batch.length) insertMany(batch);

  console.log(`Indexing ${kept} senses...`);
  db.exec("CREATE INDEX idx_senses_word ON senses(word);");
  db.close();

  console.log(`Done: ${DB_PATH} (${kept} senses from ${lineNo} lines)`);
}

await download();
await build();
unlinkSync(RAW_PATH);
