//! SSE 帧解析。
//!
//! 保持纯函数、无 IO，便于对"半个 chunk""多行 data""`[DONE]` 之后的噪声"这类真实边界做
//! 确定测试。Provider 输出是不可信输入，因此解析失败一律走显式错误，不做静默跳过。

/// 单个 SSE 帧的数据载荷。
///
/// `[DONE]` 哨兵**不**建模成变体：它是解析器的终止状态而不是一帧数据。
/// 用变体表示会导致"匹配到 Done"与"真的构造过 Done"两件事脱节，进而让
/// saw_done 这类标志恒为假，把正常结束的流误判成缺少终态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseFrame {
    Data(String),
}

/// 尚未以 `\n` 收尾的残余行允许占用的最大字节数。
///
/// 上游是不可信输入：一条永不终止的行会让 `buffer` 无限增长。取 4 MiB——与
/// AI execution 链路的 1 Mi 字符预算处于同一量级，并为 JSON 转义与 UTF-8
/// 编码的放大预留空间。这是解析器自身的边界，不依赖下游再兜一次限额。
const MAX_SSE_LINE_BYTES: usize = 4 * 1024 * 1024;

/// 单个帧的多行 `data:` 累计上限（含拼接分隔 `\n`）。
///
/// 与行上限同理：永不以空行收尾的帧会让 `data_lines` 无限增长。
#[cfg(test)]
const MAX_SSE_FRAME_DATA_BYTES: usize = 4 * 1024 * 1024;

/// 解析器输入缓冲超限。
///
/// 命中任一维度即整体失败：调用方据此中止整条流，而不是截断后继续解析。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SseParseError {
    /// 尚未以 `\n` 收尾的一行超过 `MAX_SSE_LINE_BYTES`。
    LineTooLong,
    /// 单个帧累计的 `data:` 载荷超过 `MAX_SSE_FRAME_DATA_BYTES`。
    FrameDataTooLarge,
}

impl std::fmt::Display for SseParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SseParseError::LineTooLong => {
                write!(f, "SSE line exceeded the current request framing limit")
            }
            SseParseError::FrameDataTooLarge => write!(
                f,
                "SSE frame data exceeded the current request framing limit"
            ),
        }
    }
}

impl std::error::Error for SseParseError {}

/// 增量解析器。上游分块边界与 SSE 帧边界无关，因此必须跨 `push` 保留残余字节。
#[derive(Debug)]
pub struct SseFrameParser {
    max_bytes: usize,
    buffer: String,
    /// 累积的 data 行。SSE 允许一个帧有多行 data，按 `\n` 拼接。
    data_lines: Vec<String>,
    /// `data_lines` 拼接成帧载荷后的精确字节数（含分隔 `\n`）。
    data_bytes: usize,
    saw_any_field: bool,
    /// 是否已收到 `[DONE]`。
    done: bool,
}

impl Default for SseFrameParser {
    fn default() -> Self {
        Self::with_max_bytes(MAX_SSE_LINE_BYTES)
    }
}

