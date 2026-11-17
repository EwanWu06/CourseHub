import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { extractText } from 'unpdf';
import { startMockCanvas } from '../mock/server.ts';
import { makePdf, makePptx, makeDocx } from '../mock/files.ts';
import { CookieJar } from '../src/canvas/cookies.ts';

async function formLogin(base: string, remember = false): Promise<CookieJar> {
  const jar = new CookieJar();
  const body = new URLSearchParams({ username: 'student', password: 'password', ...(remember ? { remember: '1' } : {}) });
  const res = await fetch(`${base}/login`, { method: 'POST', body, redirect: 'manual' });
  assert.equal(res.status, 302);
  jar.setFromResponse(`${base}/login`, res.headers.getSetCookie());
  return jar;
}

test('unauthenticated API calls redirect to /login', async () => {
  const mock = await startMockCanvas({ variant: 'alpha' });
  try {
    const res = await fetch(`${mock.baseUrl}/api/v1/courses`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location')!, /\/login/);
  } finally {
    await mock.close();
  }
});

test('form login sets canvas_session and API answers with while(1); prefix', async () => {
  const mock = await startMockCanvas({ variant: 'alpha' });
  try {
    const jar = await formLogin(mock.baseUrl);
    const cookie = jar.headerFor(`${mock.baseUrl}/api/v1/courses`);
    assert.match(cookie, /canvas_session=/);
    const res = await fetch(`${mock.baseUrl}/api/v1/courses?per_page=100`, { headers: { Cookie: cookie } });
    const text = await res.text();
    assert.ok(text.startsWith('while(1);'));
    const courses = JSON.parse(text.slice(9)) as { id: string }[];
    assert.ok(courses.length >= 3);
  } finally {
    await mock.close();
  }
});

test('lists paginate with Link headers at the mock page size', async () => {
  const mock = await startMockCanvas({ variant: 'alpha', pageSize: 2 });
  try {
    const cookie = mock.sessionCookieHeader();
    const res = await fetch(`${mock.baseUrl}/api/v1/courses/101/assignments?per_page=100`, { headers: { Cookie: cookie } });
    assert.equal((JSON.parse((await res.text()).slice(9)) as unknown[]).length, 2);
    assert.match(res.headers.get('link') ?? '', /rel="next"/);
  } finally {
    await mock.close();
  }
});

test('non-GET API calls are refused and recorded', async () => {
  const mock = await startMockCanvas({ variant: 'alpha' });
  try {
    const res = await fetch(`${mock.baseUrl}/api/v1/courses`, { method: 'POST', headers: { Cookie: mock.sessionCookieHeader() } });
    assert.equal(res.status, 405);
    assert.deepEqual(mock.requests.filter((r) => r.method !== 'GET' && r.path.startsWith('/api/')).map((r) => r.method), ['POST']);
  } finally {
    await mock.close();
  }
});

test('expireSessions and expireAfter invalidate sessions', async () => {
  const mock = await startMockCanvas({ variant: 'alpha' });
  try {
    const cookie = mock.sessionCookieHeader();
    const ok = await fetch(`${mock.baseUrl}/api/v1/users/self`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(ok.status, 200);
    mock.expireAfter(1);
    assert.equal((await fetch(`${mock.baseUrl}/api/v1/users/self`, { headers: { Cookie: cookie }, redirect: 'manual' })).status, 200);
    assert.equal((await fetch(`${mock.baseUrl}/api/v1/users/self`, { headers: { Cookie: cookie }, redirect: 'manual' })).status, 302);
  } finally {
    await mock.close();
  }
});

test('remember-me cookie logs back in silently on /login', async () => {
  const mock = await startMockCanvas({ variant: 'alpha' });
  try {
    const jar = await formLogin(mock.baseUrl, true);
    mock.expireSessions();
    const res = await fetch(`${mock.baseUrl}/login`, { headers: { Cookie: jar.headerFor(`${mock.baseUrl}/login`) }, redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('canvas_session=')));
    mock.setRemember(false);
    const res2 = await fetch(`${mock.baseUrl}/login`, { headers: { Cookie: jar.headerFor(`${mock.baseUrl}/login`) }, redirect: 'manual' });
    assert.equal(res2.status, 200);
  } finally {
    await mock.close();
  }
});

test('idp mode sends /login to a separate identity provider host', async () => {
  const mock = await startMockCanvas({ variant: 'alpha', idp: true });
  try {
    const res = await fetch(`${mock.baseUrl}/login`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('location')!.startsWith(mock.idpUrl));
    assert.notEqual(new URL(mock.idpUrl).hostname, new URL(mock.baseUrl).hostname);
  } finally {
    await mock.close();
  }
});

test('profile exposes the ICS feed, which needs no login', async () => {
  const mock = await startMockCanvas({ variant: 'beta' });
  try {
    const res = await fetch(`${mock.baseUrl}/api/v1/users/self/profile`, { headers: { Cookie: mock.sessionCookieHeader() } });
    const profile = JSON.parse((await res.text()).slice(9)) as { calendar: { ics: string } };
    const ics = await (await fetch(profile.calendar.ics)).text();
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /UID:event-assignment-/);
  } finally {
    await mock.close();
  }
});

test('file download redirects to a blob host on a different hostname', async () => {
  const mock = await startMockCanvas({ variant: 'alpha' });
  try {
    const cookie = mock.sessionCookieHeader();
    const meta = JSON.parse((await (await fetch(`${mock.baseUrl}/api/v1/courses/101/files/7001`, { headers: { Cookie: cookie } })).text()).slice(9)) as { url: string };
    const hop = await fetch(meta.url, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(hop.status, 302);
    const blobUrl = hop.headers.get('location')!;
    assert.equal(new URL(blobUrl).hostname, 'localhost');
    const bytes = Buffer.from(await (await fetch(blobUrl)).arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  } finally {
    await mock.close();
  }
});

test('makePdf output is readable by unpdf page by page', async () => {
  const { totalPages, text } = await extractText(new Uint8Array(makePdf(['hello world', 'second (page) \\ text'])), { mergePages: false });
  assert.equal(totalPages, 2);
  assert.match(text[0], /hello world/);
  assert.match(text[1], /second \(page\) \\ text/);
});

test('makePptx and makeDocx build OOXML zips', () => {
  const pptx = unzipSync(new Uint8Array(makePptx([{ text: ['Title', 'Point A'], notes: 'Say hi' }, { text: ['Slide 2'] }])));
  assert.ok(pptx['ppt/slides/slide1.xml']);
  assert.match(strFromU8(pptx['ppt/notesSlides/notesSlide1.xml']), /Say hi/);
  const docx = unzipSync(new Uint8Array(makeDocx(['Para one', 'Para two'])));
  assert.match(strFromU8(docx['word/document.xml']), /Para two/);
});
