# AESTH — Pinterest productfeed

Dit kleine project houdt één bestand actueel: `docs/pinterest-feed.csv`, de
productfeed die Pinterest elke ochtend (08:00 Amsterdam) ophaalt om de shop
als catalogus te tonen.

Normaal hoef je er niets aan te doen. Komt er een product bij in Fourthwall
(PUBLIC), dan staat het de volgende ochtend in de feed — **zodra er eigen
mockups voor zijn** (zie onder). Zonder mockups blijft een design buiten de feed.

## AESTH 2.0 (vanaf 7 okt 2026)

- Eén product (Comfort Colors 1717) in **één kleur: Pepper**, 50 designs → **50 regels, 100 pins**
  (per regel `image_link` = straatfoto, `additional_image_link` = gymfoto).
- `docs/pins/<design>/<design>-pepper-straat-v1.jpg` en `…-gym-v1.jpg` (1000×1500) komen uit
  `AESTH/designs-v2/_make/mockup-fotos.py` (bestanden `pin-straat`/`pin-gym` in `AESTH/designs-v2/fotos/<design>/`).
  Mockups: straat = TheVibeMocks (Etsy), gym = MockupellaStudio (Etsy). Print op ware grootte.
- `manifest.json`: `producten["<design>-oversized-gym-tee"].kleuren.Pepper = {straat, gym}`, `volgorde.Pepper = ["straat","gym"]`.
- De oude pins (14 designs, Black/Ivory/Bay, `-v2`) zijn uit `docs/pins` gehaald; de oude producten zijn in
  Fourthwall gearchiveerd en vallen dus uit de feed. Pinterest verwijdert artikelen die niet meer in de feed
  staan bij de volgende opname.
- Nieuwe mockups? Versie ophogen (`-v2`), anders blijft Pinterest de oude foto tonen.

## Hoe het werkt

1. Een GitHub Action draait elke nacht (04:17 UTC) `build-feed.mjs`.
2. Dat script haalt alle **publieke** producten op uit de Fourthwall Storefront API.
3. Het schrijft **één CSV-regel per design × kleur** naar `docs/pinterest-feed.csv`
   (maten worden samengevoegd; prijs = vanaf-prijs van de kleinste maat).
4. GitHub Pages serveert dat bestand op een vaste URL.
5. Pinterest haalt die URL dagelijks op.

Kleuren van hetzelfde design krijgen dezelfde `item_group_id`, zodat Pinterest ze
als één product met kleurkeuze toont. De maat kiest de klant op de productpagina.

## Waarom één regel per kleur (en niet per maat)

Pinterest maakt een pin van **elke regel × elke afbeelding**. Met een regel per
maat (7 maten) en de Fourthwall-flatlays erbij stonden er begin oktober 2026
±1.400 pins in de catalogus, grotendeels dubbel en met flatlays. Sinds 4 okt 2026:

| | regels | afbeeldingen per regel | pins |
|---|---|---|---|
| vóór 3 okt | 175 (kleur × maat) | eigen mockups + Fourthwall-flatlays | ±1.400 |
| 3 okt | 175 (kleur × maat) | 4 eigen mockups | 700 |
| **vanaf 4 okt** | **25 (design × kleur)** | **4 eigen mockups** | **100** |

Wil je maar één pin per kleur (alleen de hoofdsetting)? `ADDITIONAL_IMAGES=0` →
25 pins. Het aantal designs en kleuren bepaalt het verder.

## Eigen mockups als catalogusfoto

- `docs/pins/<design>/…-<kleur>-<setting>-v2.jpg` + `docs/pins/manifest.json` komen uit
  `AESTH/designs/_algemeen/mockup-basis/aesth_batch.py` (uitleg in de README daar).
- Per design + kleur wordt de **hoofdsetting** uit het manifest `image_link`
  (standaard Black → lichtgym, Ivory/Bay → donkergym); de overige settings worden
  `additional_image_link`. Sinds 4 okt 2026 staat per product + kleur een `volgorde`
  in het manifest (hoofdfoto eerst), zodat een design eigen settings/hoofdfoto kan
  hebben; zonder `volgorde` geldt de globale hoofdsetting. **Fourthwall-foto's (flatlays) gaan nooit mee** — we
  willen alleen pins met het model.
