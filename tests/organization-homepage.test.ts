import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OrganizationMetrics from '../src/components/OrganizationMetrics';
import { AccountLink } from '../src/components/PersistentWorkspace';
import { groupDashboardCourses, selectDashboardOrganization } from '../src/lib/organization-dashboard';
import { createCourseDemo } from '../src/lib/course-maintenance';
import { demoCourseAttendance } from '../src/lib/course-sms-demo';
import { productMessage } from '../src/lib/product-copy';
const read = (name: string) => readFileSync(name, 'utf8');

test('organization default is selected from authorized choices with explicit URL choice first', () => {
  const choices = [{ id: 'test', name: 'TEST organization', active: true }, { id: 'one', name: 'Example partner', active: true }, { id: 'sim', name: 'Defy SIM', active: true }];
  assert.equal(selectDashboardOrganization(choices)?.id, 'sim');
  assert.equal(selectDashboardOrganization(choices, 'one')?.id, 'one');
  assert.equal(selectDashboardOrganization(choices, 'unlisted')?.id, 'sim');
  assert.equal(selectDashboardOrganization(choices.slice(0, 2))?.id, 'one');
  assert.equal(selectDashboardOrganization([]), null);
  assert.equal(selectDashboardOrganization([{ id: 'disabled', name: 'Defy SIM', active: false }, choices[1]])?.id, 'one');
});

test('program panels group existing identities dynamically and reject wrong-organization or duplicate entries', () => {
  const workspace = createCourseDemo(); const all = workspace.summaries.map(item => demoCourseAttendance(workspace, item.id)!); const organizationId = workspace.organizations[0].id;
  const groups = groupDashboardCourses([...all, all[0]], organizationId);
  assert.equal(groups.length, 2); assert.equal(groups.flatMap(item => item.courses).length, 3);
  assert.ok(groups.flatMap(item => item.courses).every(item => item.course.organizationId === organizationId));
  assert.deepEqual(groupDashboardCourses(all, 'unknown'), []);
  const first = groups[0].courses[0];
  assert.equal(groupDashboardCourses(Array.from({ length: 7 }, (_, i) => ({ ...first, course: { ...first.course, id: `instance-${i}` } })), organizationId)[0].courses.length, 7);
});

test('homepage has exactly three defined metrics and preserves observed zero and unknown estimates', () => {
  const totals = { attendees: 60, sessions: 3, sessionMinutes: 720, participantMinutes: 14400 };
  const html = renderToStaticMarkup(createElement(OrganizationMetrics, { totals, participantEstimate: { participants: 29, programCount: 1, missingValuesCount: 0 } }));
  assert.equal((html.match(/class="org-metric"/g) ?? []).length, 3);
  for (const label of ['Program participants', 'Session hours', 'Sessions reported']) assert.ok(html.includes(label));
  assert.match(html, /<strong>29<span>/); assert.match(html, /<strong>12<span>h/); assert.match(html, /<strong>3<span>/);
  assert.doesNotMatch(html, /<strong>60/);
  const zero = renderToStaticMarkup(createElement(OrganizationMetrics, { totals, participantEstimate: { participants: 0, programCount: 1, missingValuesCount: 0 } }));
  assert.match(zero, /<strong>0<span>/);
  const unknown = renderToStaticMarkup(createElement(OrganizationMetrics, { totals, participantEstimate: null }));
  assert.match(unknown, /Awaiting details/);
});

