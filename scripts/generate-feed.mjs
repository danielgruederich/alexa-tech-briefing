#!/usr/bin/env node
// Erzeugt docs/feed.json im Alexa-Flash-Briefing-Format aus mehreren RSS-Quellen.
// Keine Abhängigkeiten, Node >= 22 (global fetch).

import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "feed.json");

// Reihenfolge = Vorlese-Reihenfolge im Briefing.
const SECTIONS = [
  {
    title: "KI-News",
    intro: "Die wichtigsten KI-Meldungen:",
    maxItems: 5,
    maxAgeHours: 36,
    redirectionUrl: "https://the-decoder.de/",
    sources: [
      { name: "The Decoder", url: "https://the-decoder.de/feed/" },
      { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
    ],
  },
  {
    title: "Tech-News",
    intro: "Aus der Tech-Welt:",
    maxItems: 4,
    maxAgeHours: 36,
    redirectionUrl: "https://techcrunch.com/",
    sources: [
      // heise als RSS statt als Skill: gleiche Meldungen, aber ohne die Werbung des heise-Flash-Briefings
      { name: "heise online", url: "https://www.heise.de/rss/heise.rdf" },
      { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
    ],
  },
  {
    title: "Techno und DJ-News",
    intro: "Neues aus der Szene:",
    maxItems: 4,
    maxAgeHours: 96, // Szene-News erscheinen seltener, v. a. am Wochenende
    redirectionUrl: "https://djmag.com/",
    sources: [
      { name: "DJ Mag", url: "https://djmag.com/rss.xml" },
      { name: "Mixmag", url: "https://mixmag.net/rss.xml" },
    ],
  },
];
const MAX_MAIN_TEXT = 4000; // Alexa-Limit ist 4500, etwas Luft lassen

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#039);/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanForSpeech(s) {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ") // HTML raus
    .replace(/https?:\/\/\S+/g, "") // URLs raus
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // Emojis raus
    .replace(/\bContinue reading\b.*$/i, "") // Mixmag-Füllsel
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>(.*?)</${name}>`, "s"));
  return m ? m[1].trim() : "";
}

// JS-Date kennt Zonen-Kürzel wie BST/CEST nicht — auf Offsets mappen.
const TZ_FIX = { BST: "+0100", CET: "+0100", CEST: "+0200", EST: "-0500", EDT: "-0400", PST: "-0800", PDT: "-0700" };
function parsePubDate(s) {
  if (!s) return null;
  const fixed = s.replace(/\b([A-Z]{3,4})\b\s*$/, (m, z) => TZ_FIX[z] ?? m);
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchItems(source) {
  const res = await fetch(source.url, {
    headers: { "user-agent": "Mozilla/5.0 (alexa-tech-briefing feed generator)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<item[\s>](.*?)<\/item>/gs)) {
    const it = m[1];
    const title = cleanForSpeech(tag(it, "title"));
    const desc = cleanForSpeech(tag(it, "description"));
    const pubDate = parsePubDate(tag(it, "pubDate"));
    if (title) items.push({ source: source.name, title, desc, pubDate });
  }
  return items;
}

function firstSentence(s, maxLen = 160) {
  const m = s.match(/^.*?[.!?](\s|$)/);
  let out = m ? m[0].trim() : s;
  if (out.length > maxLen) out = out.slice(0, maxLen).replace(/\s\S*$/, "") + " …";
  return out;
}

async function buildSection(section, now, usedTitles) {
  const cutoff = now - section.maxAgeHours * 3600 * 1000;
  const perSource = await Promise.all(
    section.sources.map((s) =>
      fetchItems(s).catch((e) => {
        console.error(`WARNUNG: ${e.message} — Quelle wird übersprungen`);
        return [];
      })
    )
  );
  // Quellen abwechselnd mischen, damit nicht eine Quelle alles dominiert
  // Datierte Meldungen: nur frische, neueste zuerst. Undatierte Quellen (z. B. Mixmag):
  // Feed-Reihenfolge beibehalten (dort stehen die neuesten oben).
  const fresh = perSource.map((items) => {
    const kept = items.filter((i) => !usedTitles.has(i.title) && (i.pubDate === null || i.pubDate.getTime() >= cutoff));
    return kept.every((i) => i.pubDate !== null) ? kept.sort((a, b) => b.pubDate - a.pubDate) : kept;
  });
  const picked = [];
  for (let round = 0; picked.length < section.maxItems; round++) {
    let added = false;
    for (const items of fresh) {
      if (items[round] && picked.length < section.maxItems) {
        picked.push(items[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  if (picked.length === 0) return null;
  for (const it of picked) usedTitles.add(it.title);

  let text = section.intro;
  for (const it of picked) {
    let chunk = ` ${it.title}.`;
    if (it.desc && !it.desc.startsWith(it.title)) chunk += ` ${firstSentence(it.desc)}`;
    chunk += ` (${it.source}.)`;
    if ((text + chunk).length > MAX_MAIN_TEXT) break;
    text += chunk;
  }
  return { title: section.title, mainText: text, redirectionUrl: section.redirectionUrl };
}

const now = Date.now();
// Sequentiell statt parallel, damit die Dubletten-Sperre über Sektionen hinweg greift
const usedTitles = new Set();
const sections = [];
for (const s of SECTIONS) {
  const built = await buildSection(s, now, usedTitles);
  if (built) sections.push(built);
}
if (sections.length === 0) {
  console.error("FEHLER: keine Quelle lieferte frische Meldungen — feed.json bleibt unverändert.");
  process.exit(1);
}

// Alexa-Flash-Briefing-Format: Array von Items, updateDate-Format yyyy-MM-dd'T'HH:mm:ss.S'Z'
const updateDate = new Date(now).toISOString().replace(/\.\d{3}Z$/, ".0Z");
const feed = sections.map((s, i) => ({
  uid: `urn:uid:daniels-tech-briefing:${new Date(now).toISOString().slice(0, 10)}:${i}`,
  updateDate,
  titleText: s.title,
  mainText: s.mainText,
  redirectionUrl: s.redirectionUrl,
}));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(feed, null, 2) + "\n");
for (const f of feed) {
  const hash = createHash("sha1").update(f.mainText).digest("hex").slice(0, 8);
  console.log(`${f.titleText}: ${f.mainText.length} Zeichen (${hash})`);
}
console.log(`geschrieben: ${OUT}`);
