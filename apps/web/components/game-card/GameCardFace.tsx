'use client';
import { GameCardFace as SharedGameCardFace, type GameCardFaceProps } from '@mahoshojo/ui-web/card-forge';
import { WEB_SNAPDOM_MEDIA } from '@mahoshojo/ui-web/client';
export type { ImageTransform, GameCardFaceProps } from '@mahoshojo/ui-web/card-forge';
export { DEFAULT_IMAGE_TRANSFORM } from '@mahoshojo/ui-web/card-forge';
export function GameCardFace(props: GameCardFaceProps) {
  return <SharedGameCardFace {...props} mediaAdapter={WEB_SNAPDOM_MEDIA} />;
}
