import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import SmsBusinessSettings, { BusinessRequestImport, agentGrantInput, businessStatusLabel, canManageBusiness, managerGrantInput, type BusinessAdminData } from '../src/components/SmsBusinessSettings';
const read = (name: string) => readFileSync(name, 'utf8');
const data: BusinessAdminData = { currentUserId: 'synthetic-owner', currentUserLabel: 'Example administrator', canManagePermissions: true, permissions: 'business-only', managerGrants: [], agentGrants: [], requests: [] };

test('business permission controls fail closed without an explicit server capability and account', () => {
  assert.equal(canManageBusiness(null), false); assert.equal(canManageBusiness(undefined), false);
  assert.equal(canManageBusiness({ ...data, canManagePermissions: false }), false);
  assert.equal(canManageBusiness({ ...data, currentUserId: '' }), false);
  assert.equal(canManageBusiness({ ...data, permissions: 'other' } as unknown as BusinessAdminData), false);
  assert.equal(canManageBusiness(data), true);
});

test('grant payloads specify only the chosen scope and never choose another assistant account', () => {
  assert.deepEqual(managerGrantInput('+12025550101', 'synthetic-org', true), { action: 'manager-grant', phone: '+12025550101', organizationId: 'synthetic-org', active: true });
  assert.deepEqual(agentGrantInput('synthetic-org', false), { action: 'agent-grant', organizationId: 'synthetic-org', active: false });
  assert.equal('subjectId' in agentGrantInput('synthetic-org', true), false);
  const source = read('src/components/SmsBusinessSettings.tsx');
  assert.doesNotMatch(source, /name="(?:subjectId|token|secret|password)"|setSubjectId|setToken|setSecret/);
  assert.match(source, /After saving permission, connect the authorized account to the business interface/);
  assert.match(source, /grant.subjectId === data.currentUserId && <button/);
});

