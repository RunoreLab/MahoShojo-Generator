import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';
import { handler } from './handler';

export const POST = withNextDrCapability('generate-game-card', handler);
