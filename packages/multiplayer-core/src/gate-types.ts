export type ArenaGateLayer =
  | 'room-lifecycle'
  | 'room-shareability'
  | 'collaboration'
  | 'generation-readiness'
  | 'runtime-resource'
  | 'result-action';

export type ArenaGateIssueTargetKind =
  | 'room'
  | 'combatant'
  | 'scenario'
  | 'material'
  | 'proposal'
  | 'reference';

export interface ArenaGateIssue {
  readonly code: string;
  readonly gate: ArenaGateLayer;
  readonly severity: 'blocking' | 'warning';
  readonly target?: Readonly<{
    kind: ArenaGateIssueTargetKind;
    key?: string;
    displayName?: string;
  }>;
  readonly params?: Readonly<Record<string, string | number | boolean | null>>;
  readonly messageKey: string;
  readonly userAction: string;
  readonly technicalId?: string;
}
