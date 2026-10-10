'use client';
import { StreamingBattleReportCard as SharedStreamingBattleReportCard, type StreamingBattleReportCardProps as SharedStreamingBattleReportCardProps } from '@mahoshojo/ui-web/arena-report';
import { createWebBattleReportPorts } from '../shared/battle-report-ports';
export type StreamingBattleReportCardProps = Omit<SharedStreamingBattleReportCardProps, 'ports' | 'showImageAction'> & { onSaveImage?: (imageUrl: string) => void };

export default function StreamingBattleReportCard({ onSaveImage, ...props }: StreamingBattleReportCardProps) {
  return <SharedStreamingBattleReportCard {...props} showImageAction={Boolean(onSaveImage)} ports={createWebBattleReportPorts(onSaveImage)} />;
}
