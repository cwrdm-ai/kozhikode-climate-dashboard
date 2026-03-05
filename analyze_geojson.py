import json

with open('kozhikode_panchayats.geojson', 'r', encoding='utf-8') as f:
    data = json.load(f)

features = data['features']

all_keys = set()
for feat in features:
    all_keys.update(feat['properties'].keys())

geom_types = {}
for feat in features:
    gt = feat['geometry']['type']
    geom_types[gt] = geom_types.get(gt, 0) + 1

levels = {}
for feat in features:
    lv = feat['properties'].get('admin_level', 'N/A')
    levels[lv] = levels.get(lv, 0) + 1

la = {}
for feat in features:
    v = feat['properties'].get('local_authority:IN', 'N/A')
    la[v] = la.get(v, 0) + 1

bd = {}
for feat in features:
    v = feat['properties'].get('boundary', 'N/A')
    bd[v] = bd.get(v, 0) + 1

names = []
for feat in features:
    n = feat['properties'].get('name', '?')
    la_type = feat['properties'].get('local_authority:IN', feat['properties'].get('admin_level','?'))
    names.append((la_type, n))
names.sort()

result = []
result.append(f"Total features: {len(features)}")
result.append(f"Generator: {data.get('generator')}")
result.append(f"Timestamp: {data.get('timestamp')}")
result.append("")
result.append("All property keys:")
for k in sorted(all_keys):
    count = sum(1 for f in features if k in f['properties'])
    result.append(f"  - {k}  ({count}/{len(features)} features)")
result.append("")
result.append("Geometry types: " + str(geom_types))
result.append("")
result.append("admin_level distribution:")
for k,v in sorted(levels.items()):
    result.append(f"  level {k}: {v} features")
result.append("")
result.append("local_authority:IN distribution:")
for k,v in sorted(la.items()):
    result.append(f"  {k}: {v}")
result.append("")
result.append("boundary tag distribution:")
for k,v in sorted(bd.items()):
    result.append(f"  {k}: {v}")
result.append("")
result.append("All feature names:")
for la_type, n in names:
    result.append(f"  [{la_type}] {n}")

output = "\n".join(result)
with open('geojson_analysis.txt', 'w', encoding='utf-8') as out:
    out.write(output)

print("Done")
