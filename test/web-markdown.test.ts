import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mathMarkdown } from '../web/src/lib/markdown.ts';

test('inline and display math render with KaTeX and keep their underscores', () => {
  const html = mathMarkdown('ΔG 公式 $\\Delta G = \\Delta H - T\\Delta S$，以及 $K_{sp}$\n\n$$pH = pK_a + \\log\\frac{[A^-]}{[HA]}$$');
  assert.match(html, /class="katex"/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /<em>sp/, 'underscore inside math is not emphasis');
});

test('markdown still works around math; prices are not math', () => {
  const html = mathMarkdown('**重点**：缓冲溶液\n- 一\n- 二\n\n书价 $5 和 $10');
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<li>一<\/li>/);
  assert.match(html, /\$5 和 \$10/);
});

test('math that starts with a number still renders (chemistry is full of it)', () => {
  const html = mathMarkdown('PbCl2：$4s^3 = 1.17\\times10^{-5}$，所以 $s = 1.43\\times10^{-2}$ M');
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2);
});

test('an inline "1) … 2) … 3) …" enumeration becomes a real list', () => {
  const html = mathMarkdown('1) ΔS 的单位是 J/K，要换算。2) 升温不总是让反应更自发。3) ΔG<0 只说明能发生');
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /2\)/);
  const prose = mathMarkdown('见图 1) 的说明');
  assert.doesNotMatch(prose, /<li>/, 'a lone "1)" is not a list');
});
