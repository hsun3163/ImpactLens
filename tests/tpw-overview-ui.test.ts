import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TpwCenterCards from '../src/components/TpwCenterCards';
import { centerDisplayName, centerHref, dashboardLocation } from '../src/lib/center-navigation';

test('center and TPW navigation round-trips explicit URL state without inventing identities', () => {
  assert.deepEqual(dashboardLocation('?view=tpw'), { overview: true, requestedId: '' });
  assert.deepEqual(dashboardLocation('?organizationId=center-2'), { overview: false, requestedId: 'center-2' });
  assert.equal(dashboardLocation('?view=other').overview, false);
  assert.equal(centerHref('a&b'), '/?organizationId=a%26b');
  assert.equal(centerDisplayName('Defy SIM'), 'Defy');
  assert.equal(centerDisplayName('Northstar Center'), 'Northstar Center');
});
test('TPW cards display each server center once with scoped links and current recorded totals', () => {
  const centers = [{id:'a',name:'Defy SIM',slug:'defy',active:true,sessions:6,attendees:121,sessionMinutes:1500,participantMinutes:30900,participantEstimate:{participants:30,programCount:1,missingValuesCount:0}}, {id:'b',name:'Northstar Center',slug:'northstar',active:true,sessions:18,attendees:300,sessionMinutes:2160,participantMinutes:36000,participantEstimate:{participants:60,programCount:3,missingValuesCount:0}}];
  const html = renderToStaticMarkup(createElement(TpwCenterCards, {organizations:centers}));
  assert.equal((html.match(/class="tpw-center-card"/g) ?? []).length,2);
  assert.match(html, /2 centers/); assert.match(html, /515/); assert.match(html, /600/);
  assert.match(html, /href="\/\?organizationId=a"/); assert.match(html, /href="\/\?organizationId=b"/);
  assert.doesNotMatch(html, /Defy SIM|demo|Synthetic|il-help-trigger/);
});
test('overview consumes one network total, centers retain scoped live reader, and nav remains visible', () => {
  const source = readFileSync('src/components/OrganizationHome.tsx','utf8');
  assert.match(source, /useSmsLive<SmsDashboardData>\('\/api\/sms\/dashboard', 1000\)/);
  assert.match(source, /<OrganizationMetrics totals=\{live.data.totals\}/);
  assert.match(source, /<RacMetrics participantMinutes=\{live.data.totals.participantMinutes\}/);
  assert.match(source, /<TpwCenterCards organizations=\{live.data.organizations\}/);
  assert.match(source, /href="\/\?view=tpw"/);
  assert.match(source, /url.searchParams.delete\('view'\)/);
  assert.doesNotMatch(source, /\.reduce\(|fetch\(|\/api\/sms\/admin/);
  const css = readFileSync('src/app/organization.css','utf8');
  assert.match(css, /\.tpw-center-grid\{grid-template-columns:1fr\}/);
  assert.match(css, /org-topbar-actions\{flex-basis:100%/);
});
