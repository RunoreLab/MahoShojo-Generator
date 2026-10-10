'use client';
import { BattleReportCard as SharedBattleReportCard, type BattleReportCardProps as SharedBattleReportCardProps } from '@mahoshojo/ui-web/arena-report';
import { createWebBattleReportPorts } from './shared/battle-report-ports';
export type BattleReportCardProps = Omit<SharedBattleReportCardProps, 'ports' | 'showImageAction'> & { onSaveImage?: (imageUrl: string) => void };
export type { NewsReport, BattleReportIllustrationSource, BattleReportIllustrationAsset } from '@mahoshojo/ui-web/arena-report';
export default function BattleReportCard({ onSaveImage, ...props }: BattleReportCardProps) {
  return <SharedBattleReportCard {...props} showImageAction={Boolean(onSaveImage)} ports={createWebBattleReportPorts(onSaveImage)} />;
}
