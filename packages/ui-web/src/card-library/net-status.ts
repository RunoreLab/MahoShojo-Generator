// 传输层重试谓词（与 Web `bounded-fetch` 同源语义）。
// 可重试：408 / 429 / 5xx；4xx 其余是业务终态（400/401/403/404 等），不得重试，
// 也不得用旧结果冒充新结果。

export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

export const isDefinitiveClientTerminalStatus = (status: number): boolean =>
  status >= 400 && status < 500 && !isRetryableStatus(status);
