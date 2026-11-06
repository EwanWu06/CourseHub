import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProvider } from '../src/sync/providers.ts';

const tool = (url: string) => ({ submission_types: ['external_tool'], external_tool_tag_attributes: { url } });

test('publisher platforms are recognised from the LTI launch url', () => {
  assert.equal(detectProvider(tool('https://achieve.macmillanlearning.com/courses/abc/assignments/123')), 'macmillan');
  assert.equal(detectProvider(tool('https://www.macmillanlearning.com/achieve/assignment/555')), 'macmillan');
  assert.equal(detectProvider(tool('https://www.saplinglearning.com/ibiscms/mod/flcn/view.php?id=1')), 'macmillan');
  assert.equal(detectProvider(tool('https://www.gradescope.com/auth/lti/callback')), 'gradescope');
  assert.equal(detectProvider(tool('https://mylab.pearson.com/Student/AssignmentStart')), 'pearson');
  assert.equal(detectProvider(tool('https://session.masteringchemistry.com/myct/assignment')), 'pearson');
  assert.equal(detectProvider(tool('https://connect.mheducation.com/connect/lti')), 'mcgraw-hill');
  assert.equal(detectProvider(tool('https://learn.zybooks.com/zybook/CS1')), 'zybooks');
  assert.equal(detectProvider(tool('https://www.webassign.net/web/Student/Assignment-Responses/last?dep=1')), 'webassign');
  assert.equal(detectProvider(tool('https://ng.cengage.com/static/nb/ui/evo/index.html')), 'cengage');
});

test('unknown tools are external; New Quizzes and normal uploads are Canvas', () => {
  assert.equal(detectProvider(tool('https://tool.example.com/launch')), 'external');
  assert.equal(detectProvider(tool('https://school.quiz-lti-pdx-prod.instructure.com/lti/launch')), 'canvas');
  assert.equal(detectProvider({ submission_types: ['online_upload'] }), 'canvas');
  assert.equal(detectProvider({}), 'canvas');
});
