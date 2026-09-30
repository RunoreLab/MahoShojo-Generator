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

/// 增量解析器。上游分块边界与 SSE 帧边界无关，因此必须跨 `push` 保留残余字节。
#[derive(Debug, Default)]
pub struct SseFrameParser {
    buffer: String,
    /// 累积的 data 行。SSE 允许一个帧有多行 data，按 `\n` 拼接。
    data_lines: Vec<String>,
    saw_any_field: bool,
    /// 是否已收到 `[DONE]`。
    done: bool,
}

impl SseFrameParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// 是否已经收到 `[DONE]`。收到之后的任何字节都必须被忽略。
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// 投喂一段解码后的文本，返回其中已完成的帧。
    pub fn push(&mut self, chunk: &str) -> Vec<SseFrame> {
        if self.done {
            return Vec::new();
        }
        self.buffer.push_str(chunk);

        let mut frames = Vec::new();
        while let Some(index) = self.buffer.find('\n') {
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
                    break;
                }
                continue;
            }
            self.consume_line(line);
        }
        frames
    }

    /// 上游连接结束时冲刷残余帧。没有空行收尾的最后一帧在 SSE 里是允许的。
    pub fn finish(&mut self) -> Vec<SseFrame> {
        let mut frames = Vec::new();
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer)
                .trim_end_matches(['\r', '\n'])
                .to_string();
            if !line.is_empty() {
                self.consume_line(&line);
            }
        }
        if let Some(frame) = self.take_frame() {
            frames.push(frame);
        }
        frames
    }

    fn consume_line(&mut self, line: &str) {
        self.saw_any_field = true;
        // 注释行与空字段名按 SSE 规范忽略。
        if line.starts_with(':') {
            return;
        }
        let Some((field, value)) = line.split_once(':') else {
            return;
        };
        if field != "data" {
            return;
        }
        // SSE 规定 data 值的第一个空格是分隔符，需要去掉。
        let value = value.strip_prefix(' ').unwrap_or(value);
        if value.trim() == "[DONE]" {
            self.done = true;
            return;
        }
        self.data_lines.push(value.to_string());
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
        Some(SseFrame::Data(payload))
    }
}

#[cfg(test)]
mod tests {
    use super::{SseFrame, SseFrameParser};

    fn parse_all(chunks: &[&str]) -> (Vec<SseFrame>, bool) {
        let mut parser = SseFrameParser::new();
        let mut frames = Vec::new();
        for chunk in chunks {
            frames.extend(parser.push(chunk));
        }
        frames.extend(parser.finish());
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
        assert_eq!(parser.push("data: [DONE]\n\n"), Vec::<SseFrame>::new());
        assert_eq!(parser.push("data: late\n\n"), Vec::<SseFrame>::new());
        assert!(parser.is_done());
    }
}
