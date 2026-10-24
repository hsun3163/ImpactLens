#!/usr/bin/env python3
"""Independent read-only verification. Does NOT import/run the extraction producer.
Requires Python 3 and Poppler pdftotext; no network or third-party Python packages.
"""
import csv
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    return json.loads((ROOT / 'data' / name).read_text())
def require(condition, message):
    if not condition:
        raise ValueError(message)
def main():
    rows, sources, evidence = [load(n) for n in ('official_cdcr.json', 'sources.json', 'extraction_evidence.json')]
    require(len(rows) == 38, 'Expected exactly 38 reviewed records')
    require(len({r['id'] for r in rows}) == len(rows), 'Duplicate row IDs')
    require(len({s['id'] for s in sources}) == len(sources) == 2, 'Source IDs are not unique')
    require(len({e['rowId'] for e in evidence}) == len(evidence) == len(rows), 'Evidence is not one-to-one')
    by_source = {s['id']: s for s in sources}
    by_evidence = {e['rowId']: e for e in evidence}
    pages = {}
    for source in sources:
        raw = (ROOT / source['rawFile']).read_bytes()
        require(raw.startswith(b'%PDF'), 'Invalid PDF')
        require(hashlib.sha256(raw).hexdigest() == source['sha256'], 'PDF hash mismatch')
        require(len(raw) == source['bytes'], 'PDF length mismatch')
        require(source['url'].startswith('https://www.cdcr.ca.gov/research/'), 'Unexpected source host')
        pages[source['id']] = subprocess.check_output(['pdftotext', '-layout', str(ROOT / source['rawFile']), '-'], text=True).split('\f')
    # Independent token-position parser anchored to reviewed table/page and exact source labels.
    locations = {'overall': (62, 52, '15'), 'enhanced_credit': (38, 28, '9'), 'supervision': (15, 5, '2'), 'gender': (42, 32, '11'), 'age': (42, 32, '11'), 'program': (3, 3, '1')}
    aliases = {'No enhanced credits': 'No', 'Earned enhanced credits': 'Yes', 'Directly discharged': 'Directly Discharged'}
    for row in rows:
        rid = row['id']
        require(row['sourceId'] in by_source, f'{rid}: unknown source')
        require(row['dataKind'] == 'official' and row['outcome'] == 'conviction' and row['followupMonths'] == 36, f'{rid}: incompatible provenance/outcome/window')
        require(type(row['events']) is int and type(row['denominator']) is int and 0 <= row['events'] <= row['denominator'] and row['denominator'] >= 30, f'{rid}: invalid counts')
        require(abs(100 * row['events'] / row['denominator'] - row['ratePct']) <= .050000001, f'{rid}: published rounding mismatch')
        loc = locations[row['groupType']]
        require((row['sourcePdfPage'], row['sourcePage'], row['sourceTable']) == loc, f'{rid}: page/table mismatch')
        expected_source = 'cdcr-eacp-2020-21' if row['groupType'] == 'program' else 'cdcr-statewide-2020-21'
        require(row['sourceId'] == expected_source, f'{rid}: wrong source association')
        page = pages[row['sourceId']][loc[0] - 1]
        label = row['releaseYear'] if row['groupType'] == 'overall' else aliases.get(row['group'], row['group'])
        if row['groupType'] == 'program':
            label = 'Conviction'
        matches = []
        for line in page.splitlines():
            tokens = line.split()
            words = label.split()
            if tokens[:len(words)] == words:
                tail = tokens[len(words):]
                if tail and re.fullmatch(r'[\d,]+', tail[0]):
                    matches.append((line.strip(), tail))
        require(len(matches) == 1, f'{rid}: source row is missing/ambiguous')
        line, tokens = matches[0]
        if row['groupType'] == 'program':
            offset = 0 if row['group'] == 'MCRP' else 3
            require(row['group'] in ('MCRP', 'FCRP'), f'{rid}: unknown program')
            selected = tokens[offset:offset + 3]
        else:
            selected = [tokens[0], tokens[-2], tokens[-1]]
        observed = (int(selected[0].replace(',', '')), int(selected[1].replace(',', '')), float(selected[2].rstrip('%')))
        require(observed == (row['denominator'], row['events'], row['ratePct']), f'{rid}: PDF values mismatch')
        ev = by_evidence[rid]
        require(ev['sourceId'] == row['sourceId'] and ev['pdfPage'] == loc[0] and ev['rawLine'] == line, f'{rid}: evidence mismatch')
    expected_counts = {'overall': 19, 'enhanced_credit': 2, 'supervision': 3, 'gender': 2, 'age': 10, 'program': 2}
    require(Counter(r['groupType'] for r in rows) == expected_counts, 'Missing or extra classification rows')
    require({r['releaseYear'] for r in rows if r['groupType'] == 'overall'} == {f'{y}-{str(y+1)[-2:]}' for y in range(2002, 2021)}, 'Incomplete or preliminary year included')
    for dimension in ('enhanced_credit', 'supervision', 'gender', 'age'):
        subset = [r for r in rows if r['groupType'] == dimension]
        require(sum(r['denominator'] for r in subset) == 30116 and sum(r['events'] for r in subset) == 11886, f'{dimension}: partition total mismatch')
    with (ROOT / 'data/official_cdcr.csv').open(newline='') as f:
        csv_rows = list(csv.DictReader(f))
    require(csv_rows == [{k: str(v) for k, v in row.items()} for row in rows], 'CSV/JSON mismatch')
    # Read the denominator footnote independently: no arrest/return numerator may join these rows.
    statewide = pages['cdcr-statewide-2020-21']
    require('30,655' in statewide[12] and '30,116' in statewide[12] and 'RAP' in statewide[12], 'Outcome denominator footnote absent')
    print(f'PASS: {len(rows)} rows independently matched to 5 PDF table pages; 2 SHA-256 checks; CSV parity; source/evidence associations; count, rounding, year and within-dimension totals.')

if __name__ == '__main__':
    main()
