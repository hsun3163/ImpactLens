#!/usr/bin/env python3
"""Reproducible extraction from archived official PDFs; requires pdftotext (Poppler).
Run: python research/extract_cdcr.py
No model, inference of events, or third-party data dependencies.
"""
import csv, hashlib, json, re, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
R=ROOT/'research'; D=ROOT/'data'; D.mkdir(exist_ok=True)
SOURCES=[
 {'id':'cdcr-statewide-2020-21','title':'Statewide Recidivism Report for Individuals Released in Fiscal Year 2020-21','publisher':'California Department of Corrections and Rehabilitation, Office of Research','publicationDate':'2026-06','url':'https://www.cdcr.ca.gov/research/wp-content/uploads/sites/174/2026/06/Statewide-Recidivism-Report-for-Individuals-Released-in-Fiscal-Year-2020-21.pdf','rawFile':'research/statewide_2020_21.pdf','accessDate':'2026-10-24','tables':['Table 15, printed p52 / PDF p62','Table 9, printed p28 / PDF p38','Table 2, printed p5 / PDF p15','Table 11, printed p32 / PDF p42','Table 1, printed p3 / PDF p13']},
 {'id':'cdcr-eacp-2020-21','title':'Supplemental Recidivism Rates for Enhanced Alternative Custody Program Participants Released in Fiscal Year 2020-21','publisher':'California Department of Corrections and Rehabilitation, Office of Research','publicationDate':'2026-09 (URL directory)','url':'https://www.cdcr.ca.gov/research/wp-content/uploads/sites/174/2026/09/Recidivism-Rates-for-EACP-Participants-FY-2020-21.pdf','rawFile':'research/eacp_2020_21.pdf','accessDate':'2026-10-24','tables':['Table 1, printed p3 / PDF p3']}
]
pages={}
for s in SOURCES:
 f=ROOT/s['rawFile']; assert f.read_bytes().startswith(b'%PDF')
 s['sha256']=hashlib.sha256(f.read_bytes()).hexdigest(); s['bytes']=f.stat().st_size
 out=f.with_suffix('.txt');subprocess.run(['pdftotext','-layout',str(f),str(out)],check=True)
 pages[s['id']]=out.read_text().split('\f')
rows=[]; evidence=[]
num=r'([\d,]+)'; pct=r'(\d+\.\d+)%'
def integer(s):return int(s.replace(',',''))
def add(year,typ,group,n,k,rate,src,page,pdfpage,table,months=36,line=''):
 row=dict(id=re.sub('[^a-z0-9]+','-',f'{year}-{typ}-{group}-conviction-{months}'.lower()).strip('-'),releaseYear=year,groupType=typ,group=group,denominator=integer(n),events=integer(k),ratePct=float(rate),outcome='conviction',followupMonths=months,sourceId=src,sourcePage=page,sourcePdfPage=pdfpage,sourceTable=table,dataKind='official')
 assert row['events']<=row['denominator']
 assert abs(row['events']/row['denominator']*100-row['ratePct'])<=0.051, row
 rows.append(row);evidence.append({'rowId':row['id'],'sourceId':src,'pdfPage':pdfpage,'rawLine':line.strip()})
s='cdcr-statewide-2020-21';p=pages[s]
# Table 15: retain complete 36-month cohorts; do not turn preliminary N/A into zero.
pat=re.compile(r'^\s*(20\d\d-\d\d)\s+'+num+r'\s+'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+pct+r'\s*$')
for line in p[61].splitlines():
 m=pat.match(line)
 if m:
  year,n,k1,r1,k2,r2,k3,r3=m.groups()
  add(year,'overall','All releases',n,k3,r3,s,52,62,'15',line=line)
assert len(rows)==19
# Tables 9 and 2: labels followed by denominator and three event/rate pairs.
pat2=re.compile(r'^\s*(.*?)\s{2,}'+num+r'\s+'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+pct+r'\s*$')
for idx,typ,table,labels in [(37,'enhanced_credit','9',{'No':'No enhanced credits','Yes':'Earned enhanced credits'}),(14,'supervision','2',{'Post-Release Community Supervision':'Post-Release Community Supervision','Parole':'Parole','Directly Discharged':'Directly discharged'})]:
 for line in p[idx].splitlines():
  m=pat2.match(line)
  if m and m[1] in labels:
   label,n,k1,r1,k2,r2,k3,r3=m.groups()
   add('2020-21',typ,labels[label],n,k3,r3,s,idx-9,idx+1,table,line=line)
# Table 11 p32: gender and age, denominator, percent of releases, then event/rate pairs.
pat3=re.compile(r'^\s*(.*?)\s{2,}'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+pct+r'\s*$')
for line in p[41].splitlines():
 m=pat3.match(line)
 if m and m[1]!='Total':
  label,n,share,k1,r1,k2,r2,k3,r3=m.groups()
  add('2020-21','gender' if label in ['Male','Female'] else 'age',label,n,k3,r3,s,32,42,'11',line=line)
# EACP Table 1 only conviction row, exact published counts.
s='cdcr-eacp-2020-21'
for line in pages[s][2].splitlines():
 m=re.match(r'^\s*Conviction\s+'+num+r'\s+'+num+r'\s+'+pct+r'\s+'+num+r'\s+'+num+r'\s+'+pct+r'\s*$',line)
 if m:
  n,k,r,n2,k2,r2=m.groups()
  add('2020-21','program','MCRP',n,k,r,s,3,3,'1',line=line)
  add('2020-21','program','FCRP',n2,k2,r2,s,3,3,'1',line=line)
assert len(rows)==38,len(rows)
assert len({x['id'] for x in rows})==len(rows)
assert sum(x['denominator'] for x in rows if x['groupType']=='enhanced_credit')==30116
assert sum(x['events'] for x in rows if x['groupType']=='enhanced_credit')==11886
for name,obj in [('official_cdcr.json',rows),('sources.json',SOURCES),('extraction_evidence.json',evidence)]:
 (D/name).write_text(json.dumps(obj,indent=2)+'\n')
with (D/'official_cdcr.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,lineterminator='\n',fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
print(f'Extracted and validated {len(rows)} official aggregate rows from {len(SOURCES)} archived PDFs.')
