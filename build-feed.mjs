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
  maxDrop: Number(process.env.FEED_MAX_DROP ?? 0.05), // 10 okt 2026: was 0.3; nacht-API gaf 50 i.p.v. 69 (−27 %) en glipte erdoor

  // Netwerk: een hangende verbinding mag het script niet eindeloos laten wachten.
  fetchTimeoutMs: 30_000,
  fetchAttempts: 3,
};

/**
 * Designs waarvan Pinterest de nieuwe hoofdfoto niet opnieuw opnam (vielen stil uit de
 * catalogus). Waarde = versie; verhogen als het opnieuw nodig is.
 * 29 okt 2026: 5 herenshirts batch 8 na de fotowissel van 25 okt (catalogus 108/113).
 */
const PINTEREST_IMAGE_REFRESH = {
  "beast-mode-oversized-gym-tee": 2,
  "lift-heavy-oversized-gym-tee": 2,
  "practice-safe-sets-oversized-gym-tee": 2,
  "go-hard-or-go-home-oversized-gym-tee": 2,
  "powered-by-protein-oversized-gym-tee": 2,
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

    // Pinterest verwerkt een gewijzigde afbeelding soms niet opnieuw (de regel valt dan
    // stil uit de catalogus). Een versie-parameter achter de URL dwingt herverwerking af.
    const refresh = PINTEREST_IMAGE_REFRESH[slug];
    if (refresh) images = images.map((u) => `${u}${u.includes("?") ? "&" : "?"}v=${refresh}`);

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

// ------------------------------------------------------------ Google-feed
//
// 20 okt 2026: tweede uitvoer voor Google Merchant Center (gratis productvermeldingen).
// Anders dan Pinterest: één regel per MAAT (Google eist bij kleding size, color,
// gender en age_group per variant), productfoto's van Fourthwall (flatlay + close-up,
// geen modellen) en gratis verzending binnen de VS in de feed zelf.
// Een fout hier mag de Pinterest-feed nooit raken: die is dan al weggeschreven.

const GOOGLE = {
  outFile: "docs/google-feed.tsv",
  utm: { source: "google", medium: "free-listing", campaign: "google-shopping" },
  shipping: "US:::0.00 USD", // gratis verzending in de VS (actie 'Free US shipping')
  productType: "Oversized Gym Tees",
  minRows: 50, // minder regels = waarschijnlijk een haperende API → niet wegschrijven
  // Designs die NIET naar Google gaan (blijven wel op de site en in de Pinterest-feed).
  // 21 okt 2026: afgekeurd door Google als "Restricted adult content" (woord "smut").
  exclude: new Set(["lift-heavy-read-smut-oversized-gym-tee"]),
  // 29 okt 2026: op de site staat de close-up van de print op plek 1 en de flatlay op plek 2.
  // Google krijgt de flatlay (hele shirt) als hoofdbeeld; de close-up gaat mee als extra beeld.
  // Producten met minder dan 3 foto's: gewoon de eerste foto.
  flatlayIndex: 1,
};

// Hoofdbeeld voor Google vooraan zetten (zie GOOGLE.flatlayIndex).
function googleImageOrder(list) {
  const i = GOOGLE.flatlayIndex;
  if (!i || list.length < 3 || i >= list.length) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

function tsvField(value) {
  // Tabs en regeleinden zouden de kolommen verschuiven.
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

function googleLink(slug) {
  const u = new URL(`${CONFIG.siteBase}/products/${slug}`);
  u.searchParams.set("utm_source", GOOGLE.utm.source);
  u.searchParams.set("utm_medium", GOOGLE.utm.medium);
  u.searchParams.set("utm_campaign", GOOGLE.utm.campaign);
  u.searchParams.set("utm_content", slug);
  return u.toString();
}

const GOOGLE_COLUMNS = [
  "id", "item_group_id", "title", "description", "link", "image_link", "additional_image_link",
  "price", "availability", "condition", "brand", "identifier_exists", "google_product_category",
  "product_type", "color", "size", "size_system", "gender", "age_group", "material", "pattern", "shipping",
];

function googleRows(product) {
  const slug = product.slug;
  if (GOOGLE.exclude.has(slug)) return [];
  const plain = toPlainText(product.description) || product.name;
  const images = (product.images || []).map((i) => i.url).filter(Boolean);
  if (!images.length) return [];
  return (product.variants || []).flatMap((v) => {
    const size = v.attributes?.size?.name || "";
    const color = v.attributes?.color?.name || "";
    const price = v.unitPrice;
    if (!price?.value || !size || !v.id) return [];
    const vImages = googleImageOrder((v.images?.length ? v.images.map((i) => i.url) : images).filter(Boolean));
    return [{
      id: String(v.id).slice(0, 50),
      item_group_id: slug.slice(0, 50),
      title: truncate(`${product.name}${size ? ` — ${size}` : ""}`, 150),
      description: truncate(plain, 5000),
      link: googleLink(slug),
      image_link: vImages[0],
      additional_image_link: vImages.slice(1, 4).join(","),
      price: `${Number(price.value).toFixed(2)} ${price.currency}`,
      availability: product.state?.type === "SOLD_OUT" || variantSoldOut(v) ? "out_of_stock" : "in_stock",
      condition: "new",
      brand: CONFIG.brand,
      identifier_exists: "no",
      google_product_category: CONFIG.googleCategory,
      product_type: GOOGLE.productType,
      color,
      size,
      size_system: "US",
      gender: CONFIG.gender,
      age_group: CONFIG.ageGroup,
      // 25 okt 2026: Merchant Center vroeg om Color, Pattern, Material bij alle shirts.
      material: "Cotton",
      pattern: "Graphic Print",
      shipping: GOOGLE.shipping,
    }];
  });
}

function writeGoogleFeed(usable) {
  try {
    const rows = usable.flatMap(googleRows);
    const ids = new Set(rows.map((r) => r.id));
    if (ids.size !== rows.length) throw new Error("dubbele id's");
    if (rows.length < GOOGLE.minRows && !CONFIG.force) {
      throw new Error(`maar ${rows.length} regels (minimum ${GOOGLE.minRows}) — bestaande Google-feed blijft staan`);
    }
    const tsv = [GOOGLE_COLUMNS.join("\t"), ...rows.map((r) => GOOGLE_COLUMNS.map((c) => tsvField(r[c])).join("\t"))].join("\n");
    const tmp = GOOGLE.outFile + ".tmp";
    writeFileSync(tmp, tsv + "\n", "utf8");
    renameSync(tmp, GOOGLE.outFile);
    const designs = new Set(rows.map((r) => r.item_group_id)).size;
    console.log(`Google-feed geschreven naar ${GOOGLE.outFile}: ${rows.length} regels (${designs} designs × maten)`);
  } catch (err) {
    console.warn(`Let op: Google-feed NIET bijgewerkt (${err.message}). Pinterest-feed is wel geschreven.`);
  }
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

  writeGoogleFeed(usable);

  const skipped = all.length - usable.length;
  if (skipped > 0) console.log(`${skipped} item(s) overgeslagen (niet publiek of geen los product)`);
  const zonderRegel = usable.filter((p) => !perDesign[p.slug]).map((p) => p.slug);
  if (zonderRegel.length) console.log(`${zonderRegel.length} publiek design(s) zonder enige regel (geen mockups): ${zonderRegel.join(", ")}`);
}

main().catch((err) => {
  console.error("Feed bouwen mislukt:", err.message);
  process.exit(1);
});
