# AESTH — Pinterest productfeed

Dit kleine project houdt één bestand actueel: `docs/pinterest-feed.csv`, de
productfeed die Pinterest elke 24 uur ophaalt om je shop als catalogus te tonen.

Je hoeft er normaal gesproken niets aan te doen. Voeg je een design toe aan
Fourthwall, dan staat het de volgende ochtend vanzelf in de feed.

## Hoe het werkt

1. Een GitHub Action draait elke nacht `build-feed.mjs`.
2. Dat script haalt alle **publieke** producten op uit de Fourthwall Storefront API.
3. Het schrijft één CSV-regel per variant (kleur × maat) naar `docs/pinterest-feed.csv`.
4. GitHub Pages serveert dat bestand op een vaste URL.
5. Pinterest haalt die URL elke 24 uur op.

Varianten van hetzelfde design krijgen dezelfde `item_group_id`, zodat Pinterest
er één product-Pin van maakt in plaats van vijftien losse.

## Eenmalige instellingen

| Wat | Waar |
|---|---|
| Secret `FW_STOREFRONT_TOKEN` | Settings → Secrets and variables → Actions → New repository secret |
| GitHub Pages | Settings → Pages → Source: *Deploy from a branch* → branch `main`, map `/docs` |
| Feed-URL in Pinterest | Ads → Catalogs → Data sources → nieuwe bron met de Pages-URL |

De storefront-token is read-only en alleen bedoeld voor publieke productdata —
Fourthwall verwacht dat die in openbare storefront-code staat. Hij staat hier
toch in een secret, zodat hij niet in de commit-historie belandt.

## Zelf draaien

```bash
FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs
```

Handmatig laten draaien op GitHub kan ook: tabblad **Actions** → *Build Pinterest
feed* → **Run workflow**.

## Wat er in de feed staat

Verplicht volgens Pinterest: `id`, `title`, `description`, `link`, `image_link`,
`price`, `availability`, `condition`, `brand`, `google_product_category`.
Daarnaast `item_group_id` (groepeert varianten), `color`, `size`, `gender`,
`age_group` en extra afbeeldingen.

Twee eigen labels maken targeting in Pinterest makkelijker:

- `custom_label_0` = de design-slug → hiermee maak je een advertentiegroep per design
- `custom_label_1` = de kleur

Elke link krijgt UTM's mee: `utm_medium=catalog`. Zo blijven in Fourthwalls
*Sales by UTM*-rapport drie bronnen uit elkaar te houden:

| `utm_medium` | Betekenis |
|---|---|
| `organic` | handmatig geplaatste pins |
| `catalog` | shopbare product-Pins uit deze feed (gratis én catalogus-ads) |
| `paid` | promoted pins die je zelf achter een bestaande pin zet |

## Wat het script bewust overslaat

- Producten die niet `PUBLIC` zijn
- Bundels (die hebben geen varianten en vallen buiten de designtest)
- Varianten zonder afbeelding of zonder prijs — die zou Pinterest toch afkeuren

Het script stopt met een foutmelding als er nul producten uitkomen of als er
dubbele `id`'s zijn, in plaats van een kapotte feed te publiceren.

## Als er iets misgaat

| Symptoom | Waarschijnlijke oorzaak |
|---|---|
| Action faalt op "Storefront API gaf 401" | token verlopen of secret verkeerd gespeld |
| Pinterest meldt "0 producten" | Pages staat nog niet aan, of wijst naar de verkeerde map |
| Pinterest keurt regels af | check de melding per regel in Catalogs → Data sources → Issues |
| Feed staat stil | Pinterest stopt organische distributie na 7 dagen zonder update en ads na 90 dagen — kijk of de Action nog draait |
