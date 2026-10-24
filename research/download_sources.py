#!/usr/bin/env python3
"""Optional explicit acquisition step. Requires curl. Never overwrite archived PDFs.
Uses data/sources.json and verifies its recorded SHA-256. Run only to restore missing
raw source files. A changed upstream PDF fails verification instead of silently
changing the evidence underlying the application.
"""
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
for source in json.loads((ROOT/'data/sources.json').read_text()):
 dest=ROOT/source['rawFile']
 if not dest.exists():
  dest.parent.mkdir(parents=True,exist_ok=True)
  subprocess.run(['curl','--fail','--location','--silent','--show-error',source['url'],'--output',str(dest)],check=True)
 digest=hashlib.sha256(dest.read_bytes()).hexdigest()
 if digest != source['sha256']:
  raise SystemExit(f"SHA-256 mismatch for {source['id']}; stop and inspect upstream version.")
 print(f"Verified {source['id']}: {digest}")
