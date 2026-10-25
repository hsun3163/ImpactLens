import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import CenterCollectionSetup from '../src/components/CenterCollectionSetup';
test('population is an explicit admin action, not a page-load mutation', () => {
 const html=renderToStaticMarkup(createElement(CenterCollectionSetup,{onSaved:()=>{}}));
 assert.match(html,/Load center collection/); assert.match(html,/does not duplicate/);
 assert.match(html,/SMS check-ins and permissions stay unchanged/);
 const source=readFileSync('src/components/CenterCollectionSetup.tsx','utf8');
 assert.doesNotMatch(source,/useEffect/); assert.match(source,/'populate-centers'/);
 assert.match(readFileSync('src/components/SmsAdmin.tsx','utf8'),/<CenterCollectionSetup onSaved={live.refresh}/);
});
