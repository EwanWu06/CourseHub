import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteCanvasHtml } from '../src/util/html.ts';

const ctx = {
  schoolId: 'alpha',
  baseUrl: 'https://alpha.instructure.com',
  courseMap: new Map([['1', 'alpha:1']]),
  pageMap: new Map([['1/week-2', 'alpha:p:5']]),
};

test('Canvas images go through the local proxy', () => {
  assert.equal(rewriteCanvasHtml('<img src="/courses/1/files/2/preview" alt="d">', ctx), '<img src="/proxy/alpha/courses/1/files/2/preview" alt="d">');
  assert.equal(rewriteCanvasHtml('<img src="https://alpha.instructure.com/courses/1/files/2/preview?verifier=x&amp;a=1">', ctx), '<img src="/proxy/alpha/courses/1/files/2/preview?verifier=x&amp;a=1">');
  assert.equal(rewriteCanvasHtml('<img class="equation_image" src="/equation_images/C_6H%7B12%7D">', ctx), '<img class="equation_image" src="/proxy/alpha/equation_images/C_6H%7B12%7D">');
  assert.equal(rewriteCanvasHtml('<img src="https://cdn.example.com/a.png">', ctx), '<img src="https://cdn.example.com/a.png">');
});

test('links to known pages stay inside Course Hub', () => {
  assert.equal(rewriteCanvasHtml('<a href="/courses/1/pages/week-2">next</a>', ctx), '<a href="/courses/alpha:1/pages/alpha:p:5">next</a>');
});

test('other Canvas links and external links open in a new tab', () => {
  assert.equal(rewriteCanvasHtml('<a href="/courses/1/assignments/9" target="_self">hw</a>', ctx), '<a href="https://alpha.instructure.com/courses/1/assignments/9" target="_blank" rel="noopener">hw</a>');
  assert.equal(rewriteCanvasHtml('<a href="https://example.com/x">x</a>', ctx), '<a href="https://example.com/x" target="_blank" rel="noopener">x</a>');
  assert.equal(rewriteCanvasHtml('<a href="#top">top</a>', ctx), '<a href="#top">top</a>');
});

test('iframes become links and scripts are removed', () => {
  assert.equal(rewriteCanvasHtml('<iframe src="https://www.youtube.com/embed/x" width="560"></iframe>', ctx), '<a href="https://www.youtube.com/embed/x" target="_blank" rel="noopener">▶ 嵌入内容：在新窗口打开</a>');
  assert.equal(rewriteCanvasHtml('<p>a</p><script>alert(1)</script><p>b</p>', ctx), '<p>a</p><p>b</p>');
});
