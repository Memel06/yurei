const numbers = (version: string): ReadonlyArray<number> =>
  (version.split("-")[0] ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);

/** Major.minor.patch comparison; prerelease tags are ignored. */
function compareVersions(a: string, b: string): number {
  const pa = numbers(a);
  const pb = numbers(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const isNewer = (candidate: string, current: string): boolean => compareVersions(candidate, current) > 0;