- **Geen mockup voor een design + kleur? Dan komt die kleur niet in de feed.** Het
  script meldt dat in de log ("NIET in de feed"), zodat je weet dat er mockups
  gemaakt moeten worden. Alleen voor noodgevallen: `FW_FALLBACK=1` zet voor zulke
  kleuren tijdelijk de Fourthwall-foto's in.
- Nieuwe mockups krijgen **altijd een nieuwe versie in de bestandsnaam** (`-v3`),
  anders blijft Pinterest de oude foto tonen.
- Pushen van `docs/pins/**` start de build vanzelf.

## Beveiliging tegen een kapotte feed

Op 3 okt 2026 gaf de Storefront API één nacht een verouderde lijst terug en
schreef het script die weg. Daarom weigert het script nu te schrijven (exit 2,
de bestaande feed blijft staan) als:

- het aantal designs of design × kleur-combinaties meer dan 30 % lager is dan in de huidige CSV;
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
ADDITIONAL_IMAGES=0 FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs  # één pin per kleur
```

## Wat er in de feed staat

Verplicht volgens Pinterest: `id`, `title`, `description`, `link`, `image_link`,
`price`, `availability`, `condition`, `brand`, `google_product_category`.
Daarnaast `item_group_id`, `additional_image_link`, `color`, `size` (bewust leeg),
`gender`, `age_group`, `custom_label_0` (product-slug) en `custom_label_1` (kleur).

`id` = `<slug>-<kleur>` (bijv. `intention-oversized-gym-tee-black`) — vast per
design × kleur, dus Pinterest houdt de pin zolang slug en kleurnaam gelijk blijven.
Titel = Fourthwall-naam + " — kleur"; prijs = laagste prijs van de maten in die kleur
(wat de productpagina standaard toont); `in stock` zolang één maat leverbaar is.
Beschrijving = Fourthwall-beschrijving als platte tekst (max. 5.000 tekens).
Zoekwoorden voor de catalogus gaan dus via de naam en beschrijving in Fourthwall.

Elke link krijgt `utm_source=pinterest&utm_medium=catalog&utm_campaign=pinterest-catalog&utm_content=<slug>`,
zodat Fourthwalls *Sales by UTM* catalogus-verkeer onderscheidt van `organic` en `paid`.

## Wat het script bewust overslaat

- Producten die niet `PUBLIC` zijn (gearchiveerde producten vallen er dus vanzelf uit)
- Bundels
- Design × kleur zonder eigen mockup in `manifest.json` (log: "NIET in de feed")
- Kleuren zonder prijs
- Fourthwall-foto's (flatlays) — tenzij `FW_FALLBACK=1`

## Als er iets misgaat

| Symptoom | Waarschijnlijke oorzaak / actie |
|---|---|
| Action faalt op "Storefront API gaf 401" | token verlopen of secret verkeerd — zie SETUP.md |
| Action eindigt met "GEWEIGERD" (exit 2) | de beveiliging hierboven; controleer Fourthwall, bij bewuste daling *force* |
| Pinterest meldt "0 producten" | Pages staat uit of wijst naar de verkeerde map |
| Pinterest keurt regels af | Catalogi → Diagnostiek → per regel de melding |
| Waarschuwing 1306/1011 (429 op extra foto's) | GitHub Pages remt af; sinds 4 okt nog maar 100 afbeeldingen in totaal — blijft het: `ADDITIONAL_IMAGES` verlagen |
| Waarschuwing 1013 (aantal sterk veranderd) | normaal na archiveren én eenmalig op 4 okt 2026 (175 → 25 regels, nieuwe id's); Pinterest kan oude artikelen tijdelijk vasthouden |
| Een design ontbreekt in Pinterest | staat het in de log als "NIET in de feed"? Dan mockups maken (aesth_batch.py) en `docs/pins/**` pushen |
| Oude foto's in Pinterest | versie in de bestandsnaam niet opgehoogd |
| Feed staat stil | kijk of de Action nog draait (groen vinkje elke nacht, `docs/last-build.txt` van vandaag) |

Let op: WebFetch/cache-tools tonen vaak een verouderde versie van de feed —
controleer de live CSV in de browser of op GitHub.
