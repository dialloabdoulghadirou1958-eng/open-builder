export async function toolResult<T>(
  promise: Promise<T>,
  shape: (value: T) => Record<string, unknown>,
): Promise<string> {
  try {
    return JSON.stringify({ ok: true, ...shape(await promise) });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
