# Hoe dit is ingericht

Opgezet op 29 sep 2026. Staat hier zodat je het kunt terugvinden of opnieuw kunt doen.

| Onderdeel | Instelling |
|---|---|
| Repo | `meakamst-stack/aesth-pinterest-feed`, public (nodig voor gratis GitHub Pages) |
| Secret | `FW_STOREFRONT_TOKEN` — Settings → Secrets and variables → Actions |
| Workflow | `.github/workflows/build-feed.yml`, elke nacht 04:17 UTC + handmatig via Actions → Run workflow |
| GitHub Pages | Settings → Pages → branch `main`, map `/docs` |
| Feed-URL | `https://meakamst-stack.github.io/aesth-pinterest-feed/pinterest-feed.csv` |
| Pinterest | Ads → Catalogs → Data sources → bron met bovenstaande URL, land VS, valuta USD |

## De token vernieuwen

Nieuwe token nodig (bijvoorbeeld omdat de oude is ingetrokken)?

1. Fourthwall → Settings → For Developers → Storefront API → **Create token**
2. GitHub → Settings → Secrets and variables → Actions → `FW_STOREFRONT_TOKEN` → **Update**
3. Actions → *Build Pinterest feed* → **Run workflow** om te controleren

## Controleren of alles draait

- **Actions-tabblad:** elke nacht een groen vinkje. Rood = open de run, de foutmelding zegt wat er mis is.
- **Feed-URL openen:** hoort ruim 100 regels te tonen, één per kleur/maat.
- **Pinterest → Catalogs → Data sources:** laatste verwerking hoort hooguit een dag oud te zijn.

## Eigen mockups als catalogusfoto (sinds 2 okt 2026)

- `docs/pins/` bevat de Pinterest-mockups (1000×1500) en `manifest.json`. Gemaakt met
  `AESTH/designs/_algemeen/mockup-basis/aesth_batch.py` (configuratie: `designs.json` daarnaast).
- `build-feed.mjs` gebruikt per product + kleur de gym-mockup als `image_link`, straat en studio
  vooraan in `additional_image_link`, daarna de Fourthwall-foto's. Geen mockup → alleen Fourthwall-foto's.
- Nieuwe mockups? Altijd een nieuwe versie in de bestandsnaam (`-v2`), anders toont Pinterest de oude foto.
- Na uploaden: Actions → *Build Pinterest feed* → **Run workflow** (of wachten tot de nachtrun).
