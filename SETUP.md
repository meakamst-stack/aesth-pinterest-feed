# Hoe dit is ingericht

Opgezet op 29 sep 2026, beveiliging toegevoegd 3 okt 2026, één regel per design × kleur sinds 4 okt 2026. Staat hier zodat je het kunt terugvinden of opnieuw kunt doen.

| Onderdeel | Instelling |
|---|---|
| Repo | `meakamst-stack/aesth-pinterest-feed`, public (nodig voor gratis GitHub Pages) |
| Secret | `FW_STOREFRONT_TOKEN` — Settings → Secrets and variables → Actions |
| Workflow | `.github/workflows/build-feed.yml`: elke nacht 04:17 UTC, bij push van `build-feed.mjs` / `docs/pins/**` / de workflow, en handmatig via Actions → Run workflow (optie **force**) |
| GitHub Pages | Settings → Pages → branch `main`, map `/docs` |
| Feed-URL | `https://meakamst-stack.github.io/aesth-pinterest-feed/pinterest-feed.csv` |
| Pinterest | business-ID `1104578383515537989`, catalogus `4864991584311`, gegevensbron "AESTH feed (GitHub Pages)" `1552708205363`, land VS, USD, dagelijks 08:00 Amsterdam |
| Node | 22 (Action); lokaal werkt elke Node ≥ 18 |

## Lokale map op de PC

`Projects/site/aesth-pinterest-feed` is een kopie, geen git-clone. Wijzigingen aan
`build-feed.mjs` of de workflow worden door Claude met git gepusht en daarna naar de
PC gekopieerd; de workflow staat lokaal als
`github-workflow (plaats als .github-workflows-build-feed.yml).yml`.
Wil je lokaal met git werken: `git clone https://github.com/meakamst-stack/aesth-pinterest-feed`
en de map vervangen (pins eerst veiligstellen).

## De token vernieuwen

1. Fourthwall → Settings → For Developers → Storefront API → **Create token**
2. GitHub → Settings → Secrets and variables → Actions → `FW_STOREFRONT_TOKEN` → **Update**
3. Actions → *Build Pinterest feed* → **Run workflow** om te controleren

## Pinterest handmatig laten ophalen

Catalogi → Gegevensbronnen → AESTH feed → *Gegevensopname beheren* → *Gegevensopname triggeren*.
**Maximaal 1× per 2 uur**; normaal gewoon de ochtendopname afwachten.

## Controleren of alles draait

- **Actions-tabblad:** elke nacht een groen vinkje; `docs/last-build.txt` heeft de datum van vandaag.
  Rood = open de run; "GEWEIGERD" betekent dat de beveiliging de feed heeft beschermd (zie README).
- **Feed-URL openen:** hoort ±25 regels te tonen (10 designs × kleuren, géén maten), alle foto's op `…/pins/…`.
- **Pinterest → Catalogi → Diagnostiek:** laatste opname hooguit een dag oud, geslaagd = aantal regels, 0 mislukt.
- **Pinterest → Producten:** aantal hoort gelijk te zijn aan het aantal regels in de feed (±25); pins ≈ regels × 4 (±100).

## Mockups (sinds 2 okt 2026, v2 sinds 3 okt)

- `docs/pins/` + `manifest.json` komen uit `AESTH/designs/_algemeen/mockup-basis/aesth_batch.py`
  (`--uit ../../../../aesth-pinterest-feed/docs/pins`). Uitleg: README.md in die map.
- `build-feed.mjs` leest het manifest: hoofdsetting per kleur als `image_link`, de overige settings
  als `additional_image_link`. Fourthwall-foto's gaan nooit mee; een design × kleur zonder mockup
  komt niet in de feed (sinds 4 okt 2026; noodknop `FW_FALLBACK=1`).
- Nieuwe mockups? Nieuwe versie in de bestandsnaam, anders toont Pinterest de oude foto.