test('permission setup starts collapsed with no preselected phones, organizations or automatic grants', () => {
  const html = renderToStaticMarkup(createElement(SmsBusinessSettings, { organizations: [], teachers: [], onAccessChange: () => {}, onPermissionChange: () => {}, refreshToken: 0 }));
  assert.match(html, /<details class="sms-business-settings sms-panel">/);
  assert.match(html, /Organization permissions &amp; program requests/);
  assert.doesNotMatch(html, /<form|open="|Allow leader requests|Allow assistant course actions/);
  const source = read('src/components/SmsBusinessSettings.tsx');
  assert.match(source, /const \[phone, setPhone\] = useState\(''\)/);
  assert.match(source, /const \[leaderOrganizationId, setLeaderOrganizationId\] = useState\(''\)/);
  assert.match(source, /const \[agentOrganizationId, setAgentOrganizationId\] = useState\(''\)/);
  const file = ts.createSourceFile('settings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect') {
      assert.doesNotMatch(node.getText(file), /method: 'POST'|managerGrantInput\(|agentGrantInput\(|\bsave\(/);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
});

test('ordinary teacher registration remains separate and has no automatic privilege grant', () => {
  const source = read('src/components/SmsAdmin.tsx');
  const start = source.indexOf('function submitTeacher('); const end = source.indexOf('function clearCorrection(', start);
  const teacher = source.slice(start, end);
  assert.match(source, /Facilitator access only. Leader permissions are separate./);
  assert.match(teacher, /action: 'teacher'/);
  assert.doesNotMatch(teacher, /manager-grant|agent-grant|business-admin|role:|capabilities:/);
});

test('historical import is one explicit eligible row, chosen authorized organization and required reason', () => {
  const html = renderToStaticMarkup(createElement(BusinessRequestImport, { recordId: 'synthetic-record', organizations: [], busy: false, onSubmit: () => {} }));
  assert.match(html, /Use as program request/); assert.doesNotMatch(html, /<form|Add this request/);
  const admin = read('src/components/SmsAdmin.tsx');
  assert.match(admin, /businessPermissionsAllowed && !live.stale && !businessImportNeedsRefresh && !importedRequestIds.includes\(record.id\) && record.canImportBusinessRequest && !record.businessRequestId && <BusinessRequestImport/);
  assert.match(admin, /grant.active && grant.phone === record.senderPhone && grant.organizationId === item.id/);
  assert.match(admin, /action: 'import-request', \.\.\.input/);
  const source = read('src/components/SmsBusinessSettings.tsx');
  assert.match(source, /onSubmit\(\{ recordId, organizationId, reason: reason.trim\(\) \}/);
  assert.match(source, /Why use this earlier message\?<input required maxLength=\{500\}/);
  assert.match(source, /Use only this original text as a program-change request. Attendance totals stay unchanged./);
  assert.doesNotMatch(source, /recordIds|import-all|bulk-import|proposal.execute|proposal.approve/);
});

test('request statuses are read-only and do not reinterpret requests as attendance', () => {
  assert.equal(businessStatusLabel('pending'), 'Waiting for assistant');
  assert.equal(businessStatusLabel('executed'), 'Completed');
  assert.equal(businessStatusLabel('failed'), 'Needs attention');
  assert.equal(businessStatusLabel('unknown'), 'Status unavailable');
  const source = read('src/components/SmsBusinessSettings.tsx');
  assert.match(source, /Request status appears here. The authorized assistant carries out program changes through the business interface./);
  assert.match(source, /className="sms-business-message">\{request.text\}<\/p>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|eval\(|executeApproved|approved.execute/);
});

test('permission errors and stale reads are visible, controls are labeled, and actions meet the existing accessibility pattern', () => {
  const source = read('src/components/SmsBusinessSettings.tsx');
  assert.match(source, /role="alert" tabIndex=\{-1\} ref=\{errorRef\}/);
  assert.match(source, /errorRef.current\?\.focus/);
  assert.match(source, /if \(saving.current \|\| !allowed \|\| live.stale \|\| needsRefresh\) return/);
  assert.match(source, /const controlsBusy = busy \|\| live.stale \|\| needsRefresh/);
  assert.match(source, /onAccessChange\(allowed && !live.stale/);
  assert.match(source, /Registered phone<select required/);
  assert.match(source, /<label className="sms-field">Organization<select required/g);
  assert.doesNotMatch(source, /<summary>[^<]*<HelpTip/);
  const css = read('src/app/sms/sms.css');
  assert.match(css, /\.sms-business-settings>summary\{[^}]*min-height:52px/);
  assert.match(css, /\.sms-business-import select\{[^}]*min-height:44px/);
});

test('revoked request authority is shown as blocked while completed outcomes stay completed', () => {
  assert.equal(businessStatusLabel('pending', false), 'Permission update required');
  assert.equal(businessStatusLabel('completed', false), 'Completed');
  const source = read('src/components/SmsBusinessSettings.tsx');
  assert.match(source, /businessStatusLabel\(request.status, request.authorizationActive\)/);
  assert.match(source, /if \(!\(err instanceof SmsApiError\) \|\| err.status < 400 \|\| err.status >= 500\) setNeedsRefresh\(true\)/);
  assert.match(source, /key=\{readGeneration\}/);
  assert.match(source, /onClick=\{onReload\}>Refresh permissions/);
  assert.match(source, /onAccessChange\(allowed && !live.stale && !needsRefresh/);
});


test('an uncertain single-message import is locked until an explicit fresh page read', () => {
  const source = read('src/components/SmsAdmin.tsx');
  assert.match(source, /payload.action === 'import-request' && \(!businessPermissionsAllowed \|\| live.stale \|\| businessImportNeedsRefresh\)/);
  assert.match(source, /setBusinessImportNeedsRefresh\(true\)/);
  assert.match(source, /err.status < 400 \|\| err.status >= 500/);
  assert.match(source, /setImportedRequestIds\(ids => \[...ids, String\(payload.recordId\)\]\)/);
  assert.match(source, /Save any open form first/);
  assert.match(source, /window.location.reload\(\)/);
  assert.doesNotMatch(source, /setBusinessImportNeedsRefresh\(false\)/);
});
