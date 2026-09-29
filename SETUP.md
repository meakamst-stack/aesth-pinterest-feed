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
