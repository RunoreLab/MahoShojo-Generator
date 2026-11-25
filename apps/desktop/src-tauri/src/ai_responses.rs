//! Stateless Responses text adapter. Snapshots validate deltas; they never replay text.
use serde::Deserialize;

use crate::ai::{AiExecutionUsage, DirectAiError, DirectAiErrorCode};

#[derive(Default)]
pub(crate) struct ResponsesDelta {
    pub text: String,
    pub reasoning: String,
    pub usage: Option<AiExecutionUsage>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type")]
enum Part {
    #[serde(rename = "output_text")]
    Text { text: String },
    #[serde(rename = "summary_text")]
    Summary { text: String },
    #[serde(rename = "reasoning_text")]
    Reasoning { text: String },
    #[serde(other)]
    Unsupported,
}
impl Part {
    fn text(&self) -> Result<&str, DirectAiError> {
        match self {
            Self::Text { text } | Self::Summary { text } | Self::Reasoning { text } => Ok(text),
            Self::Unsupported => Err(invalid("unsupported response content")),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum Item {
    #[serde(rename = "message")]
    Message {
        id: String,
        role: String,
        status: String,
        content: Vec<Part>,
    },
    #[serde(rename = "reasoning")]
    Reasoning {
        id: String,
        summary: Vec<Part>,
        status: Option<String>,
        #[serde(default)]
        content: Option<Vec<Part>>,
    },
    #[serde(other)]
    Unsupported,
}

#[derive(Debug, Deserialize)]
struct Response {
    status: String,
    #[serde(default)]
    output: Vec<Item>,
    usage: Option<Usage>,
    error: Option<UpstreamError>,
    incomplete_details: Option<Incomplete>,
}
#[derive(Debug, Deserialize)]
struct Incomplete {
    reason: String,
}
#[derive(Debug, Deserialize)]
struct UpstreamError {
    code: Option<String>,
}
#[derive(Debug, Deserialize)]
struct Usage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
    input_tokens_details: Option<InputDetails>,
    output_tokens_details: Option<OutputDetails>,
}
#[derive(Debug, Deserialize)]
struct InputDetails {
    cached_tokens: Option<u64>,
}
#[derive(Debug, Deserialize)]
struct OutputDetails {
    reasoning_tokens: Option<u64>,
}
impl From<Usage> for AiExecutionUsage {
    fn from(value: Usage) -> Self {
        Self {
            input_tokens: value.input_tokens,
            output_tokens: value.output_tokens,
            total_tokens: value.total_tokens,
            cached_input_tokens: value.input_tokens_details.and_then(|d| d.cached_tokens),
            reasoning_tokens: value.output_tokens_details.and_then(|d| d.reasoning_tokens),
        }
    }
}

#[derive(Deserialize)]
struct Envelope {
    sequence_number: u64,
    #[serde(flatten)]
    event: Event,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum Event {
    #[serde(
        rename = "response.created",
        alias = "response.in_progress",
        alias = "response.queued"
    )]
    Lifecycle { response: Response },
    #[serde(rename = "response.output_item.added")]
    ItemAdded { output_index: usize, item: Item },
    #[serde(rename = "response.output_item.done")]
    ItemDone { output_index: usize, item: Item },
    #[serde(rename = "response.content_part.added")]
    PartAdded {
        output_index: usize,
        item_id: String,
        content_index: usize,
        part: Part,
    },
    #[serde(rename = "response.content_part.done")]
    PartDone {
        output_index: usize,
        item_id: String,
        content_index: usize,
        part: Part,
    },
    #[serde(rename = "response.reasoning_summary_part.added")]
    SummaryAdded {
        output_index: usize,
        item_id: String,
        summary_index: usize,
        part: Part,
    },
    #[serde(rename = "response.reasoning_summary_part.done")]
    SummaryDone {
        output_index: usize,
        item_id: String,
        summary_index: usize,
        part: Part,
    },
    #[serde(rename = "response.output_text.delta")]
    TextDelta {
        output_index: usize,
        item_id: String,
        content_index: usize,
        delta: String,
    },
    #[serde(rename = "response.output_text.done")]
    TextDone {
        output_index: usize,
        item_id: String,
        content_index: usize,
        text: String,
    },
    #[serde(rename = "response.reasoning_summary_text.delta")]
    SummaryDelta {
        output_index: usize,
        item_id: String,
        summary_index: usize,
        delta: String,
    },
    #[serde(rename = "response.reasoning_summary_text.done")]
    SummaryTextDone {
        output_index: usize,
        item_id: String,
        summary_index: usize,
        text: String,
    },
    #[serde(rename = "response.reasoning_text.delta")]
    ReasoningDelta {
        output_index: usize,
        item_id: String,
        content_index: usize,
        delta: String,
    },
    #[serde(rename = "response.reasoning_text.done")]
    ReasoningDone {
        output_index: usize,
        item_id: String,
        content_index: usize,
        text: String,
    },
    #[serde(rename = "response.output_text.annotation.added")]
    Annotation {
        output_index: usize,
        item_id: String,
        content_index: usize,
    },
    #[serde(rename = "response.completed")]
    Completed { response: Response },
    #[serde(rename = "response.failed")]
    Failed { response: Response },
    #[serde(rename = "response.incomplete")]
    Incomplete { response: Response },
    #[serde(rename = "error")]
    Error { code: Option<String> },
    #[serde(rename = "response.refusal.delta", alias = "response.refusal.done")]
    Refusal,
    #[serde(other)]
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Text,
    Summary,
    Reasoning,
}
#[derive(Default)]
struct TrackedPart {
    text: String,
    done: bool,
}
struct TrackedItem {
    id: String,
    message: bool,
    projected_reasoning: Option<Kind>,
    parts: Vec<TrackedPart>,
    summary: Vec<TrackedPart>,
    done: bool,
}
#[derive(Default)]
pub(crate) struct ResponsesStreamState {
    items: Vec<TrackedItem>,
    completed: bool,
    last_sequence: Option<u64>,
    has_text: bool,
    content_bytes: usize,
    max_content_bytes: Option<usize>,
}
fn invalid(message: &str) -> DirectAiError {
    DirectAiError {
        code: DirectAiErrorCode::StreamProtocol,
        message: message.into(),
        contract_code: Some("invalid-response".into()),
    }
}
fn rejected(code: &str) -> DirectAiError {
    DirectAiError {
        code: DirectAiErrorCode::UpstreamRejected,
        message: "provider did not complete the response".into(),
        contract_code: Some(code.into()),
    }
}
fn error_code(code: Option<&str>) -> &str {
    match code {
        Some(
            "rate_limit_exceeded"
            | "rate_limit_error"
            | "subscription_sharing_usage_limit_exceeded",
        ) => "rate-limited",
        Some(
            "invalid_api_key"
            | "authentication_error"
            | "unauthorized"
            | "subscription_sharing_invalid_user",
        ) => "authentication-failed",
        Some(
            "permission_denied"
            | "subscription_sharing_user_not_eligible"
            | "chatpass_v2_scope_not_authorized",
        ) => "permission-denied",
        Some(
            "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable",
        ) => "service-unavailable",
        Some("subscription_sharing_unsupported_capability") => "invalid-request",
        Some("content_filter") | Some("content_policy_violation") => "content-filtered",
        Some("context_length_exceeded") | Some("max_output_tokens") => "output-too-large",
        _ => "internal-error",
    }
}

impl ResponsesStreamState {
    pub(crate) fn is_completed(&self) -> bool {
        self.completed
    }

