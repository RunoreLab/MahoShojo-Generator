import { getUserIdFromActivityHeaders } from '@/lib/auth/activity-token';
import { touchUserLastActivity } from '@/lib/database/user-activity';

export const recordUserActivityFromRequest = (req: Request, seenAtIso?: string): void => {
  const executionContext = (req as any).context;

  const touchPromise = (async () => {
    const userId = await getUserIdFromActivityHeaders(req.headers);
    if (!userId) return;
    await touchUserLastActivity(userId, seenAtIso);
  })().catch(() => {
    // 统计链路不得影响主流程
  });

  if (executionContext?.waitUntil) {
    executionContext.waitUntil(touchPromise);
  }
};

