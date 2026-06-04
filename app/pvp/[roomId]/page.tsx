import type { Metadata } from 'next';

import { PvpRoomRouteProviders } from '@/components/competition/PvpRoomRouteProviders';

type RouteParams = {
  roomId?: string | string[];
};

interface PvpRoomRouteProps {
  params?: Promise<RouteParams>;
}

const getRoomIdFromParams = (params: RouteParams): string | undefined => {
  const rawRoomId = params.roomId;
  const roomId = Array.isArray(rawRoomId) ? rawRoomId[0] : rawRoomId;
  return roomId?.trim() || undefined;
};

export async function generateMetadata({ params }: PvpRoomRouteProps): Promise<Metadata> {
  const resolvedParams = params ? await params : {};
  const roomId = getRoomIdFromParams(resolvedParams);

  return {
    title: `PVP 房间 - ${roomId || '...'}`,
  };
}

export default function PvpRoomRoute() {
  return <PvpRoomRouteProviders />;
}