    fn item(&mut self, index: usize, id: &str) -> Result<&mut TrackedItem, DirectAiError> {
        let item = self
            .items
            .get_mut(index)
            .ok_or_else(|| invalid("unknown response item"))?;
        if item.id != id {
            return Err(invalid("response item identity changed"));
        }
        Ok(item)
    }
    fn part(
        &mut self,
        index: usize,
        id: &str,
        part_index: usize,
        kind: Kind,
        create: bool,
    ) -> Result<&mut TrackedPart, DirectAiError> {
        if index + 1 != self.items.len() {
            return Err(invalid("response output arrived out of order"));
        }
        let item = self.item(index, id)?;
        if item.done || item.message != (kind == Kind::Text) {
            return Err(invalid(
                "response content has the wrong item type or lifecycle",
            ));
        }
        let parts = if kind == Kind::Summary {
            &mut item.summary
        } else {
            &mut item.parts
        };
        if create && part_index == parts.len() {
            if parts.last().is_some_and(|p| !p.done) {
                return Err(invalid("response content parts overlap"));
            }
            parts.push(TrackedPart::default());
        }
        parts
            .get_mut(part_index)
            .ok_or_else(|| invalid("unknown response content part"))
    }

    fn add_part(
        &mut self,
        index: usize,
        id: &str,
        part_index: usize,
        part: Part,
    ) -> Result<(), DirectAiError> {
        let kind = match part {
            Part::Text { .. } => Kind::Text,
            Part::Summary { .. } => Kind::Summary,
            Part::Reasoning { .. } => Kind::Reasoning,
            Part::Unsupported => return Err(invalid("unsupported response content")),
        };
        if !part.text()?.is_empty() {
            return Err(invalid("response added content without deltas"));
        }
        let item = self.item(index, id)?;
        let parts = if kind == Kind::Summary {
            &item.summary
        } else {
            &item.parts
        };
        if parts.len() != part_index {
            return Err(invalid("duplicate response content part"));
        }
        self.part(index, id, part_index, kind, true)?;
        Ok(())
    }
    fn append(
        &mut self,
        index: usize,
        id: &str,
        part_index: usize,
        kind: Kind,
        delta: String,
    ) -> Result<ResponsesDelta, DirectAiError> {
        if self
            .max_content_bytes
            .is_some_and(|max| self.content_bytes.saturating_add(delta.len()) > max)
        {
            return Err(DirectAiError {
                code: DirectAiErrorCode::StreamProtocol,
                message: "upstream output exceeded the fixed content budget".into(),
                contract_code: Some("output-too-large".into()),
            });
        }
        // reasoning_text has no dedicated part-added event; its first delta creates the part.
        let part = self.part(index, id, part_index, kind, kind == Kind::Reasoning)?;
        if part.done {
            return Err(invalid("response delta followed a completed part"));
        }
        part.text.push_str(&delta);
        self.content_bytes += delta.len();
        let mut result = ResponsesDelta::default();
        if kind == Kind::Text {
            self.has_text |= !crate::ai::is_blank_output(&delta);
            result.text = delta;
        } else {
            let item = self.item(index, id)?;
            // Both protocol views are validated, but only the first nonempty view is
            // projected. Switching later would either replay or discard streamed output.
            if !delta.is_empty() && item.projected_reasoning.is_none() {
                item.projected_reasoning = Some(kind);
            }
            if item.projected_reasoning == Some(kind) {
                result.reasoning = delta;
            }
        }
        Ok(result)
    }
    fn done_text(
        &mut self,
        index: usize,
        id: &str,
        part_index: usize,
        kind: Kind,
        text: &str,
    ) -> Result<(), DirectAiError> {
        let part = self.part(index, id, part_index, kind, false)?;
        if part.text != text {
            return Err(invalid("response snapshot differs from streamed text"));
        }
        part.done = true;
        Ok(())
    }
    fn check_item(&self, index: usize, snapshot: &Item) -> Result<(), DirectAiError> {
        let tracked = self
            .items
            .get(index)
            .ok_or_else(|| invalid("response snapshot contains an unknown item"))?;
        let (id, message, content, summary) = match snapshot {
            Item::Message {
                id,
                role,
                status,
                content,
            } if role == "assistant" && status == "completed" => {
                (id, true, content.as_slice(), &[][..])
            }
            Item::Reasoning {
                id,
                summary,
                status,
                content,
            } if status.as_deref().is_none_or(|v| v == "completed") => (
                id,
                false,
                content.as_deref().unwrap_or(&[]),
                summary.as_slice(),
            ),
            _ => return Err(invalid("unsupported response output item")),
        };
        if id != &tracked.id || message != tracked.message {
            return Err(invalid("response snapshot changed item identity"));
        }
        for (parts, expected_parts, kind) in [
            (
                content,
                &tracked.parts,
                if message { Kind::Text } else { Kind::Reasoning },
            ),
            (summary, &tracked.summary, Kind::Summary),
        ] {
            if parts.len() != expected_parts.len() {
                return Err(invalid("response snapshot changed item content"));
            }
            for (part, expected) in parts.iter().zip(expected_parts) {
                let correct_kind = matches!(
                    (kind, part),
                    (Kind::Text, Part::Text { .. })
                        | (Kind::Summary, Part::Summary { .. })
                        | (Kind::Reasoning, Part::Reasoning { .. })
                );
                if !correct_kind || part.text()? != expected.text {
                    return Err(invalid("response snapshot differs from streamed content"));
                }
            }
        }
        Ok(())
    }