test('home uses authorized directory and one scoped batch reader, with stale reads and sign-in navigation preserved', () => {
  const source = read('src/components/OrganizationHome.tsx');
  assert.match(source, /useSmsLive<.*>\('\/api\/sms\/course-metadata', 3000\)/);
  assert.match(source, /organizationId=\$\{encodeURIComponent\(organizationId\)\}&includeCourses=1/);
  assert.match(source, /<LiveOrganization key=\{selected.id\}/);
  assert.match(source, /<SmsAccess session=\{directory.session\}/);
  assert.match(source, /returnTo=\{requestedId \? `\/\?organizationId=\$\{encodeURIComponent\(requestedId\)\}` : '\/'\}/);
  assert.match(source, /live.stale/); assert.match(source, /addEventListener\('popstate'/);
  assert.doesNotMatch(source, /localStorage|senderPhone|messageSid|rawBody|\/api\/sms\/admin/);
  assert.match(read('src/app/organization.css'), /\.sms-shell \.org-content\{[^}]*margin:0 auto/);
  assert.match(source, /href="#organization-main">Skip to main content/);
});

test('public research remains available and its account navigation returns to research', () => {
  assert.match(read('src/app/page.tsx'), /<OrganizationHome\/>/);
  const research = read('src/app/research/page.tsx');
  assert.match(research, /official\.json/); assert.match(research, /Sources & methods/); assert.match(research, /computeWilson95/);
  const session = { authenticated: false, user: null, signInUrl: '/signin-with-chatgpt?return_to=%2F', signOutUrl: '/signout-with-chatgpt?return_to=%2F', storageAvailable: true };
  const signIn = renderToStaticMarkup(createElement(AccountLink, { session }));
  assert.match(signIn, /\/signin-with-chatgpt\?return_to=%2Fresearch/);
  const signOut = renderToStaticMarkup(createElement(AccountLink, { session: { ...session, authenticated: true } }));
  assert.match(signOut, /\/signout-with-chatgpt\?return_to=%2Fresearch/);
});

test('demo remains local, shares organization context, and puts rehearsal below program panels', () => {
  const demo = read('src/components/SmsDemo.tsx');
  assert.match(demo, /Synthetic demo/);
  assert.ok(demo.indexOf('<OrganizationMetrics') < demo.indexOf('<OrganizationOverview'));
  assert.ok(demo.indexOf('<OrganizationOverview') < demo.indexOf('<details className="org-demo-tools">'));
  assert.match(demo, /readCourseDemo\(window.localStorage\)/); assert.doesNotMatch(demo, /fetch\(|smsRequest\(|\/api\//);
  assert.match(demo, /url.searchParams.set\('organizationId', organizationId\)/);
  assert.match(read('src/components/SmsNavigation.tsx'), /link.href === '\/demo\/courses' && organizationId/);
  assert.match(read('src/app/demo/courses/page.tsx'), /initialOrganizationId=/);
  const maintenance = read('src/components/CourseMaintenance.tsx');
  assert.match(maintenance, /href=\{dashboardHref\}/);
});

test('compact charts retain accessible tables and use unscaled HTML axis labels', () => {
  const chart = read('src/components/CourseAttendance.tsx');
  assert.match(chart, /compact \? '0 0 440 260' : '0 0 880 260'/);
  assert.match(chart, /className="ca-html-y"/); assert.match(chart, /className="ca-html-x"/);
  assert.match(chart, /!compact && <text x="47"/);
  assert.match(chart, /role="img" aria-label=/); assert.match(chart, /<th scope="col">Attendance/);
  assert.match(chart, /data.truncated/); assert.match(read('src/components/OrganizationOverview.tsx'), /truncated &&/);
});

test('display error translation preserves API identifiers and leaves callers raw source text untouched', () => {
  assert.equal(productMessage('Teacher phone: choose a course.'), 'Facilitator phone: choose a program.');
  assert.equal(productMessage('COURSES and teachers; courseId / teacherId'), 'PROGRAMS and facilitators; courseId / teacherId');
  assert.match(read('src/components/SmsAdmin.tsx'), /\{record.body\}/);
  assert.match(read('src/components/SmsBusinessSettings.tsx'), /\{request.text\}/);
  assert.match(read('src/components/SmsDashboard.tsx'), /productMessage\(details.error\)/);
});


test('all three instances sharing one program name get distinct homepage panels', () => {
  const workspace = createCourseDemo(); const original = demoCourseAttendance(workspace, workspace.summaries[0].id)!;
  const instances = ['one', 'two', 'three'].map((id, index) => ({ ...original, course: { ...original.course, id, facility: `Example facility ${index + 1}` } }));
  const groups = groupDashboardCourses(instances, original.course.organizationId);
  assert.equal(groups.length, 1); assert.equal(groups[0].courses.length, 3);
  assert.deepEqual(groups[0].courses.map(item => item.course.id), ['one', 'two', 'three']);
  assert.match(read('src/components/OrganizationOverview.tsx'), /program.courses.map\(data => <article/);
  assert.doesNotMatch(read('src/components/OrganizationOverview.tsx'), /slice\(0,\s*[123]\)/);
});

test('page titles and the single primary management entry use the final visible vocabulary', () => {
  assert.match(read('src/app/courses/page.tsx'), /title: 'Manage programs · ImpactLens'/);
  assert.match(read('src/app/demo/courses/page.tsx'), /title: 'Manage programs · Synthetic demo · ImpactLens'/);
  assert.doesNotMatch(read('src/app/page.tsx'), /course attendance/);
  const home = read('src/components/OrganizationHome.tsx');
  assert.equal((home.match(/>Manage programs /g) ?? []).length, 1);
  assert.doesNotMatch(home, /PRIVATE TPW WORKSPACE|Authorized TPW administrators|TWO SIMPLE INPUTS/);
});

test('400px headline metrics stack with readable wrapping labels while desktop stays three across', () => {
  const css = read('src/app/organization.css');
  assert.match(css, /\.org-metrics\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  const mobile = css.slice(css.lastIndexOf('@media(max-width:600px)'));
  assert.match(mobile, /\.sms-shell \.org-metrics\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(mobile, /\.sms-shell \.org-metric\{[^}]*flex-wrap:wrap[^}]*min-width:0/);
  assert.match(mobile, /\.sms-shell \.org-metric h2\{[^}]*min-width:0[^}]*font-size:1rem[^}]*overflow-wrap:anywhere/);
  assert.match(mobile, /\.sms-shell \.org-metric strong\{[^}]*max-width:100%/);
  assert.doesNotMatch(mobile, /font-size:(?:[0-9]|1[0-3])px/);
});
