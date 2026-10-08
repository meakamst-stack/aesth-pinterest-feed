#!/usr/bin/env python3
"""Maakt een weekplanning van organische Pinterest-pins (AESTH 2.0, versie 2 — 8 okt 2026).

Opzet na het content-onderzoek van 8 okt (onderzoek/2026-10-08-content-tshirts-pinterest-instagram.md):
- idee-titels (wat vrouwen zoeken: "gym outfit", "oversized tee outfit", "leg day") in plaats van producttitels;
- mix per week van 7: 5 outfit-/inspiratiepins, 1 uitlegpin (size-up of flatlay), 1 productpin (studio of quote);
- negen beeldtypes per design (docs/pins/<slug>/<slug>-pepper-<setting>-v1.jpg).

Leest docs/pinterest-feed.csv, wijst elk design een bord toe en schrijft pins-week.json met per dag één pin:
titel (<=100, eerste 40 tekens tellen), tekst (<=500), link (UTM organic) en afbeelding.
Gebruik: python3 pins-plan.py <startdatum> [aantal dagen] [weeknummer-offset]
"""
import csv, json, sys, datetime

BASE = "https://meakamst-stack.github.io/aesth-pinterest-feed/pins/"
SITE = "https://aesthwear.com/products/"

BORDEN = {
    "leg": "Leg Day Fits",
    "faith": "Faith and Fitness Tees",
    "funny": "Funny Gym Shirts",
    "women": "Gym Outfit Ideas for Women",
    "pump": "Pump Cover Outfits",
    "tees": "Oversized Gym Tees",
}

def bord(slug):
    s = slug
    if any(k in s for k in ["leg-day", "squat", "thick-thighs", "hot-girls-hit-legs"]): return BORDEN["leg"]
    if any(k in s for k in ["pray", "worship", "faith", "soul", "lift-anyway"]): return BORDEN["faith"]
    if any(k in s for k in ["cardio", "crazy", "trainer", "eat-later", "protein-powder", "everything-hurts",
                            "before-picture", "unavailable", "smut", "dumb-people", "creatine", "rest-day"]): return BORDEN["funny"]
    if any(k in s for k in ["girl", "moms", "aunts", "she-", "baddie", "lifting-era", "club"]): return BORDEN["women"]
    if any(k in s for k in ["one-more-rep", "dawn", "therapy", "eat-clean", "eat-your-protein", "books", "coffee"]): return BORDEN["pump"]
    return BORDEN["tees"]

def groep(b):
    return next(k for k, v in BORDEN.items() if v == b)

# Beeldtypes: (setting, soort, idee-titel, eerste zin). {naam} = designnaam.
# soort: outfit (inspiratie), uitleg, product.
TYPES = [
    ("bed",      "outfit",  "Rest Day Outfit Idea: Oversized Tee + Jeans",            "The rest-day uniform: a heavyweight oversized tee that says '{naam}' on the back."),
    ("zebrapad", "outfit",  "Oversized Gym Tee Outfit for Errands After the Gym",     "Gym to errands without changing: '{naam}' on the back, nothing on the front."),
    ("vlonder",  "outfit",  "Oversized Tee Outfit for Beach Evenings",                "Throw it on after the workout and keep it on till sunset. '{naam}' back print."),
    ("gym2",     "outfit",  "Gym Fit Idea: Oversized Tee + Biker Shorts",              "The easy gym fit: oversized tee, biker shorts, back print that does the talking. '{naam}'."),
    ("terras",   "outfit",  "Coffee After the Gym Outfit: Oversized Tee + Denim",     "Post-workout coffee fit. '{naam}' on the back of a garment-dyed Comfort Colors tee."),
    ("straat2",  "outfit",  "Streetwear Gym Outfit: Oversized Back Print Tee",        "Street-ready gym tee: '{naam}' across the back, blank front, heavyweight cotton."),
    ("straat",   "outfit",  "Oversized Gym Tee Outfit Idea for Women",                "'{naam}' on the back of a heavyweight oversized tee. Wear it to the gym and everywhere after."),
    ("gym",      "outfit",  "Leg Day Outfit: Oversized Pump Cover Tee",               "Pump cover first, reveal later. '{naam}' back print on a Comfort Colors 1717."),
    ("flatlay",  "uitleg",  "Size Up 2 for the Pump Cover Look | Back Print Gym Tee", "Blank front, print on the back. Your size = regular fit; two sizes up = the oversized pump cover look. '{naam}'."),
    ("studio",   "product", "{naam} Oversized Gym Tee — Back Print Only",             "'{naam}' printed on the back of a heavyweight garment-dyed Comfort Colors 1717 tee in Pepper. Nothing on the front."),
    ("quote",    "product", "{naam} — Funny Gym Shirt Quote",                         "The back print says it so you don't have to: '{naam}'. Heavyweight oversized tee, cream print on Pepper."),
]
# Vaste uitlegpin (geen design): size-up gids
SIZEUP = dict(bord=BORDEN["pump"], titel="Size Up for the Pump Cover Look | Oversized Gym Tee Fit Guide",
              tekst="Same tee, four looks. Comfort Colors 1717 is unisex and true to size: your usual size = regular fit, one up = relaxed, two up = oversized pump cover. Size chart in cm included. Save for your next order.",
              link="https://aesthwear.com/?utm_source=pinterest&utm_medium=organic&utm_campaign=pins-week&utm_content=sizeup",
              afbeelding="https://meakamst-stack.github.io/aesth-pinterest-feed/pins/_uitleg/pin-sizeup.jpg")

