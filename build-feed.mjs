#!/usr/bin/env node
/**
 * AESTH — Pinterest productfeed builder
 *
 * Haalt alle publieke producten op uit de Fourthwall Storefront API en schrijft
 * een Pinterest-catalogusfeed (CSV) naar docs/pinterest-feed.csv.
 *
 * Eén regel per design × kleur (besluit 4 okt 2026). Pinterest maakt een pin van
 * ELKE regel × ELKE afbeelding; met een regel per maat (7 maten) en de Fourthwall-
 * flatlays erbij liep dat op tot ±1400 pins. Nu: alleen de eigen model-mockups
 * (één per setting), geen maat-regels, geen flatlays → 10 designs × ~2,5 kleuren
 * × 4 settings ≈ 100 pins. De maat kiest de klant op de productpagina; de prijs in
 * de feed is de vanaf-prijs (kleinste maat). Kleuren van hetzelfde design delen
 * item_group_id, zodat Pinterest ze als één product met kleurkeuze toont.
 *
 * Draaien:  FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------- instellingen

const CONFIG = {
  token: process.env.FW_STOREFRONT_TOKEN,
  // FW_API_BASE bestaat alleen om het script lokaal te kunnen testen tegen een
  // nagebootste API; in productie blijft dit de echte Storefront API.
  apiBase: process.env.FW_API_BASE || "https://storefront-api.fourthwall.com/v1",
  siteBase: "https://aesthwear.com",
  currency: "USD", // basisvaluta van de shop; Pinterest-catalogus draait op USD
  brand: "AESTH.",
  googleCategory: "Apparel & Accessories > Clothing > Shirts & Tops",
  gender: "unisex",
  ageGroup: "adult",
  outFile: "docs/pinterest-feed.csv",

  // UTM's waarmee elke klik uit de catalogus wordt gelabeld. 'catalog' staat
  // bewust los van 'organic' (handmatige pins) en 'paid' (promoted pins), zodat
  // het Sales-by-UTM rapport in Fourthwall de drie bronnen uit elkaar houdt.
  utm: {
    source: "pinterest",
    medium: "catalog",
    campaign: "pinterest-catalog",
  },

  // Hoeveel extra afbeeldingen per regel meesturen (Pinterest: max 10 totaal).
  // Let op: Pinterest maakt van ELKE extra afbeelding een aparte pin. Het manifest
  // heeft standaard 4 settings per kleur → hoofdsetting + 3 extra = 4 pins per design × kleur
  // (minder als een design in designs.json minder settings heeft; dit is alleen het maximum).
  // Wil je maar één pin per kleur (alleen de hoofdsetting): ADDITIONAL_IMAGES=0.
  additionalImages: Number(process.env.ADDITIONAL_IMAGES ?? 3),

  // Eigen Pinterest-mockups (gemaakt met aesth_batch.py, zie docs/pins/manifest.json).
  // Per design + kleur wordt de hoofdsetting (per kleur, zie manifest) de image_link en
  // de andere settings de additional_image_link. De Fourthwall-foto's (flatlays) gaan
  // NIET mee — we willen alleen pins met het model (besluit 3 + 4 okt 2026).
  // Een design + kleur ZONDER eigen mockup komt niet in de feed; het script meldt dat,
  // zodat je weet dat er nog mockups gemaakt moeten worden (aesth_batch.py). Alleen
  // voor noodgevallen: FW_FALLBACK=1 zet voor zulke kleuren de Fourthwall-foto's in.
  fourthwallFallback: process.env.FW_FALLBACK === "1",
  pinsManifest: "docs/pins/manifest.json",
  pinsDir: "docs/pins", // de bestanden waar het manifest naar verwijst
  pinsBaseUrl: "https://meakamst-stack.github.io/aesth-pinterest-feed/pins/",

  // Beveiliging tegen een haperende of verouderde API-respons (incident 3 okt 2026:
  // de API gaf een oude momentopname terug en de feed werd overschreven met 105
  // gearchiveerde producten). De nieuwe feed wordt geweigerd als het aantal designs of
  // design × kleur-combinaties meer dan `maxDrop` daalt t.o.v. de bestaande CSV, of als
  // er geen enkele eigen mockup meer in zit. Een bewuste daling (producten gearchiveerd)
  // gaat met FORCE=1 — in GitHub via "Run workflow" met het vinkje 'force'.
  force: process.env.FORCE === "1" || process.env.FORCE === "true",
  maxDrop: Number(process.env.FEED_MAX_DROP ?? 0.3),

  // Netwerk: een hangende verbinding mag het script niet eindeloos laten wachten.
  fetchTimeoutMs: 30_000,
  fetchAttempts: 3,
};

/** Leest de mockup-manifest in; ontbreekt die, dan worden alleen Fourthwall-foto's gebruikt. */
function loadPins() {
  if (!existsSync(CONFIG.pinsManifest)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG.pinsManifest, "utf8"));
  } catch (err) {
    console.warn(`Let op: ${CONFIG.pinsManifest} niet leesbaar (${err.message}) — alleen Fourthwall-foto's.`);
    return null;
  }
}

