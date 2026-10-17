# language: Python, file: gen_manifest.py, runtime: Python 3.8+
import hashlib, os, base64, gzip

FILES = "data/files"
MANIFEST = "data/manifest.csv"

def b64sha1(b):
    return base64.b64encode(hashlib.sha1(b).digest()).decode()

lines = []
for root, _, fs in os.walk(FILES):
    for fn in sorted(fs):
        full = os.path.join(root, fn)
        rel = os.path.relpath(full, FILES).replace("\\", "/")
        comp = open(full, "rb").read()
        try:
            orig = gzip.decompress(comp)
        except Exception:
            orig = comp
        lines.append(f"{rel},{b64sha1(orig)},{len(orig)},0,{b64sha1(comp)},{len(comp)},True,0")

open(MANIFEST, "w").write("\n".join(lines) + ("\n" if lines else ""))
print(f"wrote {len(lines)} entries")
for l in lines: print("  " + l)
