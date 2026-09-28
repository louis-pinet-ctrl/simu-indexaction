#!/usr/bin/env python3
"""Regenere indices.js a partir de trois fichiers JSON {"AAAA-Tq": valeur} (ilc.json, ilat.json, icc.json).
Usage : python3 tools/build_indices.py <dossier_json> <date_maj AAAA-MM-JJ>"""
import json, sys, os
d, maj = sys.argv[1], sys.argv[2]
out = ["// Indices INSEE par trimestre. Source : avis publies au Journal officiel (Legifrance).",
       "// ILC et ILAT : base 100 (ILC au T1 2008, ILAT au T1 2010). ICC : base 100 au T4 1953.",
       "// Genere par tools/build_indices.py. Ajouter chaque trimestre la nouvelle valeur, puis relancer les tests.",
       "window.INDICES={maj:'%s'," % maj]
for nom in ("ILC", "ILAT", "ICC"):
    s = json.load(open(os.path.join(d, nom.lower() + ".json"), encoding="utf-8"))
    cles = sorted((k for k, v in s.items() if v is not None), key=lambda k: (int(k[:4]), int(k[-1])))
    fmt = (lambda v: str(int(v))) if nom == "ICC" else (lambda v: "%.2f" % v)
    out.append("%s:{%s}," % (nom, ",".join("'%s':%s" % (k, fmt(s[k])) for k in cles)))
out.append("};")
open("indices.js", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("indices.js ecrit")
