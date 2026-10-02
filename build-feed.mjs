#!/usr/bin/env node
/**
 * AESTH — Pinterest productfeed builder
 *
 * Haalt alle publieke producten op uit de Fourthwall Storefront API en schrijft
 * een Pinterest-catalogusfeed (CSV) naar docs/pinterest-feed.csv.
 *
 * Eén regel per variant (kleur x maat). Varianten van hetzelfde design worden
 * door Pinterest gegroepeerd via item_group_id, zodat er per design één
 * product-Pin ontstaat in plaats van vijftien.
 *
 * Draaien:  FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

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

  // Hoeveel extra afbeeldingen per variant meesturen (Pinterest: max 10 totaal).
  additionalImages: 5,

  // Eigen Pinterest-mockups (gemaakt met aesth_batch.py, zie docs/pins/manifest.json).
  // Bestaat er voor een product + kleur een mockup, dan wordt de hoofdsetting (gym) de
  // image_link en komen de andere settings vooraan in additional_image_link; de
  // Fourthwall-foto's volgen daarna. Zonder mockup blijft alles zoals het was.
  pinsManifest: "docs/pins/manifest.json",
  pinsBaseUrl: "https://meakamst-stack.github.io/aesth-pinterest-feed/pins/",
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

/** Mockup-URL's voor één product + kleur: [hoofdfoto, ...overige settings] of []. */
function pinImages(slug, color) {
  const perColor = PINS?.producten?.[slug]?.kleuren?.[color];
  if (!perColor) return [];
  const order = [PINS.hoofdsetting, ...PINS.settings.filter((s) => s !== PINS.hoofdsetting)];
  return order.filter((s) => perColor[s]).map((s) => CONFIG.pinsBaseUrl + perColor[s]);
}

// Kolommen in de volgorde die Pinterest verwacht. De eerste acht zijn verplicht.
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
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
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

async function fetchAllProducts() {
  const products = [];
  let page = 0;

  for (;;) {
    const url =
      `${CONFIG.apiBase}/collections/all/products` +
      `?storefront_token=${encodeURIComponent(CONFIG.token)}` +
      `&currency=${CONFIG.currency}&page=${page}&size=50`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Storefront API gaf ${res.status} ${res.statusText} op pagina ${page}`);
    }
    const data = await res.json();
    products.push(...(data.results || []));

    if (!data.paging?.hasNextPage) break;
    page += 1;
    if (page > 40) throw new Error("Te veel pagina's — waarschijnlijk een oneindige lus.");
  }

  return products;
}

// -------------------------------------------------------------------- omzetten

function variantRows(product) {
  const slug = product.slug;
  const link = productUrl(slug);
  const description = truncate(toPlainText(product.description), 5000);
  const productImages = product.images || [];

  return (product.variants || []).flatMap((variant) => {
    const color = variant.attributes?.color?.name || "";
    const size = variant.attributes?.size?.name || "";

    // Kleur-specifieke foto's als die er zijn, anders de productfoto's.
    const fwImages = (variant.images?.length ? variant.images : productImages).map((i) => i.url);
    // Eigen mockups (indien aanwezig) gaan vóór de Fourthwall-foto's.
    const images = [...pinImages(slug, color), ...fwImages];
    if (!images.length) return []; // zonder afbeelding keurt Pinterest de regel af

    const soldOut =
      product.state?.type === "SOLD_OUT" ||
      (variant.stock?.type === "LIMITED" && !(variant.stock?.inStock > 0));

    const price = variant.unitPrice;
    if (!price?.value) return [];

    return [
      {
        id: variant.sku || variant.id,
        title: truncate(`${product.name} — ${[color, size].filter(Boolean).join(", ")}`, 500),
        description,
        link,
        image_link: images[0],
        price: `${Number(price.value).toFixed(2)} ${price.currency}`,
        availability: soldOut ? "out of stock" : "in stock",
        condition: "new",
        brand: CONFIG.brand,
        google_product_category: CONFIG.googleCategory,
        item_group_id: slug,
        additional_image_link: images.slice(1, 1 + CONFIG.additionalImages).join(","),
        color,
        size,
        gender: CONFIG.gender,
        age_group: CONFIG.ageGroup,
        custom_label_0: slug, // per design groeperen in Pinterest-advertentiegroepen
        custom_label_1: color, // per kleur groeperen
      },
    ];
  });
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

  const rows = usable.flatMap(variantRows);

  if (!rows.length) {
    console.error("Fout: geen enkele bruikbare variant gevonden — feed niet weggeschreven.");
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

  const csv = [
    COLUMNS.join(","),
    ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(",")),
  ].join("\n");

  mkdirSync(dirname(CONFIG.outFile), { recursive: true });
  writeFileSync(CONFIG.outFile, csv + "\n", "utf8");

  const withPins = rows.filter((r) => r.image_link.startsWith(CONFIG.pinsBaseUrl)).length;
  console.log(`${withPins} van ${rows.length} varianten met eigen mockup als hoofdfoto`);

  const perDesign = {};
  for (const r of rows) perDesign[r.item_group_id] = (perDesign[r.item_group_id] || 0) + 1;

  console.log(`Feed geschreven naar ${CONFIG.outFile}`);
  console.log(`${usable.length} designs, ${rows.length} varianten, ${csv.length} bytes`);
  for (const [design, count] of Object.entries(perDesign)) {
    console.log(`  ${design}: ${count} varianten`);
  }

  const skipped = all.length - usable.length;
  if (skipped > 0) console.log(`${skipped} item(s) overgeslagen (niet publiek of geen los product)`);
}

main().catch((err) => {
  console.error("Feed bouwen mislukt:", err.message);
  process.exit(1);
});