# Bord-specifieke trefwoordzin (voor de beschrijving) en CTA
BORDZIN = {
    "leg": "Leg day fit for women who never skip it.",
    "faith": "Faith and fitness tee for the pray-first kind of lifter.",
    "funny": "Funny gym shirt with a sense of humor.",
    "women": "Gym outfit idea for women who lift heavy.",
    "pump": "Pump cover outfit you'll wear outside the gym too.",
    "tees": "Oversized gym tee with a bold back print.",
}
CTA = "Save this gym outfit idea · free shipping on 2+ tees at aesthwear.com"

# Weekritme: 5 outfit, 1 uitleg, 1 product. Outfit-settings rouleren per week zodat een design niet twee keer
# hetzelfde beeld krijgt binnen een paar weken.
RITME = ["outfit", "outfit", "uitleg", "outfit", "outfit", "product", "outfit"]
TIJDEN = ["19:30", "12:10", "20:00", "08:40", "18:20", "13:00", "10:30"]

def main():
    start = datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.date.today() + datetime.timedelta(days=1)
    aantal = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    week = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    rows = list(csv.DictReader(open("docs/pinterest-feed.csv", encoding="utf-8")))
    perbord = {}
    for r in rows:
        slug_full = r["item_group_id"]; slug = slug_full.replace("-oversized-gym-tee", "")
        naam = r["title"].split(" Oversized")[0]
        perbord.setdefault(bord(slug), []).append((slug, slug_full, naam))
    volgorde = []
    keys = list(BORDEN.values()); i = 0
    while len(volgorde) < len(rows) and i < 1000:
        b = keys[i % len(keys)]
        if perbord.get(b): volgorde.append(perbord[b].pop(0) + (b,))
        i += 1
    # schuif per week door de designs zodat week 2 andere designs krijgt
    volgorde = volgorde[(week * aantal) % len(volgorde):] + volgorde[:(week * aantal) % len(volgorde)]
    outfits = [t for t in TYPES if t[1] == "outfit"]
    uitleg = [t for t in TYPES if t[1] == "uitleg"]
    product = [t for t in TYPES if t[1] == "product"]
    plan = []; n_out = week * 5; n_prod = week
    for n in range(aantal):
        dag = start + datetime.timedelta(days=n)
        soort = RITME[n % 7]
        if soort == "uitleg" and (week + n // 7) % 2 == 0:
            p = dict(SIZEUP); p["datum"] = f"{dag.isoformat()}T{TIJDEN[n % 7]}:00"; p["slug"] = "sizeup"; plan.append(p); continue
        slug, slug_full, naam, b = volgorde[n % len(volgorde)]
        g = groep(b)
        if soort == "outfit": t = outfits[n_out % len(outfits)]; n_out += 1
        elif soort == "uitleg": t = uitleg[0]
        else: t = product[n_prod % len(product)]; n_prod += 1
        setting, _, idee, zin = t
        titel = idee.format(naam=naam)
        if "{naam}" not in idee: titel = f"{titel} | {naam}"
        tekst = f"{zin.format(naam=naam)} {BORDZIN[g]} Garment-dyed Comfort Colors 1717, cream back print, no logos. {CTA}"
        link = f"{SITE}{slug_full}?utm_source=pinterest&utm_medium=organic&utm_campaign=pins-week&utm_content={slug}-{setting}"
        plan.append({
            "datum": f"{dag.isoformat()}T{TIJDEN[n % 7]}:00",
            "bord": b, "slug": slug, "soort": soort, "setting": setting,
            "titel": titel[:100], "tekst": tekst[:500], "link": link,
            "afbeelding": f"{BASE}{slug}/{slug}-pepper-{setting}-v1.jpg",
        })
    json.dump(plan, open("pins-week.json", "w"), indent=1, ensure_ascii=False)
    for p in plan: print(p["datum"], "|", p["bord"], "|", p.get("setting", "sizeup"), "|", p["titel"])

if __name__ == "__main__":
    main()
