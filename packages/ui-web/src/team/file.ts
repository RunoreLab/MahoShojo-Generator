import { MAX_TEAM_INPUT_BYTES, parseTeamInput } from '@mahoshojo/domain/team-input';
export interface TeamInputFile { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
export async function readTeamFile(file: TeamInputFile): Promise<Record<string, unknown>[]> {
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_TEAM_INPUT_BYTES) throw new Error('单个 JSON 文件不能超过 1 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_TEAM_INPUT_BYTES) throw new Error('单个 JSON 文件不能超过 1 MiB。');
  return parseTeamInput(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
