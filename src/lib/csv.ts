import type { AggregateRow, ValidationResult } from './types';

export const MAX_CSV_BYTES = 1_048_576;
export const MAX_CSV_ROWS = 5_000;
export const REQUIRED_CSV_COLUMNS = ['id', 'releaseYear', 'groupType', 'group', 'denominator', 'events', 'outcome', 'followupMonths', 'sourceId', 'sourcePage'] as const;
export const OPTIONAL_CSV_COLUMNS = ['dataKind', 'program', 'missingOutcomes'] as const;
const allowed = new Set<string>([...REQUIRED_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS]);
const numeric = new Set(['denominator', 'events', 'followupMonths', 'missingOutcomes']);
const identifier = /^(name|firstname|lastname|fullname|email|emailaddress|phone|phonenumber|address|streetaddress|ssn|socialsecuritynumber|dob|dateofbirth|birthdate|inmateid|personid|participantid|cdcrnumber|cdcnumber|patientid|casenumber|zipcode|postalcode)$/;

/** Strict RFC-4180-style CSV reader supporting quoted commas, newlines and doubled quotes. */
function readCells(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => { finishCell(); if (row.some(value => value.trim() !== '')) records.push(row); row = []; if (records.length > MAX_CSV_ROWS + 1) throw new Error(`CSV exceeds ${MAX_CSV_ROWS} data rows.`); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += c;
    } else if (c === ',') finishCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    else if (c === '"') {
      if (cell.length !== 0 || closed) throw new Error('Malformed CSV: unexpected quote in an unquoted field.');
      quoted = true;
    } else {
      if (closed) throw new Error('Malformed CSV: unexpected text after a closing quote.');
      cell += c;
    }
  }
  if (quoted) throw new Error('Malformed CSV: unclosed quoted field.');
  if (cell !== '' || row.length || closed) finishRow();
  return records;
}

/** Validate runtime objects, including trusted bundled data. Rejects an entire batch on error. */
export function validateAggregateRows(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(input)) return { rows: [], errors: ['Expected an array of aggregate rows.'], warnings };
  if (!input.length) errors.push('At least one aggregate row is required.');
  if (input.length > MAX_CSV_ROWS) errors.push(`At most ${MAX_CSV_ROWS} aggregate rows are permitted.`);
  const ids = new Set<string>();
  input.forEach((value, index) => {
    const label = `Row ${index + 2}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${label}: expected an aggregate record.`); return; }
    const row = value as Record<string, unknown>;
    Object.keys(row).forEach(key => { if (!allowed.has(key)) errors.push(`${label}: unknown column "${key}" is not permitted.`); });
    REQUIRED_CSV_COLUMNS.filter(key => !numeric.has(key)).forEach(key => {
      if (typeof row[key] !== 'string' || !(row[key] as string).trim()) errors.push(`${label}: ${key} must be a nonempty text label.`);
      else if ((row[key] as string).length > 500) errors.push(`${label}: ${key} exceeds 500 characters.`);
    });
    if (typeof row.id === 'string') { if (ids.has(row.id.trim())) errors.push(`${label}: duplicate id "${row.id}".`); ids.add(row.id.trim()); }
    if (!Number.isSafeInteger(row.denominator) || (row.denominator as number) <= 0) errors.push(`${label}: denominator must be a positive safe integer.`);
    if (!Number.isSafeInteger(row.events) || (row.events as number) < 0 || (row.events as number) > (row.denominator as number)) errors.push(`${label}: events must be an integer between zero and denominator.`);
    if (!Number.isSafeInteger(row.followupMonths) || (row.followupMonths as number) < 1) errors.push(`${label}: followupMonths must be a positive safe integer.`);
    if (row.missingOutcomes !== undefined && (!Number.isSafeInteger(row.missingOutcomes) || (row.missingOutcomes as number) < 0)) errors.push(`${label}: missingOutcomes must be a nonnegative safe integer.`);
    if (!['official', 'synthetic', 'uploaded'].includes(row.dataKind as string)) errors.push(`${label}: dataKind must be official, synthetic, or uploaded.`);
    if (row.program !== undefined && (typeof row.program !== 'string' || !row.program.trim() || row.program.length > 500)) errors.push(`${label}: program must be nonempty text of at most 500 characters.`);
  });
  if (input.some(row => row && typeof row === 'object' && row.missingOutcomes === undefined)) warnings.push('Some rows omit missingOutcomes; outcome completeness is unknown. Missing is not assumed to mean zero.');
  warnings.push('Aggregate-only schema validation cannot detect personal information embedded in free-text labels. Upload only public or authorized, appropriately aggregated, non-identifying data.');
  return { rows: errors.length ? [] : input as AggregateRow[], errors, warnings };
}

export function parseAggregateCsv(text: string): ValidationResult {
  const fail = (error: string): ValidationResult => ({ rows: [], errors: [error], warnings: [] });
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) return fail('CSV exceeds the 1 MiB upload limit.');
  let cells: string[][];
  try { cells = readCells(text.replace(/^\uFEFF/, '')); } catch (error) { return fail((error as Error).message); }
  if (cells.length < 2) return fail('CSV requires a header and at least one aggregate data row.');
  const headers = cells[0].map(value => value.trim());
  if (new Set(headers).size !== headers.length) return fail('CSV contains duplicate header names.');
  const personal = headers.filter(header => identifier.test(header.toLowerCase().replace(/[^a-z0-9]/g, '')));
  if (personal.length) return fail(`Personal-identifier columns are forbidden: ${personal.join(', ')}. Use aggregate data only.`);
  const unknown = headers.filter(header => !allowed.has(header));
  if (unknown.length) return fail(`Unknown columns are not allowed: ${unknown.join(', ')}. Use the documented aggregate schema.`);
  const missing = REQUIRED_CSV_COLUMNS.filter(header => !headers.includes(header));
  if (missing.length) return fail(`Missing required columns: ${missing.join(', ')}.`);
  const errors: string[] = [];
  const rows = cells.slice(1).map((values, index) => {
    if (values.length !== headers.length) errors.push(`Row ${index + 2}: expected ${headers.length} fields, found ${values.length}.`);
    const row: Record<string, unknown> = {};
    headers.forEach((header, position) => {
      const value = (values[position] ?? '').trim();
      if ((header === 'missingOutcomes' || header === 'program') && value === '') return;
      // Explicit decimal syntax avoids accepting whitespace, hex, Infinity or NaN as counts.
      row[header] = numeric.has(header) ? (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : NaN) : value;
    });
    // Preserve a declared fake-data warning; never trust a claim of official provenance.
    row.dataKind = row.dataKind === 'synthetic' ? 'synthetic' : 'uploaded';
    return row;
  });
  const result = validateAggregateRows(rows);
  errors.push(...result.errors);
  return { rows: errors.length ? [] : result.rows, errors, warnings: ['Explicit synthetic labels are retained as demonstration warnings, not verification; all other supplied data kinds are labeled uploaded and are not independently verified.', ...result.warnings] };
}

/** Quote and neutralize spreadsheet formulas, including prefixes hidden behind whitespace. */
export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function aggregateRowsToCsv(rows: AggregateRow[]): string {
  const headers = [...REQUIRED_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS];
  return [headers.map(escapeCsvCell).join(','), ...rows.map(row => headers.map(header => escapeCsvCell(row[header])).join(','))].join('\r\n');
}
