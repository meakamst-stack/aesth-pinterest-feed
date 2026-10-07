#!/usr/bin/env python3
"""Maakt een weekplanning van organische Pinterest-pins (AESTH 2.0).

Leest docs/pinterest-feed.csv, wijst elk design een bord toe en schrijft
pins-week.json: per dag één pin (straat/gym afgewisseld) met titel, tekst,
link (UTM organic) en afbeelding. Gebruik: python3 pins-plan.py <startdatum> [aantal]
"""
import csv, json, sys, datetime, re

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

def bord(slug, naam):
    s = slug
    if any(k in s for k in ["leg-day", "squat", "thick-thighs", "hot-girls-hit-legs"]): return BORDEN["leg"]
    if any(k in s for k in ["pray", "worship", "faith", "soul", "lift-anyway"]): return BORDEN["faith"]
    if any(k in s for k in ["cardio", "crazy", "trainer", "eat-later", "protein-powder", "everything-hurts",
                            "before-picture", "unavailable", "smut", "dumb-people", "creatine", "rest-day"]): return BORDEN["funny"]
    if any(k in s for k in ["girl", "moms", "aunts", "she-", "baddie", "lifting-era", "club"]): return BORDEN["women"]
    if any(k in s for k in ["one-more-rep", "dawn", "therapy", "eat-clean", "eat-your-protein", "books", "coffee"]): return BORDEN["pump"]
    return BORDEN["tees"]

HOOKS = {
    "leg": ["Leg day never looked this good.", "For the ones who never skip leg day.", "Squat, stretch, repeat — in a tee that keeps up."],
    "faith": ["Train your body, keep your faith.", "For the early-morning, pray-first kind of lifter.", "Strength that starts on the inside."],
    "funny": ["Say it on your back so you don’t have to say it out loud.", "A gym tee with a sense of humor.", "For the lifters who take the weights seriously, not themselves."],
    "women": ["Made for women who lift heavy and live loud.", "Your new favorite lifting tee.", "Strong women, bold back prints."],
    "pump": ["The pump cover you’ll wear everywhere.", "Oversized, heavyweight, built for the gym and after.", "Throw it on over your set. Keep it on for coffee."],
    "tees": ["Heavyweight oversized tee with a bold back print.", "The oversized gym tee with something to say.", "Garment-dyed Comfort Colors, cream back print, no logos."],
}

def groep(b):
    return next(k for k, v in BORDEN.items() if v == b)

def main():
    start = datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.date.today() + datetime.timedelta(days=1)
    aantal = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    rows = list(csv.DictReader(open("docs/pinterest-feed.csv", encoding="utf-8")))
    plan = []
    # Volgorde: spreid over borden — eerst één per bord, dan rond.
    perbord = {}
    for r in rows:
        slug_full = r["item_group_id"]; slug = slug_full.replace("-oversized-gym-tee", "")
        naam = r["title"].split(" Oversized")[0]
        b = bord(slug, naam)
        perbord.setdefault(b, []).append((slug, slug_full, naam, b))
    volgorde = []
    keys = list(BORDEN.values())
    i = 0
    while len(volgorde) < len(rows):
        b = keys[i % len(keys)]
        if perbord.get(b): volgorde.append(perbord[b].pop(0))
        i += 1
        if i > 1000: break
    tijden = ["19:30", "12:10", "20:00", "08:40", "18:20", "13:00", "10:30"]
    for n, (slug, slug_full, naam, b) in enumerate(volgorde[:aantal]):
        dag = start + datetime.timedelta(days=n)
        setting = "straat" if n % 2 == 0 else "gym"
        g = groep(b)
        hook = HOOKS[g][n % len(HOOKS[g])]
        titel = f"{naam} Oversized Gym Tee | Pump Cover"
        tekst = (f"{hook} '{naam}' on a heavyweight Comfort Colors tee, cream back print, nothing on the front. "
                 f"Size up 2 for the pump cover look. Free shipping on 2+ tees.")
        link = f"{SITE}{slug_full}?utm_source=pinterest&utm_medium=organic&utm_campaign=pins-week&utm_content={slug}-{setting}"
        plan.append({
            "datum": f"{dag.isoformat()}T{tijden[n % 7]}:00",
            "bord": b, "slug": slug, "titel": titel[:100], "tekst": tekst[:500], "link": link,
            "afbeelding": f"{BASE}{slug}/{slug}-pepper-{setting}-v1.jpg",
        })
    json.dump(plan, open("pins-week.json", "w"), indent=1, ensure_ascii=False)
    for p in plan: print(p["datum"], "|", p["bord"], "|", p["titel"])

if __name__ == "__main__":
    main()
