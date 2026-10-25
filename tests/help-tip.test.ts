import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import HelpTip from '../src/components/HelpTip';
import { helpTipOpen, helpTipPosition, helpTipReducer, initialHelpTipState } from '../src/lib/help-tip';

const read = (path: string) => readFileSync(path, 'utf8');
const screens = ['CourseMaintenance', 'SmsDemo', 'SmsAdmin', 'SmsDashboard', 'CourseAttendance'];

test('help previews on hover or keyboard focus and remains open while either is active', () => {
  assert.equal(helpTipOpen(initialHelpTipState), false);
  let state = helpTipReducer(initialHelpTipState, 'hover'); assert.equal(helpTipOpen(state), true);
  state = helpTipReducer(state, 'focus'); state = helpTipReducer(state, 'leave'); assert.equal(helpTipOpen(state), true);
  state = helpTipReducer(state, 'blur'); assert.equal(helpTipOpen(state), false);
  assert.deepEqual(initialHelpTipState, { hovered: false, focused: false, pinned: false, dismissed: false });
});
test('tap toggles persistent help without depending on hover or a browser title tooltip', () => {
  let state = helpTipReducer(initialHelpTipState, 'toggle'); assert.equal(helpTipOpen(state), true); assert.equal(state.pinned, true);
  state = helpTipReducer(state, 'leave'); assert.equal(helpTipOpen(state), true);
  state = helpTipReducer(state, 'toggle'); assert.equal(helpTipOpen(state), false);
  state = helpTipReducer(state, 'toggle'); assert.equal(helpTipOpen(state), true);
  state = helpTipReducer(state, 'blur'); assert.equal(helpTipOpen(state), false);
});
test('Escape and outside dismissal close pinned or focused help until a fresh interaction', () => {
  let state = helpTipReducer(helpTipReducer(initialHelpTipState, 'focus'), 'toggle');
  state = helpTipReducer(state, 'dismiss'); assert.equal(helpTipOpen(state), false); assert.equal(state.pinned, false);
  // Focus remaining on the button must not immediately reopen a dismissed tip.
  assert.equal(state.focused, true); assert.equal(helpTipOpen(state), false);
  state = helpTipReducer(state, 'blur'); state = helpTipReducer(state, 'focus'); assert.equal(helpTipOpen(state), true);
  state = helpTipReducer(state, 'dismiss'); state = helpTipReducer(state, 'hover'); assert.equal(helpTipOpen(state), true);
});
test('help panel positioning respects viewport edges and flips above near the bottom', () => {
  assert.deepEqual(helpTipPosition({ left: 0, right: 20, top: 50, bottom: 70 }, { width: 640, height: 480 }, { width: 304, height: 120 }), { left: 12, top: 78 });
  assert.deepEqual(helpTipPosition({ left: 600, right: 620, top: 430, bottom: 450 }, { width: 640, height: 480 }, { width: 304, height: 120 }), { left: 324, top: 302 });
  const small = helpTipPosition({ left: 140, right: 176, top: 10, bottom: 46 }, { width: 320, height: 240 }, { width: 296, height: 216 });
  assert.equal(small.left, 12); assert.equal(small.top, 12);
});
test('help triggers have descriptive accessible names, unique associations and never submit forms', () => {
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(HelpTip, { label: 'Course hours', text: 'Whole-course teaching time.' }),
    createElement(HelpTip, { label: 'Course hours', text: 'Another explanation.' })));
  assert.equal((html.match(/type="button"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-label="Help: Course hours"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  const associations = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(associations).size, 2);
  assert.doesNotMatch(html, /Whole-course teaching time|Another explanation| title=/);
});
test('help implementation supports touch, keyboard, outside dismissal, hoverable content and unclipped panels', () => {
  const source = read('src/components/HelpTip.tsx');
  assert.match(source, /onPointerEnter=.*pointerType !== 'touch'/);
  assert.match(source, /onFocus=.*dispatch\('focus'\)/);
  assert.match(source, /onClick=.*dispatch\('toggle'\)/);
  assert.match(source, /event.key === 'Escape'/);
  assert.match(source, /addEventListener\('pointerdown', outside, true\)/);
  assert.match(source, /removeEventListener\('pointerdown', outside, true\)/);
  assert.match(source, /!button.current\?\.contains\(event.target\) && !panel.current\?\.contains\(event.target\)/);
  assert.match(source, /setTimeout\(\(\) => dispatch\('leave'\), 120\)/);
  assert.match(source, /createPortal[\s\S]*role="tooltip"[\s\S]*document.body/);
  assert.match(source, /aria-describedby=\{open \? id : undefined\}/);
  assert.match(source, /pointerFocus.current = true/);
  const css = read('src/app/globals.css');
  assert.match(css, /\.il-help-trigger\.il-help-trigger:focus-visible/);
  assert.match(css, /\.il-help-panel\{position:fixed/);
  assert.match(css, /@media\(pointer:coarse\)/);
});
test('contextual help is never nested inside labels or other interactive controls', () => {
  const interactive = new Set(['label', 'button', 'a', 'summary', 'select', 'option', 'textarea']);
  let count = 0;
  for (const name of screens) {
    const file = ts.createSourceFile(name + '.tsx', read(`src/components/${name}.tsx`), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node, ancestors: string[]) => {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText(file);
        node.children.forEach(child => visit(child, [...ancestors, tag])); return;
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'HelpTip') {
        count += 1;
        assert.equal(ancestors.some(tag => interactive.has(tag)), false, `${name}: HelpTip inside ${ancestors.join(' > ')}`);
        assert.ok(node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'label'), name);
      }
      ts.forEachChild(node, child => visit(child, ancestors));
    };
    visit(file, []);
  }
  assert.ok(count >= 20, `Expected contextual help across main screens, found ${count}`);
});
test('concise screens retain actionable SMS guidance, warnings, provenance and metric distinctions visibly', () => {
  const maintenance = read('src/components/CourseMaintenance.tsx');
  assert.match(maintenance, /You have unsaved changes. Save before leaving or reloading to keep them./);
  assert.match(maintenance, /SYNTHETIC DEMO/); assert.match(maintenance, /Changes stay in this browser/);
  assert.match(maintenance, /31 facility choices come from the existing TPW spreadsheet/);
  assert.match(maintenance, /Whole-program totals, separate from SMS/);
  assert.match(maintenance, /Program Hours \(per Participant\)/);
  assert.match(maintenance, /Notes <span>Optional/);
  assert.match(maintenance, /Showing this organization’s 100 most recently updated programs/);
  const demo = read('src/components/SmsDemo.tsx');
  assert.match(demo, /Synthetic demo/); assert.match(demo, /Fictional data and phone choices/);
  assert.match(demo, /<b>20 2<\/b> = 20 attendees, 2 session hours/);
  assert.match(demo, /Save the phone’s program before trying a text/);
  assert.match(demo, /Save the selection above to use it/);
  const admin = read('src/components/SmsAdmin.tsx');
  assert.match(admin, /id="sms-course-binding-help">Future check-ins only/);
  assert.match(admin, /Use \+country code and number, without spaces/);
  assert.match(admin, /Choose a saved program or Program name only, then save/);
  assert.match(admin, /reasonLabel\(record.reason\)/);
  const dashboard = read('src/components/SmsDashboard.tsx');
  assert.match(dashboard, /All recorded sessions · all time/);
  assert.match(dashboard, /Program-level estimate/);
  assert.match(dashboard, /Excludes carrier delivery time/);
  assert.match(dashboard, /Connection interrupted · showing last received totals/);
  const chart = read('src/components/CourseAttendance.tsx');
  assert.match(chart, /Message receipt order/); assert.match(chart, /Program-level estimate<\/small>/);
  assert.match(chart, /SYNTHETIC PROGRAM ACTIVITY/); assert.match(chart, /data.truncated/);
});

test('course actions are readable and touch-sized, and demo empty guidance works from either screen', () => {
  const chart = read('src/components/CourseAttendance.tsx');
  assert.match(chart, /Connect a demo phone to this program, then try a check-in\./);
  assert.doesNotMatch(chart, /binding below/);
  const courses = read('src/app/courses/courses.css');
  assert.match(courses, /\.cm-button,\.cm-content-heading>\.cm-button,\.cm-back\{min-height:44px\}/);
  assert.match(courses, /\.cm-card-actions button\{font-size:13px;min-height:44px;/);
  assert.match(read('src/components/CourseAttendance.css'), /\.cm-view-attendance\{min-height:44px;font-size:13px\}/);
  assert.match(read('src/app/globals.css'), /@media\(pointer:coarse\)\{\.il-help-trigger\.il-help-trigger\{width:44px;height:44px/);
});