    pub(crate) fn consume(
        &mut self,
        payload: &str,
        max_content_bytes: Option<usize>,
    ) -> Result<ResponsesDelta, DirectAiError> {
        if self.completed {
            return Ok(ResponsesDelta::default());
        }
        self.max_content_bytes = max_content_bytes;
        if payload == "[DONE]" {
            return Err(invalid("Responses requires a typed terminal event"));
        }
        let envelope: Envelope = serde_json::from_str(payload)
            .map_err(|_| invalid("provider sent an unreadable Responses event"))?;
        if self
            .last_sequence
            .is_some_and(|last| envelope.sequence_number <= last)
        {
            return Err(invalid("Responses event sequence did not advance"));
        }
        self.last_sequence = Some(envelope.sequence_number);
        match envelope.event {
            Event::Lifecycle { response } => {
                if !matches!(response.status.as_str(), "queued" | "in_progress")
                    || response.error.is_some()
                    || !response.output.is_empty()
                {
                    return Err(invalid("invalid Responses lifecycle event"));
                }
            }
            Event::ItemAdded { output_index, item } => {
                if output_index != self.items.len()
                    || self.items.last().is_some_and(|item| !item.done)
                {
                    return Err(invalid(
                        "response output items overlap or arrived out of order",
                    ));
                }
                let (id, message) = match item {
                    Item::Message {
                        id,
                        role,
                        status,
                        content,
                    } if role == "assistant" && status == "in_progress" && content.is_empty() => {
                        (id, true)
                    }
                    Item::Reasoning {
                        id,
                        summary,
                        status,
                        content,
                    } if summary.is_empty()
                        && status.as_deref().is_none_or(|v| v == "in_progress")
                        && content.as_ref().is_none_or(Vec::is_empty) =>
                    {
                        (id, false)
                    }
                    _ => return Err(invalid("unsupported or nonempty response output item")),
                };
                if id.is_empty() || self.items.iter().any(|item| item.id == id) {
                    return Err(invalid("duplicate response item identity"));
                }
                self.items.push(TrackedItem {
                    id,
                    message,
                    projected_reasoning: None,
                    parts: Vec::new(),
                    summary: Vec::new(),
                    done: false,
                });
            }
            Event::ItemDone { output_index, item } => {
                self.check_item(output_index, &item)?;
                self.items[output_index].done = true;
            }
            Event::PartAdded {
                output_index,
                item_id,
                content_index,
                part,
            } => self.add_part(output_index, &item_id, content_index, part)?,
            Event::SummaryAdded {
                output_index,
                item_id,
                summary_index,
                part,
            } => self.add_part(output_index, &item_id, summary_index, part)?,
            Event::PartDone {
                output_index,
                item_id,
                content_index,
                part,
            }
            | Event::SummaryDone {
                output_index,
                item_id,
                summary_index: content_index,
                part,
            } => {
                let kind = match part {
                    Part::Text { .. } => Kind::Text,
                    Part::Summary { .. } => Kind::Summary,
                    Part::Reasoning { .. } => Kind::Reasoning,
                    Part::Unsupported => return Err(invalid("unsupported response content")),
                };
                self.done_text(output_index, &item_id, content_index, kind, part.text()?)?;
            }
            Event::TextDelta {
                output_index,
                item_id,
                content_index,
                delta,
            } => return self.append(output_index, &item_id, content_index, Kind::Text, delta),
            Event::SummaryDelta {
                output_index,
                item_id,
                summary_index,
                delta,
            } => return self.append(output_index, &item_id, summary_index, Kind::Summary, delta),
            Event::ReasoningDelta {
                output_index,
                item_id,
                content_index,
                delta,
            } => {
                return self.append(
                    output_index,
                    &item_id,
                    content_index,
                    Kind::Reasoning,
                    delta,
                )
            }
            Event::TextDone {
                output_index,
                item_id,
                content_index,
                text,
            } => self.done_text(output_index, &item_id, content_index, Kind::Text, &text)?,
            Event::SummaryTextDone {
                output_index,
                item_id,
                summary_index,
                text,
            } => self.done_text(output_index, &item_id, summary_index, Kind::Summary, &text)?,
            Event::ReasoningDone {
                output_index,
                item_id,
                content_index,
                text,
            } => self.done_text(
                output_index,
                &item_id,
                content_index,
                Kind::Reasoning,
                &text,
            )?,
            Event::Annotation {
                output_index,
                item_id,
                content_index,
            } => {
                self.part(output_index, &item_id, content_index, Kind::Text, false)?;
            }
            Event::Completed { response } => {
                if response.status != "completed"
                    || response.error.is_some()
                    || response.incomplete_details.is_some()
                    || !self.has_text
                    || response.output.len() != self.items.len()
                {
                    return Err(invalid("response did not complete with consumable text"));
                }
                for (index, item) in response.output.iter().enumerate() {
                    self.check_item(index, item)?;
                }
                self.completed = true;
                return Ok(ResponsesDelta {
                    usage: response.usage.map(Into::into),
                    ..Default::default()
                });
            }
            Event::Failed { response } => {
                if response.status != "failed" {
                    return Err(invalid("failed response has inconsistent status"));
                }
                return Err(rejected(error_code(
                    response.error.as_ref().and_then(|e| e.code.as_deref()),
                )));
            }
            Event::Incomplete { response } => {
                if response.status != "incomplete" {
                    return Err(invalid("incomplete response has inconsistent status"));
                }
                return Err(rejected(
                    match response
                        .incomplete_details
                        .as_ref()
                        .map(|d| d.reason.as_str())
                    {
                        Some("max_output_tokens") => "output-too-large",
                        Some("content_filter") => "content-filtered",
                        _ => "invalid-response",
                    },
                ));
            }
            Event::Error { code } => return Err(rejected(error_code(code.as_deref()))),
            Event::Refusal => return Err(rejected("content-filtered")),
            Event::Unsupported => {
                return Err(invalid("unsupported Responses event or output modality"))
            }
        }
        Ok(ResponsesDelta::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn consume(
        state: &mut ResponsesStreamState,
        mut value: Value,
    ) -> Result<ResponsesDelta, DirectAiError> {
        value["sequence_number"] = json!(state.last_sequence.map_or(0, |v| v + 1));
        state.consume(&value.to_string(), Some(64))
    }
    fn item(text: &str) -> Value {
        json!({"id":"m1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":text,"annotations":[]}]})
    }
    fn start(state: &mut ResponsesStreamState) {
        consume(state, json!({"type":"response.output_item.added","output_index":0,"item":{"id":"m1","type":"message","role":"assistant","status":"in_progress","content":[]}})).unwrap();
        consume(state, json!({"type":"response.content_part.added","output_index":0,"item_id":"m1","content_index":0,"part":{"type":"output_text","text":"","annotations":[]}})).unwrap();
    }
    fn delta(
        state: &mut ResponsesStreamState,
        text: &str,
    ) -> Result<ResponsesDelta, DirectAiError> {
        consume(
            state,
            json!({"type":"response.output_text.delta","output_index":0,"item_id":"m1","content_index":0,"delta":text}),
        )
    }
    fn complete(
        state: &mut ResponsesStreamState,
        text: &str,
    ) -> Result<ResponsesDelta, DirectAiError> {
        consume(
            state,
            json!({"type":"response.completed","response":{"status":"completed","output":[item(text)]}}),
        )
    }
    #[test]
    fn text_snapshots_do_not_replay_and_terminal_is_once() {
        let mut state = ResponsesStreamState::default();
        start(&mut state);
        assert_eq!(delta(&mut state, "你好✨").unwrap().text, "你好✨");
        assert!(consume(&mut state,json!({"type":"response.output_text.done","output_index":0,"item_id":"m1","content_index":0,"text":"你好✨"})).unwrap().text.is_empty());
        assert!(consume(
            &mut state,
            json!({"type":"response.output_item.done","output_index":0,"item":item("你好✨")})
        )
        .unwrap()
        .text
        .is_empty());
        assert!(complete(&mut state, "你好✨").unwrap().usage.is_none());
        assert!(state.is_completed());
        assert!(state
            .consume("not even JSON", Some(64))
            .unwrap()
            .text
            .is_empty());
    }
    #[test]
    fn snapshot_cannot_invent_or_change_text() {
        let mut state = ResponsesStreamState::default();
        start(&mut state);
        delta(&mut state, "partial").unwrap();
        assert_eq!(
            complete(&mut state, "different")
                .err()
                .unwrap()
                .contract_code
                .as_deref(),
            Some("invalid-response")
        );
        assert!(!state.is_completed());
    }
    #[test]
    fn token_limit_and_filter_are_failures_with_partial_kept() {
        for (reason, code) in [
            ("max_output_tokens", "output-too-large"),
            ("content_filter", "content-filtered"),
            ("other", "invalid-response"),
        ] {
            let mut state = ResponsesStreamState::default();
            start(&mut state);
            delta(&mut state, "partial").unwrap();
            let error = consume(&mut state,json!({"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":reason}}})).err().unwrap();
            assert_eq!(error.contract_code.as_deref(), Some(code));
            assert_eq!(state.items[0].parts[0].text, "partial");
        }
    }
    #[test]
    fn unsupported_output_cannot_hide_beside_text() {
        for kind in [
            "function_call",
            "image_generation_call",
            "computer_call",
            "unknown",
        ] {
            let mut state = ResponsesStreamState::default();
            start(&mut state);
            delta(&mut state, "ok").unwrap();
            let error = consume(&mut state,json!({"type":"response.completed","response":{"status":"completed","output":[item("ok"),{"type":kind,"id":"tool"}]}})).err().unwrap();
            assert_eq!(error.contract_code.as_deref(), Some("invalid-response"));
        }
    }
    #[test]
    fn done_is_not_a_responses_terminal_and_unknown_events_fail() {
        let mut state = ResponsesStreamState::default();
        assert!(state.consume("[DONE]", None).is_err());
        assert!(consume(&mut state, json!({"type":"response.made_up"})).is_err());
    }
    #[test]
    fn budget_rejects_entire_delta_before_mutating_content() {
        let mut state = ResponsesStreamState::default();
        start(&mut state);
        delta(&mut state, "ok").unwrap();
        assert_eq!(
            delta(&mut state, &"x".repeat(63))
                .err()
                .unwrap()
                .contract_code
                .as_deref(),
            Some("output-too-large")
        );
        assert_eq!(state.items[0].parts[0].text, "ok");
        assert_eq!(state.content_bytes, 2);
    }
    #[test]
    fn wrong_item_or_repeated_sequence_is_rejected() {
        let mut state = ResponsesStreamState::default();
        start(&mut state);
        assert!(consume(&mut state,json!({"type":"response.output_text.delta","output_index":0,"item_id":"wrong","content_index":0,"delta":"x"})).is_err());
        let payload = json!({"type":"response.output_text.delta","sequence_number":state.last_sequence,"output_index":0,"item_id":"m1","content_index":0,"delta":"x"});
        assert!(state.consume(&payload.to_string(), None).is_err());
    }
    #[test]
    fn raw_reasoning_and_usage_are_normalized_without_opaque_replay() {
        let mut state = ResponsesStreamState::default();
        consume(&mut state,json!({"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"r1","summary":[],"encrypted_content":"opaque"}})).unwrap();
        let result=consume(&mut state,json!({"type":"response.reasoning_text.delta","output_index":0,"item_id":"r1","content_index":0,"delta":"thinking"})).unwrap();
        assert_eq!(result.reasoning, "thinking");
        consume(&mut state,json!({"type":"response.reasoning_text.done","output_index":0,"item_id":"r1","content_index":0,"text":"thinking"})).unwrap();
        let reasoning = json!({"type":"reasoning","id":"r1","summary":[],"content":[{"type":"reasoning_text","text":"thinking"}],"encrypted_content":"opaque"});
        consume(
            &mut state,
            json!({"type":"response.output_item.done","output_index":0,"item":reasoning}),
        )
        .unwrap();
        assert_eq!(state.content_bytes, 8);
        let usage: Usage=serde_json::from_value(json!({"input_tokens":12,"output_tokens":8,"total_tokens":20,"input_tokens_details":{"cached_tokens":3},"output_tokens_details":{"reasoning_tokens":5}})).unwrap();
        let usage: AiExecutionUsage = usage.into();
        assert_eq!(usage.cached_input_tokens, Some(3));
        assert_eq!(usage.reasoning_tokens, Some(5));
    }
    #[test]
    fn dual_reasoning_views_validate_both_and_project_first_nonempty() {
        for first in [Kind::Summary, Kind::Reasoning] {
            let mut state = ResponsesStreamState::default();
            consume(&mut state, json!({"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"r1","summary":[]}})).unwrap();
            consume(&mut state, json!({"type":"response.reasoning_summary_part.added","output_index":0,"item_id":"r1","summary_index":0,"part":{"type":"summary_text","text":""}})).unwrap();
            let summary = json!({"type":"response.reasoning_summary_text.delta","output_index":0,"item_id":"r1","summary_index":0,"delta":"summary"});
            let raw = json!({"type":"response.reasoning_text.delta","output_index":0,"item_id":"r1","content_index":0,"delta":"raw"});
            let (leading, trailing, projected) = if first == Kind::Summary {
                (summary, raw, "summary")
            } else {
                (raw, summary, "raw")
            };
            assert_eq!(consume(&mut state, leading).unwrap().reasoning, projected);
            assert!(consume(&mut state, trailing).unwrap().reasoning.is_empty());
            let snapshot = json!({"type":"reasoning","id":"r1","summary":[{"type":"summary_text","text":"summary"}],"content":[{"type":"reasoning_text","text":"raw"}]});
            let item: Item = serde_json::from_value(snapshot.clone()).unwrap();
            state.check_item(0, &item).unwrap();
            for field in ["summary", "content"] {
                let mut wrong = snapshot.clone();
                wrong[field][0]["text"] = json!("changed");
                assert!(state
                    .check_item(0, &serde_json::from_value(wrong).unwrap())
                    .is_err());
            }
            // Nonprojected text still consumes the common parser/content budget.
            let hidden = if first == Kind::Summary {
                json!({"type":"response.reasoning_text.delta","output_index":0,"item_id":"r1","content_index":0,"delta":"x".repeat(55)})
            } else {
                json!({"type":"response.reasoning_summary_text.delta","output_index":0,"item_id":"r1","summary_index":0,"delta":"x".repeat(55)})
            };
            assert_eq!(
                consume(&mut state, hidden)
                    .err()
                    .unwrap()
                    .contract_code
                    .as_deref(),
                Some("output-too-large")
            );
            assert_eq!(state.content_bytes, 10);
        }
    }
    #[test]
    fn empty_reasoning_delta_does_not_select_a_view_or_allow_snapshot_only_text() {
        let mut state = ResponsesStreamState::default();
        consume(&mut state, json!({"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"r1","summary":[]}})).unwrap();
        assert!(consume(&mut state, json!({"type":"response.reasoning_text.delta","output_index":0,"item_id":"r1","content_index":0,"delta":""})).unwrap().reasoning.is_empty());
        assert!(state.items[0].projected_reasoning.is_none());
        let snapshot: Item=serde_json::from_value(json!({"type":"reasoning","id":"r1","summary":[{"type":"summary_text","text":"snapshot only"}],"content":[{"type":"reasoning_text","text":""}]})).unwrap();
        assert!(state.check_item(0, &snapshot).is_err());
    }
    #[test]
    fn refusal_errors_and_nullable_usage_are_explicit() {
        for (event, expected) in [
            (
                json!({"type":"response.refusal.delta","delta":"no"}),
                "content-filtered",
            ),
            (
                json!({"type":"error","code":"rate_limit_exceeded","message":"untrusted secret"}),
                "rate-limited",
            ),
            (
                json!({"type":"response.failed","response":{"status":"failed","error":{"code":"invalid_api_key","message":"untrusted secret"}}}),
                "authentication-failed",
            ),
            (
                json!({"type":"response.failed","response":{"status":"completed"}}),
                "invalid-response",
            ),
        ] {
            let mut state = ResponsesStreamState::default();
            let error = consume(&mut state, event).err().unwrap();
            assert_eq!(error.contract_code.as_deref(), Some(expected));
            assert!(!error.message.contains("untrusted secret"));
        }
        let usage: Usage=serde_json::from_value(json!({"input_tokens":null,"output_tokens":null,"total_tokens":null,"input_tokens_details":null,"output_tokens_details":null})).unwrap();
        let usage: AiExecutionUsage = usage.into();
        assert!(usage.input_tokens.is_none());
        assert!(usage.cached_input_tokens.is_none());
        assert!(usage.reasoning_tokens.is_none());
    }
}
