/** Synthetic cases captured from the untouched Web implementation at 2e0a35c0. */
export const arenaStreamMetaCases = [
  { name: 'no-marker', raw: '# 雨城\n\n普通正文 {不解析} <!-- ordinary -->\n' },
  { name: 'arena-comment', raw: '# 标题\n\n正文\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":" H ","winner":" A "},"impacts":[{"characterName":" A ","impact":" 约定 ","currentStateSummary":" 平静 "}]} -->\n' },
  { name: 'legacy-alias-malformed', raw: "正文\n<!-- MAHOSHOJO_META {version:1, impacts:[{name:'A', impact:'成长', current_state_summary:'平静',},],} -->" },
  { name: 'stream-alias-loose', raw: '正文\n--- MAHOSHOJO_STREAM_META = {"impacts":[{"character":"A","impact":"新"}]}\n后续正文' },
  { name: 'array-curly-quotes-ellipsis', raw: '<!--- mahoshojo_arena_meta [{“characterNameZh”:“A”,“impact”:“旧”},……,{“name”:“A”,“current_state_summary”:“新”},...,{“name”:“B”,“flag”:True}] -->' },
  { name: 'wrapped-string', raw: '正文\n<!-- MAHOSHOJO_ARENA_META {"json":"{\\"payload\\":{\\"report\\":{\\"winner\\":\\"A\\"},\\"impacts\\":[{\\"name\\":\\"A\\",\\"impact\\":\\"约定\\"}]}}"} -->' },
  { name: 'unclosed-comment', raw: '正文\n<!-- MAHOSHOJO_ARENA_META {version:1,impacts:[{name:"A",current_state_summary:"继续"}' },
  { name: 'multiple-markers-with-telemetry', raw: '前文\n<!-- MAHOSHOJO_META {"impacts":[{"name":"A","impact":"旧"}]} -->\n中段\nMAHOSHOJO_STREAM_META {"report":{"headline":"新"},"impacts":[{"name":"A","impact":"新"}]}\n<!-- MAHOSHOJO_TELEMETRY_META {"aiModel":" local ","usage":{"prompt_tokens":8,"completion_tokens":5,"reasoning_tokens":2},"narrativeHistoryReadCount":3} -->' },
  { name: 'invalid-update-schema', raw: '正文\n<!-- MAHOSHOJO_ARENA_META {"version":-1} -->' },
  { name: 'invalid-telemetry-schema', raw: '正文\n<!-- MAHOSHOJO_TELEMETRY_META {"usage":{"totalTokens":-1}} -->' },
  { name: 'telemetry-parse-failure', raw: '正文\n<!-- MAHOSHOJO_TELEMETRY_META : : : -->' },
  { name: 'remove-invalid-update-fields', raw: '正文\n<!-- MAHOSHOJO_ARENA_META {"report":{"winner":true},"impacts":[null,2,{"name":"A","impact":false},{"name":"A","impact":"新"},{"name":" ","impact":"丢弃"}]} -->' },
] as const;
