// Is something already listening where Course Hub wants to run? 'ours' = a healthy Course Hub (don't start a
// second one), 'other' = some other program has the port, 'free' = nothing there.
export async function probeInstance(baseUrl: string): Promise<'ours' | 'other' | 'free'> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json().catch(() => null)) as { app?: string } | null;
    return res.ok && body?.app === 'course-hub' ? 'ours' : 'other';
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return code === 'ECONNREFUSED' ? 'free' : 'other';
  }
}
