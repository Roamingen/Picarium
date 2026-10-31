import json, io, os, shutil

LIB = r"C:\Users\13066\StickerBox"
idx = os.path.join(LIB, "index.json")
data = json.load(io.open(idx, encoding="utf-8"))
shutil.copy(idx, idx + ".bak")

keep, drop = [], []
for a in data["assets"]:
    src = (a.get("source") or "").replace("/", "\\")
    if "\\bqb\\sample\\" in src:
        drop.append(a)
    else:
        keep.append(a)

trash = os.path.join(LIB, "trash")
os.makedirs(trash, exist_ok=True)
for a in drop:
    p = a.get("path") or ""
    if p and os.path.exists(p):
        shutil.move(p, os.path.join(trash, os.path.basename(p)))

data["assets"] = keep
io.open(idx, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=2))
print("removed", len(drop), "kept", len(keep))
for a in keep:
    print(" -", a["name"])
