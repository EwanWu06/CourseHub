// Which platform an assignment really lives on (from its LTI launch URL).
export type Provider = 'canvas' | 'macmillan' | 'gradescope' | 'pearson' | 'mcgraw-hill' | 'zybooks' | 'webassign' | 'cengage' | 'external';

const RULES: [RegExp, Provider][] = [
  [/quiz-lti|quiz_lti/i, 'canvas'], // New Quizzes are Canvas's own tool
  [/macmillanlearning\.com|macmillan|saplinglearning\.com/i, 'macmillan'],
  [/gradescope\.com/i, 'gradescope'],
  [/pearson|mylab|mastering[a-z&]*\.com/i, 'pearson'],
  [/mheducation\.com|mcgraw/i, 'mcgraw-hill'],
  [/zybooks\.com/i, 'zybooks'],
  [/webassign\.net/i, 'webassign'],
  [/cengage\.com|mindtap/i, 'cengage'],
];

export function detectProvider(a: { submission_types?: string[]; external_tool_tag_attributes?: { url?: string | null } | null; url?: string | null }): Provider {
  const url = a.external_tool_tag_attributes?.url ?? a.url ?? '';
  if (url) for (const [re, provider] of RULES) if (re.test(url)) return provider;
  return a.submission_types?.includes('external_tool') ? 'external' : 'canvas';
}
