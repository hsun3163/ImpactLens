"""Project audited source records to the browser aggregate-only contract."""
import csv, json
from pathlib import Path
R=Path(__file__).resolve().parents[1]
P=R/'public/data'; P.mkdir(parents=True,exist_ok=True)
fields=['id','releaseYear','groupType','group','denominator','events','outcome','followupMonths','sourceId','sourcePage','dataKind']
raw=json.loads((R/'data/official_cdcr.json').read_text())
rows=[]
for row in raw:
 x={k:row[k] for k in fields}
 x['sourcePage']=f"Printed p. {row['sourcePage']}; PDF p. {row['sourcePdfPage']}; Table {row['sourceTable']}"
 # RAP-sheet exclusions are documented only for the whole release population.
 if row['releaseYear']=='2020-21' and row['groupType']=='overall' and row['outcome'] in ['conviction','arrest']:
  x['missingOutcomes']=539
 rows.append(x)
(P/'official.json').write_text(json.dumps(rows,indent=2)+'\n')
(P/'sources.json').write_text((R/'data/sources.json').read_text())
(P/'data_dictionary.md').write_text((R/'data/data_dictionary.md').read_text())
with (P/'official.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields+['missingOutcomes']);w.writeheader();w.writerows(rows)
demo=[]
for year,n,a,b in [('2021-22',120,32,44),('2022-23',150,35,48),('2023-24',140,31,42)]:
 for program,k in [('Example Pathways',a),('Example Community',b)]:
  demo.append(dict(id=f"synthetic-{year}-{program.split()[-1]}",releaseYear=year,groupType='fictional_program',group=program,denominator=n,events=k,outcome='conviction',followupMonths=12,sourceId='synthetic-demo',sourcePage='Generated fixture; not a real organization',dataKind='synthetic',program=program,missingOutcomes=10))
(P/'demo.json').write_text(json.dumps(demo,indent=2)+'\n')
with (P/'demo.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields+['program','missingOutcomes']);w.writeheader();w.writerows(demo)
print(f'Prepared {len(rows)} official rows and {len(demo)} labeled synthetic rows.')
