# AESTH — Pinterest productfeed

Dit kleine project houdt één bestand actueel: `docs/pinterest-feed.csv`, de
productfeed die Pinterest elke ochtend (08:00 Amsterdam) ophaalt om de shop
als catalogus te tonen.

Normaal hoef je er niets aan te doen. Komt er een product bij in Fourthwall
(PUBLIC), dan staat het de volgende ochtend in de feed. Alleen voor **nieuwe
mockups** moet je zelf iets doen (zie onder).

## Hoe het werkt

1. Een GitHub Action draait elke nacht (04:17 UTC) `build-feed.mjs`.
2. Dat script haalt alle **publieke** producten op uit de Fourthwall Storefront API.
3. Het schrijft één CSV-regel per variant (kleur × maat) naar `docs/pinterest-feed.csv`.
4. GitHub Pages serveert dat bestand op een vaste URL.
5. Pinterest haalt die URL dagelijks op.

Varianten van hetzelfde product krijgen dezelfde `item_group_id`, zodat Pinterest
er één product-pin van maakt in plaats van vijftien losse.

## Eigen mockups als catalogusfoto

- `docs/pins/<design>/…-<kleur>-<setting>-v2.jpg` + `docs/pins/manifest.json` komen uit
  `AESTH/designs/_algemeen/mockup-basis/aesth_batch.py` (uitleg in de README daar).
- Per product + kleur wordt de **hoofdsetting** uit het manifest `image_link`
  (Black → lichtgym, Ivory/Bay → donkergym); de overige settings komen vooraan in
  `additional_image_link`, daarna de Fourthwall-foto's (max. 9 extra in totaal).
- Geen mockup voor een product? Dan alleen Fourthwall-foto's — het script meldt dat.
- Nieuwe mockups krijgen **altijd een nieuwe versie in de bestandsnaam** (`-v3`),
  anders blijft Pinterest de oude foto tonen.
- Pushen van `docs/pins/**` start de build vanzelf.

## Beveiliging tegen een kapotte feed

Op 3 okt 2026 gaf de Storefront API één nacht een verouderde lijst terug en
schreef het script die weg. Daarom weigert het script nu te schrijven (exit 2,
de bestaande feed blijft staan) als:

- het aantal varianten of producten meer dan 30 % lager is dan in de huidige CSV;
- de huidige feed eigen mockups heeft en de nieuwe ineens geen enkele;
- het manifest mockups bevat maar er geen enkele gebruikt wordt;
- de API minder producten teruggeeft dan ze zelf aankondigt (`elementsTotal`).

Is de daling **bewust** (producten gearchiveerd)? Actions → *Build Pinterest feed*
→ *Run workflow* → vinkje **force**. Lokaal: `FORCE=1`. Drempel aanpassen: `FEED_MAX_DROP=0.3`.

Verder: time-out van 30 s en 3 pogingen bij 5xx/429, cache-buster op elke
API-aanroep, de CSV wordt pas vervangen als hij volledig geschreven is, en
elke run schrijft `docs/last-build.txt` (heartbeat — GitHub zet geplande
workflows in een publieke repo uit na 60 dagen zonder commits).

## Eenmalige instellingen

| Wat | Waar |
|---|---|
| Secret `FW_STOREFRONT_TOKEN` | Settings → Secrets and variables → Actions |
| GitHub Pages | Settings → Pages → *Deploy from a branch* → `main`, map `/docs` |
| Feed-URL in Pinterest | Catalogi → Gegevensbronnen → bron met de Pages-URL |

De storefront-token is read-only en alleen voor publieke productdata; hij staat
toch in een secret, zodat hij niet in de commit-historie belandt.

## Zelf draaien

```bash
FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs          # gewone build
FORCE=1 FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs  # bewuste daling toestaan
```

## Wat er in de feed staat

Verplicht volgens Pinterest: `id`, `title`, `description`, `link`, `image_link`,
`price`, `availability`, `condition`, `brand`, `google_product_category`.
Daarnaast `item_group_id`, `additional_image_link`, `color`, `size`, `gender`,
`age_group`, `custom_label_0` (product-slug) en `custom_label_1` (kleur).

Titel = Fourthwall-naam + " — kleur, maat"; beschrijving = Fourthwall-beschrijving
als platte tekst (max. 5.000 tekens). Zoekwoorden voor de catalogus gaan dus via
de naam en beschrijving in Fourthwall.

Elke link krijgt `utm_source=pinterest&utm_medium=catalog&utm_campaign=pinterest-catalog&utm_content=<slug>`,
zodat Fourthwalls *Sales by UTM* catalogus-verkeer onderscheidt van `organic` en `paid`.

## Wat het script bewust overslaat

- Producten die niet `PUBLIC` zijn (gearchiveerde producten vallen er dus vanzelf uit)
- Bundels
- Varianten zonder afbeelding of zonder prijs

## Als er iets misgaat

| Symptoom | Waarschijnlijke oorzaak / actie |
|---|---|
| Action faalt op "Storefront API gaf 401" | token verlopen of secret verkeerd — zie SETUP.md |
| Action eindigt met "GEWEIGERD" (exit 2) | de beveiliging hierboven; controleer Fourthwall, bij bewuste daling *force* |
| Pinterest meldt "0 producten" | Pages staat uit of wijst naar de verkeerde map |
| Pinterest keurt regels af | Catalogi → Diagnostiek → per regel de melding |
| Waarschuwing 1306/1011 (429 op extra foto's) | GitHub Pages remt af; blijft het: `additionalImages` in `build-feed.mjs` verlagen (9 → 6) |
| Waarschuwing 1013 (aantal sterk veranderd) | normaal na archiveren; Pinterest kan oude artikelen tijdelijk vasthouden |
| Oude foto's in Pinterest | versie in de bestandsnaam niet opgehoogd |
| Feed staat stil | kijk of de Action nog draait (groen vinkje elke nacht, `docs/last-build.txt` van vandaag) |

Let op: WebFetch/cache-tools tonen vaak een verouderde versie van de feed —
controleer de live CSV in de browser of op GitHub.
