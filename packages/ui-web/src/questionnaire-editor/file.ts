import { MAX_QUESTIONNAIRE_IMPORT_BYTES } from '@mahoshojo/domain/questionnaire-definition';
export type QuestionnaireInputFile = Pick<File, 'size' | 'arrayBuffer'>;
/** Keep source text intact; invalid UTF-8 is an error, never silently replaced. */
export async function readQuestionnaireJsonFile(file: QuestionnaireInputFile): Promise<string> {
  if (file.size > MAX_QUESTIONNAIRE_IMPORT_BYTES) throw new Error('问卷文件超过 1 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_QUESTIONNAIRE_IMPORT_BYTES) throw new Error('问卷文件超过 1 MiB。');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('问卷文件不是有效 UTF-8，请另存为 UTF-8 JSON 后重试。'); }
}