const PINS = loadPins();

// Product/kleur-combinaties zonder eigen mockup en manifest-paden zonder bestand,
// verzameld voor de log aan het eind.
const zonderMockup = new Set();
const ontbrekendePins = new Set();

/** Mockup-URL's voor één product + kleur: [hoofdfoto, ...overige settings] of []. */
function pinImages(slug, color) {
  const perColor = PINS?.producten?.[slug]?.kleuren?.[color];
  if (!perColor) return [];
  // Sinds 4 okt 2026 zet aesth_batch.py per product + kleur de volgorde in het manifest
  // ("volgorde": {"Black": ["lichtgym", "straat", ...]}, hoofdfoto eerst) — zo kan elk design
  // eigen settings en een eigen hoofdfoto hebben. Oudere manifests: globale hoofdsetting.
  let order = PINS.producten[slug].volgorde?.[color];
  if (!Array.isArray(order) || order.length === 0) {
    // hoofdsetting is één setting ("gym") of per kleur ({"Black": "lichtgym", "Ivory": "donkergym"}).
    const hs = PINS.hoofdsetting;
    const main = typeof hs === "string" ? hs : hs?.[color] || PINS.settings[0];
    order = [main, ...PINS.settings.filter((s) => s !== main)];
  }
  return order
    .filter((s) => perColor[s])
    .filter((s) => {
      // Een manifest-pad zonder bestand zou een 404-afbeelding in de feed zetten
      // (Pinterest keurt die regel dan af). Overslaan en melden.
      const ok = existsSync(join(CONFIG.pinsDir, perColor[s]));
      if (!ok) ontbrekendePins.add(perColor[s]);
      return ok;
    })
    .map((s) => CONFIG.pinsBaseUrl + perColor[s]);
}

// Kolommen in de volgorde die Pinterest verwacht. Verplicht volgens de spec: id, title,
// description, link, image_link, price, availability (+ item_group_id bij varianten);
// de rest is optioneel maar aanbevolen voor shopping ads.
const COLUMNS = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "price",
  "availability",
  "condition",
  "brand",
  "google_product_category",
  "item_group_id",
  "additional_image_link",
  "color",
  "size",
  "gender",
  "age_group",
  "custom_label_0",
  "custom_label_1",
];

// ---------------------------------------------------------------- hulpfuncties

/** Haalt HTML uit de productbeschrijving en maakt er leesbare platte tekst van. */
function toPlainText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    // Elk blokelement dat sluit krijgt een spatie, anders plakken lijstitems aan
    // elkaar ("Back print onlyComfort Colors…").
    .replace(/<\/(p|li|h[1-6]|div|ul|ol|tr|td|th)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(rsquo|lsquo);/gi, "'")
    .replace(/&(rdquo|ldquo);/gi, '"')
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&eacute;/gi, "é")
    .replace(/&hellip;/gi, "…")
    .replace(/&amp;/gi, "&") // als laatste, anders wordt &amp;lt; dubbel gedecodeerd
    .replace(/\s+/g, " ")
    .trim();
}

/** Knipt tekst af op een woordgrens, zonder midden in een woord te eindigen. */
function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Zet één waarde om naar een veilig CSV-veld. */
function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function productUrl(slug) {
  const u = new URL(`${CONFIG.siteBase}/products/${slug}`);
  u.searchParams.set("utm_source", CONFIG.utm.source);
  u.searchParams.set("utm_medium", CONFIG.utm.medium);
  u.searchParams.set("utm_campaign", CONFIG.utm.campaign);
  u.searchParams.set("utm_content", slug);
  return u.toString();
}

// ------------------------------------------------------------------- ophalen