impl SseFrameParser {
    /// Only trusted native request policy supplies this transport framing bound.
    pub(crate) fn with_max_bytes(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            buffer: String::new(),
            data_lines: Vec::new(),
            data_bytes: 0,
            saw_any_field: false,
            done: false,
        }
    }

    pub fn new() -> Self {
        Self::default()
    }

    /// 是否已经收到 `[DONE]`。收到之后的任何字节都必须被忽略。
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// 投喂一段解码后的文本，返回其中已完成的帧。
    ///
    /// 任一缓冲维度超限即返回错误；此后继续投喂仍会失败，调用方应中止整条流。
    pub fn push(&mut self, chunk: &str) -> Result<Vec<SseFrame>, SseParseError> {
        if self.done {
            return Ok(Vec::new());
        }
        self.buffer.push_str(chunk);

        let mut frames = Vec::new();
        while let Some(index) = self.buffer.find('\n') {
            if index > self.max_bytes {
                return Err(SseParseError::LineTooLong);
            }
            let line: String = self.buffer.drain(..=index).collect();
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if let Some(frame) = self.take_frame() {
                    frames.push(frame);
                }
                if self.done {
                    // `[DONE]` 之后的内容一律丢弃，包括同一 buffer 里剩余的行。
                    self.buffer.clear();
                    self.data_lines.clear();
                    self.data_bytes = 0;
                    break;
                }
                continue;
            }
            self.consume_line(line)?;
        }
        if self.buffer.len() > self.max_bytes {
            return Err(SseParseError::LineTooLong);
        }
        Ok(frames)
    }

    /// 上游连接结束时冲刷残余帧。没有空行收尾的最后一帧在 SSE 里是允许的。
    pub fn finish(&mut self) -> Result<Vec<SseFrame>, SseParseError> {
        let mut frames = Vec::new();
        if !self.buffer.is_empty() {
            if self.buffer.len() > self.max_bytes {
                return Err(SseParseError::LineTooLong);
            }
            let line = std::mem::take(&mut self.buffer)
                .trim_end_matches(['\r', '\n'])
                .to_string();
            if !line.is_empty() {
                self.consume_line(&line)?;
            }
        }
        if let Some(frame) = self.take_frame() {
            frames.push(frame);
        }
        Ok(frames)
    }

    fn consume_line(&mut self, line: &str) -> Result<(), SseParseError> {
        self.saw_any_field = true;
        // 注释行与空字段名按 SSE 规范忽略。
        if line.starts_with(':') {
            return Ok(());
        }
        let Some((field, value)) = line.split_once(':') else {
            return Ok(());
        };
        if field != "data" {
            return Ok(());
        }
        // SSE 规定 data 值的第一个空格是分隔符，需要去掉。
        let value = value.strip_prefix(' ').unwrap_or(value);
        if value.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let added = value.len() + usize::from(!self.data_lines.is_empty());
        if self.data_bytes + added > self.max_bytes {
            return Err(SseParseError::FrameDataTooLarge);
        }
        self.data_bytes += added;
        self.data_lines.push(value.to_string());
        Ok(())
    }

    fn take_frame(&mut self) -> Option<SseFrame> {
        if !self.saw_any_field {
            return None;
        }
        self.saw_any_field = false;
        // 必须清空：否则下一次 take_frame 会把同一批 data 行再拼一次，
        // 导致同一个帧被重复投递（例如 [DONE] 之后的收尾空行就会命中这条路径）。
        if self.data_lines.is_empty() {
            return None;
        }
        let payload = self.data_lines.join("\n");
        self.data_lines.clear();
        self.data_bytes = 0;
        Some(SseFrame::Data(payload))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SseFrame, SseFrameParser, SseParseError, MAX_SSE_FRAME_DATA_BYTES, MAX_SSE_LINE_BYTES,
    };

    fn parse_all(chunks: &[&str]) -> (Vec<SseFrame>, bool) {
        let mut parser = SseFrameParser::new();
        let mut frames = Vec::new();
        for chunk in chunks {
            frames.extend(parser.push(chunk).expect("within parser limits"));
        }
        frames.extend(parser.finish().expect("within parser limits"));
        (frames, parser.is_done())
    }

    #[test]
    fn reads_a_single_frame() {
        let (frames, done) = parse_all(&["data: {\"a\":1}\n\n"]);
        assert_eq!(frames, vec![SseFrame::Data("{\"a\":1}".to_string())]);
        assert!(!done);
    }

    #[test]
    fn reassembles_a_frame_split_across_arbitrary_chunk_boundaries() {
        let (frames, _) = parse_all(&["data: {\"a\"", ":1", "}\n", "\n"]);
        assert_eq!(frames, vec![SseFrame::Data("{\"a\":1}".to_string())]);
    }

    #[test]
    fn joins_multiline_data_with_newlines() {
        let (frames, _) = parse_all(&["data: line1\ndata: line2\n\n"]);
        assert_eq!(frames, vec![SseFrame::Data("line1\nline2".to_string())]);
    }

    #[test]
    fn recognises_the_done_sentinel_and_ignores_everything_after_it() {
        let (frames, done) = parse_all(&["data: {\"a\":1}\n\ndata: [DONE]\n\ndata: {\"b\":2}\n\n"]);
        assert_eq!(frames, vec![SseFrame::Data("{\"a\":1}".to_string())]);
        assert!(done);
    }

    #[test]
    fn tolerates_crlf_and_comment_lines() {
        let (frames, _) = parse_all(&[": keep-alive\r\ndata: {\"a\":1}\r\n\r\n"]);
        assert_eq!(frames, vec![SseFrame::Data("{\"a\":1}".to_string())]);
    }

    #[test]
    fn keeps_only_the_first_space_after_the_field_name() {
        let (frames, _) = parse_all(&["data:  two-leading-spaces\n\n"]);
        assert_eq!(
            frames,
            vec![SseFrame::Data(" two-leading-spaces".to_string())]
        );
    }

    #[test]
    fn ignores_fields_other_than_data() {
        let (frames, _) = parse_all(&["event: message\nid: 7\ndata: x\n\n"]);
        assert_eq!(frames, vec![SseFrame::Data("x".to_string())]);
    }

    #[test]
    fn flushes_a_final_frame_without_a_trailing_blank_line() {
        let (frames, _) = parse_all(&["data: tail"]);
        assert_eq!(frames, vec![SseFrame::Data("tail".to_string())]);
    }

    #[test]
    fn produces_nothing_for_blank_or_comment_only_input() {
        let (frames, done) = parse_all(&["\n\n", ": ping\n\n"]);
        assert_eq!(frames, Vec::<SseFrame>::new());
        assert!(!done);
    }

    #[test]
    fn discards_input_arriving_after_done() {
        let mut parser = SseFrameParser::new();
        assert_eq!(parser.push("data: [DONE]\n\n"), Ok(Vec::<SseFrame>::new()));
        assert_eq!(parser.push("data: late\n\n"), Ok(Vec::<SseFrame>::new()));
        assert!(parser.is_done());
    }

    #[test]
    fn rejects_an_unterminated_line_beyond_the_limit() {
        let mut parser = SseFrameParser::new();
        let oversized = "x".repeat(MAX_SSE_LINE_BYTES + 1);
        assert_eq!(parser.push(&oversized), Err(SseParseError::LineTooLong));
        // 超限是稳定的失败：残余仍在 buffer 里，继续投喂只会再次失败。
        assert_eq!(parser.push("more"), Err(SseParseError::LineTooLong));
        assert_eq!(parser.finish(), Err(SseParseError::LineTooLong));
    }

    #[test]
    fn rejects_a_completed_line_beyond_the_limit() {
        let mut parser = SseFrameParser::new();
        let oversized = format!("data: {}\n\n", "x".repeat(MAX_SSE_LINE_BYTES));
        assert_eq!(parser.push(&oversized), Err(SseParseError::LineTooLong));
    }

    #[test]
    fn accepts_a_line_at_the_exact_limit() {
        let payload = "x".repeat(MAX_SSE_LINE_BYTES - "data: ".len());
        let (frames, _) = parse_all(&[&format!("data: {payload}\n\n")]);
        assert_eq!(frames, vec![SseFrame::Data(payload)]);
    }

    #[test]
    fn rejects_frame_data_accumulating_beyond_the_limit() {
        let mut parser = SseFrameParser::new();
        let half = "x".repeat(MAX_SSE_FRAME_DATA_BYTES / 2);
        parser
            .push(&format!("data: {half}\n"))
            .expect("first line within limit");
        assert_eq!(
            parser.push(&format!("data: {half}\n")),
            Err(SseParseError::FrameDataTooLarge)
        );
    }

    #[test]
    fn rejects_frame_data_beyond_the_limit_on_finish() {
        let mut parser = SseFrameParser::new();
        let payload = "x".repeat(MAX_SSE_FRAME_DATA_BYTES - "data: ".len());
        parser
            .push(&format!("data: {payload}\n"))
            .expect("first frame line within limit");
        // 收尾行自身不长，但累计 data 已超限。
        parser.push("data: 123456").expect("tail line within limit");
        assert_eq!(parser.finish(), Err(SseParseError::FrameDataTooLarge));
    }

    #[test]
    fn resets_frame_budget_after_a_completed_frame() {
        let mut parser = SseFrameParser::new();
        let payload = "x".repeat(MAX_SSE_FRAME_DATA_BYTES - "data: ".len() - 1);
        for _ in 0..2 {
            let frames = parser
                .push(&format!("data: {payload}\n\n"))
                .expect("each frame stays within its own budget");
            assert_eq!(frames, vec![SseFrame::Data(payload.clone())]);
        }
    }
}
