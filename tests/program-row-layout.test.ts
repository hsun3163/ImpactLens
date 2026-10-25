import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const component=readFileSync('src/components/CourseMaintenance.tsx','utf8');
const css=readFileSync('src/app/courses/courses.css','utf8');
test('Save program uses full-width rows while keeping native labels and validation',()=>{
 assert.match(component,/cm-editor cm-row-editor/);
 assert.match(css,/\.cm-row-editor \.cm-inline-program,\.cm-row-editor \.cm-field-grid\{display:flex;flex-direction:column/);
 assert.match(css,/grid-template-columns:minmax\(190px,\.38fr\) minmax\(0,1fr\)/);
 assert.match(component,/htmlFor="cm-facility"/);assert.match(component,/id="cm-facility"/);
 assert.match(component,/aria-invalid=\{invalidFields.includes\('completers'\)/);
 assert.match(component,/onSubmit=\{saveCourse\}/);assert.match(component,/Save program/);
});
test('saved programs are full-width records with grouped identity, values and actions',()=>{
 assert.match(component,/cm-course-grid cm-history-rows/);
 assert.match(component,/cm-course-identity/);assert.match(component,/cm-course-controls/);
 assert.match(css,/\.cm-shell \.cm-history-rows\{display:flex;flex-direction:column/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\);gap:18px/);
});