/**
 * fetch met timeout en herkansing. Bij 5xx/429 of een netwerkfout wordt het tot
 * CONFIG.fetchAttempts keer geprobeerd (2 s, 4 s wachten); een 4xx is definitief.
 */
async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= CONFIG.fetchAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(CONFIG.fetchTimeoutMs),
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
      });
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`Storefront API gaf ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        throw Object.assign(new Error(`Storefront API gaf ${res.status} ${res.statusText}`), { fatal: true });
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.fatal || attempt === CONFIG.fetchAttempts) break;
      const wait = 2000 * attempt;
      console.warn(`Poging ${attempt} mislukt (${err.message}) — opnieuw over ${wait / 1000} s.`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fetchAllProducts() {
  const products = [];
  let page = 0;
  let expectedTotal = null;

  for (;;) {
    const url =
      `${CONFIG.apiBase}/collections/all/products` +
      `?storefront_token=${encodeURIComponent(CONFIG.token)}` +
      `&currency=${CONFIG.currency}&page=${page}&size=50` +
      `&_=${Date.now()}`; // cache-buster: elke run een unieke URL

    const data = await fetchJson(url);
    products.push(...(data.results || []));
    if (typeof data.paging?.elementsTotal === "number") expectedTotal = data.paging.elementsTotal;

    if (!data.paging?.hasNextPage) break;
    page += 1;
    if (page > 40) throw new Error("Te veel pagina's — waarschijnlijk een oneindige lus.");
  }

  // De API zegt zelf hoeveel producten er zijn; klopt dat niet met wat we kregen → stoppen.
  if (expectedTotal !== null && expectedTotal !== products.length) {
    throw new Error(`API meldt ${expectedTotal} producten maar gaf er ${products.length} — onvolledige respons.`);
  }

  return products;
}

// -------------------------------------------------------------------- omzetten

/** Kleurnaam → stukje voor in de feed-id: "Ivory" → "ivory", "Heather Grey" → "heather-grey". */
function colorSlug(color) {
  return String(color)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accenten weg
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Is een variant uitverkocht? (Fourthwall: alleen bij LIMITED voorraad zonder stuks.) */
function variantSoldOut(variant) {
  return variant.stock?.type === "LIMITED" && !(variant.stock?.inStock > 0);
}

/**
 * Eén feedregel per design × kleur. De maten van een kleur worden samengevoegd:
 * de regel krijgt de laagste prijs (vanaf-prijs, in de praktijk de kleinste maat —
 * dat is ook de prijs die de productpagina standaard toont) en is "in stock" zolang
 * ten minste één maat leverbaar is.
 */
function colorRows(product) {
  const slug = product.slug;
  const link = productUrl(slug);
  // Lege beschrijving zou een lege verplichte kolom geven (Pinterest keurt de regel af).
  const plain = toPlainText(product.description);
  if (!plain) console.warn(`Let op: ${slug} heeft geen beschrijving — productnaam gebruikt.`);
  const description = truncate(plain || product.name, 5000);
  const productImages = product.images || [];

  // Varianten per kleur bij elkaar, in de volgorde waarin Fourthwall ze geeft.
  const perColor = new Map();
  for (const variant of product.variants || []) {
    const color = variant.attributes?.color?.name || "";
    if (!perColor.has(color)) perColor.set(color, []);
    perColor.get(color).push(variant);
  }

  return [...perColor.entries()].flatMap(([color, variants]) => {
    const label = `${slug} / ${color || "(geen kleur)"}`;

    // Alleen eigen model-mockups; zonder mockup geen regel (tenzij FW_FALLBACK=1).
    let images = pinImages(slug, color);
    if (!images.length) {
      zonderMockup.add(label);
      if (!CONFIG.fourthwallFallback) return [];
      // Kleur-specifieke Fourthwall-foto's als die er zijn, anders de productfoto's.
      const withImages = variants.find((v) => v.images?.length);
      images = (withImages ? withImages.images : productImages).map((i) => i.url);
      if (!images.length) return []; // zonder afbeelding keurt Pinterest de regel af
    }

    // Vanaf-prijs: de laagste prijs van alle maten in deze kleur (zelfde valuta).
    const priced = variants.filter((v) => v.unitPrice?.value > 0);
    if (!priced.length) return [];
    const cheapest = priced.reduce((a, b) => (Number(b.unitPrice.value) < Number(a.unitPrice.value) ? b : a));
    const price = cheapest.unitPrice;

    const soldOut = product.state?.type === "SOLD_OUT" || variants.every(variantSoldOut);

    return [
      {
        // Vaste id per design × kleur (niet de maat-SKU): blijft gelijk zolang slug en
        // kleurnaam gelijk blijven, zodat Pinterest de pin niet telkens opnieuw aanmaakt.
        id: color ? `${slug}-${colorSlug(color)}` : slug,
        title: truncate(color ? `${product.name} — ${color}` : product.name, 500),
        description,
        link,
        image_link: images[0],
        price: `${Number(price.value).toFixed(2)} ${price.currency}`,
        availability: soldOut ? "out of stock" : "in stock",
        condition: "new",
        brand: CONFIG.brand,
        google_product_category: CONFIG.googleCategory,
        item_group_id: slug, // kleuren van één design samen als één product met kleurkeuze
        additional_image_link: images.slice(1, 1 + CONFIG.additionalImages).join(","),
        color,
        size: "", // bewust leeg: de maat kiest de klant op de productpagina
        gender: CONFIG.gender,
        age_group: CONFIG.ageGroup,
        custom_label_0: slug, // per design groeperen in Pinterest-advertentiegroepen
        custom_label_1: color, // per kleur groeperen
      },
    ];
  });
}

// ---------------------------------------------------------------- beveiliging

/** Minimale RFC-4180-parser: quotes, dubbele quotes, komma's en regeleinden binnen quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

/**
 * Telt designs, design × kleur-combinaties en eigen mockups in een set feedrijen
 * (arrays in COLUMNS-volgorde). Bewust niet het ruwe aantal regels: de oude feed had
 * een regel per maat, de nieuwe een regel per kleur — designs en kleuren zijn in beide
 * vergelijkbaar, en dat is wat er bij een haperende API ineens instort.
 */
function feedStats(rows, header) {
  const ig = header.indexOf("item_group_id");
  const il = header.indexOf("image_link");
  const ic = header.indexOf("color");
  const ia = header.indexOf("additional_image_link");
  const imgCount = (r) => 1 + (ia >= 0 && r[ia] ? String(r[ia]).split(",").length : 0);
  return {
    rows: rows.length,
    designs: new Set(rows.map((r) => r[ig])).size,
    colors: new Set(rows.map((r) => `${r[ig]}\u0000${ic >= 0 ? r[ic] : ""}`)).size,
    withPins: rows.filter((r) => String(r[il]).startsWith(CONFIG.pinsBaseUrl)).length,
    images: rows.reduce((n, r) => n + imgCount(r), 0), // ≈ het aantal pins dat Pinterest maakt
  };
}

function readExistingStats(path) {
  if (!existsSync(path)) return null;
  try {
    const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
    if (!header?.includes("item_group_id")) return null;
    return feedStats(rows, header);
  } catch (err) {
    console.warn(`Let op: bestaande feed niet leesbaar (${err.message}) — vergelijking overgeslagen.`);
    return null;
  }
}

/** Redenen om de nieuwe feed NIET weg te schrijven; lege lijst = akkoord. */
function guard(newRows) {
  const reasons = [];
  const nieuw = feedStats(newRows.map((r) => COLUMNS.map((c) => r[c])), COLUMNS);
  const oud = readExistingStats(CONFIG.outFile);

  if (oud) {
    const grens = 1 - CONFIG.maxDrop;
    const pct = Math.round(CONFIG.maxDrop * 100);
    if (nieuw.designs < oud.designs * grens) {
      reasons.push(`designs dalen van ${oud.designs} naar ${nieuw.designs} (meer dan ${pct} %)`);
    }
    if (nieuw.colors < oud.colors * grens) {
      reasons.push(`design × kleur-combinaties dalen van ${oud.colors} naar ${nieuw.colors} (meer dan ${pct} %)`);
    }
    if (oud.withPins > 0 && nieuw.withPins === 0) {
      reasons.push(`de bestaande feed had ${oud.withPins} eigen mockups als hoofdfoto, de nieuwe 0`);
    }
  }
  if (PINS && Object.keys(PINS.producten || {}).length && nieuw.withPins === 0) {
    reasons.push("manifest.json bevat mockups, maar geen enkele regel kreeg er een als image_link");
  }

  const fmt = (s) => `${s.rows} regels / ${s.designs} designs / ${s.colors} kleuren / ${s.withPins} met eigen mockup / ±${s.images} pins`;
  console.log(`Controle: ${fmt(nieuw)}` + (oud ? ` (bestaande feed: ${fmt(oud)})` : " (geen bestaande feed)"));
  return reasons;
}

// ------------------------------------------------------------------ uitvoeren

async function main() {
  if (!CONFIG.token) {
    console.error("Fout: omgevingsvariabele FW_STOREFRONT_TOKEN ontbreekt.");
    process.exit(1);
  }

  const all = await fetchAllProducts();

  const usable = all.filter(
    (p) => p.type === "PRODUCT" && p.access?.type === "PUBLIC"
  );

  const rows = usable.flatMap(colorRows);

  if (!rows.length) {
    console.error(
      "Fout: geen enkele bruikbare design × kleur gevonden — feed niet weggeschreven." +
        (zonderMockup.size ? ` Zonder eigen mockup: ${[...zonderMockup].join("; ")}` : "")
    );
    process.exit(1);
  }

  // Dubbele id's zouden de hele feed laten afkeuren.
  const seen = new Set();
  const duplicates = [];
  for (const r of rows) {
    if (seen.has(r.id)) duplicates.push(r.id);
    seen.add(r.id);
  }
  if (duplicates.length) {
    console.error(`Fout: dubbele id's in de feed: ${duplicates.join(", ")}`);
    process.exit(1);
  }

  // Beveiliging: een sterk gekrompen of mockup-loze feed wijst op een haperende API.
  const reasons = guard(rows);
  if (reasons.length) {
    if (CONFIG.force) {
      console.warn(`FORCE=1: beveiliging bewust omzeild. Redenen die anders zouden blokkeren:\n  - ${reasons.join("\n  - ")}`);
    } else {
      console.error(
        `GEWEIGERD — bestaande feed blijft staan. Redenen:\n  - ${reasons.join("\n  - ")}\n` +
          `Is dit een bewuste wijziging (producten gearchiveerd)? Start de workflow handmatig met het vinkje 'force' (FORCE=1).`
      );
      process.exit(2);
    }
  }
  if (ontbrekendePins.size) {
    console.warn(`Let op: manifest verwijst naar bestanden die niet in ${CONFIG.pinsDir} staan (overgeslagen): ${[...ontbrekendePins].join(", ")}`);
  }
  if (zonderMockup.size) {
    console.warn(
      CONFIG.fourthwallFallback
        ? `Let op: zonder eigen mockup (FW_FALLBACK=1, Fourthwall-foto als hoofdfoto): ${[...zonderMockup].join("; ")}`
        : `Let op: NIET in de feed (geen eigen mockup — maak ze met aesth_batch.py): ${[...zonderMockup].join("; ")}`
    );
  }

  const csv = [
    COLUMNS.join(","),
    ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(",")),
  ].join("\n");

  // Atomisch schrijven: eerst een tijdelijk bestand, dan hernoemen — nooit een half bestand.
  mkdirSync(dirname(CONFIG.outFile), { recursive: true });
  const tmp = CONFIG.outFile + ".tmp";
  writeFileSync(tmp, csv + "\n", "utf8");
  renameSync(tmp, CONFIG.outFile);

  const withPins = rows.filter((r) => r.image_link.startsWith(CONFIG.pinsBaseUrl)).length;
  const pins = rows.reduce((n, r) => n + 1 + (r.additional_image_link ? r.additional_image_link.split(",").length : 0), 0);
  console.log(`${withPins} van ${rows.length} regels met eigen mockup als hoofdfoto; Pinterest maakt hier ±${pins} pins van`);

  const perDesign = {};
  for (const r of rows) (perDesign[r.item_group_id] ||= []).push(r.color || "(geen kleur)");

  console.log(`Feed geschreven naar ${CONFIG.outFile}`);
  console.log(`${Object.keys(perDesign).length} designs, ${rows.length} regels (design × kleur), ${csv.length} bytes`);
  for (const [design, colors] of Object.entries(perDesign)) {
    console.log(`  ${design}: ${colors.join(", ")}`);
  }

  const skipped = all.length - usable.length;
  if (skipped > 0) console.log(`${skipped} item(s) overgeslagen (niet publiek of geen los product)`);
  const zonderRegel = usable.filter((p) => !perDesign[p.slug]).map((p) => p.slug);
  if (zonderRegel.length) console.log(`${zonderRegel.length} publiek design(s) zonder enige regel (geen mockups): ${zonderRegel.join(", ")}`);
}

main().catch((err) => {
  console.error("Feed bouwen mislukt:", err.message);
  process.exit(1);
});
