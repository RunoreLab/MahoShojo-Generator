import {
  ArenaProposalChangeSchema,
  MAX_PROPOSAL_CHANGES,
  type ArenaProposalChange,
} from '@mahoshojo/contracts/arena-room';

export type ProposalSelectionIssueCode =
  | 'invalid-changes'
  | 'invalid-proposal'
  | 'invalid-proposal-status'
  | 'empty-selection'
  | 'too-many-changes'
  | 'duplicate-change-id'
  | 'duplicate-dependency'
  | 'unknown-dependency'
  | 'self-dependency'
  | 'dependency-cycle'
  | 'unknown-selected-change'
  | 'duplicate-selected-change'
  | 'dependency-not-selected'
  | 'atomic-group-partial';

export interface ProposalSelectionIssue {
  readonly code: ProposalSelectionIssueCode;
  readonly index?: number;
  readonly changeId?: string;
  readonly dependencyId?: string;
  readonly atomicGroupId?: string;
  readonly message: string;
}

export interface ProposalSelectionValidation {
  readonly valid: boolean;
  readonly changes: readonly ArenaProposalChange[];
  readonly selectedChangeIds: readonly string[];
  readonly issues: readonly ProposalSelectionIssue[];
}

const selectionIssue = (
  code: ProposalSelectionIssueCode,
  message: string,
  fields: Omit<ProposalSelectionIssue, 'code' | 'message'> = {},
): ProposalSelectionIssue => ({ code, message, ...fields });

export const validateProposalChanges = (
  input: unknown,
  selectedChangeIds?: readonly string[],
): ProposalSelectionValidation => {
  const issues: ProposalSelectionIssue[] = [];
  if (!Array.isArray(input)) {
    return {
      valid: false,
      changes: [],
      selectedChangeIds: [],
      issues: [selectionIssue('invalid-changes', 'changes must be an array')],
    };
  }
  if (input.length === 0 || input.length > MAX_PROPOSAL_CHANGES) {
    issues.push(selectionIssue('too-many-changes', `changes must contain 1-${MAX_PROPOSAL_CHANGES} items`));
  }

  const changes: ArenaProposalChange[] = [];
  input.forEach((item, index) => {
    const parsed = ArenaProposalChangeSchema.safeParse(item);
    if (!parsed.success) {
      issues.push(selectionIssue('invalid-changes', 'change does not satisfy ArenaProposalChangeSchema', { index }));
      return;
    }
    changes.push(parsed.data);
  });

  const ids = changes.map((change) => change.changeId);
  const idSet = new Set<string>();
  changes.forEach((change, index) => {
    if (idSet.has(change.changeId)) {
      issues.push(selectionIssue('duplicate-change-id', 'changeId values must be unique', { changeId: change.changeId, index }));
    }
    idSet.add(change.changeId);
    const dependencyIds = new Set<string>();
    for (const dependencyId of change.dependsOn ?? []) {
      if (dependencyIds.has(dependencyId)) {
        issues.push(selectionIssue('duplicate-dependency', 'dependsOn values must be unique', {
          changeId: change.changeId,
          dependencyId,
          index,
        }));
      }
      dependencyIds.add(dependencyId);
      if (dependencyId === change.changeId) {
        issues.push(selectionIssue('self-dependency', 'a change cannot depend on itself', {
          changeId: change.changeId,
          dependencyId,
          index,
        }));
      } else if (!ids.includes(dependencyId)) {
        issues.push(selectionIssue('unknown-dependency', 'dependsOn must reference a change in this set', {
          changeId: change.changeId,
          dependencyId,
          index,
        }));
      }
    }
  });

  const graph = new Map(changes.map((change) => [change.changeId, change.dependsOn ?? []]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (changeId: string, path: readonly string[]): void => {
    if (visiting.has(changeId)) {
      issues.push(selectionIssue('dependency-cycle', `dependsOn cycle detected: ${[...path, changeId].join(' -> ')}`, { changeId }));
      return;
    }
    if (visited.has(changeId)) return;
    visiting.add(changeId);
    for (const dependency of graph.get(changeId) ?? []) {
      if (graph.has(dependency)) visit(dependency, [...path, changeId]);
    }
    visiting.delete(changeId);
    visited.add(changeId);
  };
  for (const change of changes) visit(change.changeId, []);

  let selected: readonly string[];
  if (selectedChangeIds === undefined) {
    selected = ids;
  } else if (!Array.isArray(selectedChangeIds)) {
    issues.push(selectionIssue('invalid-changes', 'selectedChangeIds must be an array'));
    selected = [];
  } else {
    const requested = new Set<string>();
    for (const changeId of selectedChangeIds) {
      if (requested.has(changeId)) {
        issues.push(selectionIssue('duplicate-selected-change', 'selectedChangeIds must be unique', { changeId }));
      }
      requested.add(changeId);
      if (!idSet.has(changeId)) {
        issues.push(selectionIssue('unknown-selected-change', 'selectedChangeIds contains an unknown change', { changeId }));
      }
    }
    // Return proposal order even when callers send a different selection order.
    selected = ids.filter((changeId) => requested.has(changeId));
  }

  if (selectedChangeIds !== undefined && Array.isArray(selectedChangeIds) && selectedChangeIds.length === 0) {
    issues.push(selectionIssue('empty-selection', 'at least one proposal change must be selected'));
  }

  const selectedSet = new Set(selected);
  for (const change of changes) {
    if (!selectedSet.has(change.changeId)) continue;
    for (const dependencyId of change.dependsOn ?? []) {
      if (!selectedSet.has(dependencyId)) {
        issues.push(selectionIssue('dependency-not-selected', 'selected changes must include their dependency closure', {
          changeId: change.changeId,
          dependencyId,
        }));
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const change of changes) {
    if (!change.atomicGroupId) continue;
    const group = groups.get(change.atomicGroupId) ?? [];
    group.push(change.changeId);
    groups.set(change.atomicGroupId, group);
  }
  for (const [atomicGroupId, group] of groups) {
    const selectedCount = group.filter((changeId) => selectedSet.has(changeId)).length;
    if (selectedCount > 0 && selectedCount < group.length) {
      issues.push(selectionIssue('atomic-group-partial', 'atomic groups must be selected in full', { atomicGroupId }));
    }
  }

  return {
    valid: issues.length === 0,
    changes,
    selectedChangeIds: selected,
    issues,
  };
};
