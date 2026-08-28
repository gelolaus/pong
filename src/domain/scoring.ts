export interface ScoreInput {
  correct: boolean;
  responseMs: number;
  baseDurationMs: number;
}

export function scoreAnswer({ correct, responseMs, baseDurationMs }: ScoreInput): number {
  if (!correct) {
    return 0;
  }

  const remainingFraction = 1 - responseMs / baseDurationMs;
  const speedBonus = Math.round(250 * remainingFraction);

  return 1000 + Math.min(250, Math.max(0, speedBonus));
}
