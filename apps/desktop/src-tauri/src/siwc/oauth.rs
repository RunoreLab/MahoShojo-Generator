use std::{collections::HashMap, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Deserialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use url::Url;

use super::{error, Error, ErrorCode};

const ISSUER: &str = "https://auth.openai.com";
const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const JWKS: &str = "https://auth.openai.com/.well-known/jwks.json";
const DISCOVERY: &str = "https://auth.openai.com/.well-known/openid-configuration";
const RESOURCE: &str = "https://api.openai.com/v1";
const REGISTRATION: &str = "dynamic_agent_client";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub(super) const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const CALLBACK: &str = "/auth/callback";
const MAX_CALLBACK_BYTES: usize = 16 * 1024;
const MAX_OAUTH_BYTES: usize = 128 * 1024;

pub(super) fn client() -> Result<Client, Error> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| error(ErrorCode::Unavailable))
}

fn random() -> Result<String, Error> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| error(ErrorCode::Unavailable))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub(super) fn issued_client_id(value: &str) -> bool {
    value.starts_with("oaiapp_")
        && value.len() > 7
        && value.len() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub(super) struct Authorization {
    pub(super) url: Url,
    pub(super) nonce: String,
    verifier: String,
    state: String,
    redirect: String,
    host: String,
    saved_client: Option<String>,
}

impl Authorization {
    pub(super) fn new(
        port: u16,
        host_id: &str,
        saved: Option<(&str, Option<&str>)>,
    ) -> Result<Self, Error> {
        let host = format!("127.0.0.1:{port}");
        let redirect = format!("http://{host}{CALLBACK}");
        let state = random()?;
        let nonce = random()?;
        let verifier = random()?;
        let challenge = crate::cloud::pkce_challenge(&verifier);
        let mut url = Url::parse(AUTHORIZE).expect("fixed SIWC authorization endpoint");
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("client_id", saved.map_or(REGISTRATION, |(id, _)| id))
                .append_pair("response_type", "code")
                .append_pair("redirect_uri", &redirect)
                .append_pair("scope", SCOPE)
                .append_pair("resource", RESOURCE)
                .append_pair("ext_agent_host_id", host_id)
                .append_pair("state", &state)
                .append_pair("nonce", &nonce)
                .append_pair("code_challenge", &challenge)
                .append_pair("code_challenge_method", "S256");
            if let Some((_, hint)) = saved {
                // Explicitly requested reauthorization. The hint stays in the system browser.
                query.append_pair("prompt", "consent");
                if let Some(hint) = hint {
                    query.append_pair("id_token_hint", hint);
                }
            } else {
                query.append_pair("agent_name_hint", "MahoShojo Generator");
            }
        }
        Ok(Self {
            url,
            nonce,
            verifier,
            state,
            redirect,
            host,
            saved_client: saved.map(|(id, _)| id.to_owned()),
        })
    }

    fn callback(&self, headers: &str) -> Option<Result<(String, String), Error>> {
        let mut lines = headers.split("\r\n");
        let mut request = lines.next()?.split_ascii_whitespace();
        if request.next()? != "GET" {
            return None;
        }
        let path = request.next()?;
        if !matches!(request.next()?, "HTTP/1.0" | "HTTP/1.1") || request.next().is_some() {
            return None;
        }
        let mut hosts = lines.filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case("host").then_some(value.trim())
        });
        if hosts.next()? != self.host || hosts.next().is_some() {
            return None;
        }
        if path.split_once('?')?.0 != CALLBACK {
            return None;
        }
        let callback = Url::parse(&format!("http://{}{path}", self.host)).ok()?;
        if callback.fragment().is_some() {
            return None;
        }
        let mut fields = HashMap::new();
        for (key, value) in callback.query_pairs() {
            if matches!(
                key.as_ref(),
                "code" | "state" | "client_id" | "error" | "iss"
            ) && fields.insert(key, value).is_some()
            {
                return None;
            }
        }
        if fields.get("state")?.as_ref() != self.state {
            return None;
        }
        if fields.get("iss").is_some_and(|iss| iss.as_ref() != ISSUER) {
            return Some(Err(error(ErrorCode::InvalidResponse)));
        }
        if fields.contains_key("error") {
            return Some(Err(error(ErrorCode::ConsentDeclined)));
        }
        let client = match (&self.saved_client, fields.get("client_id")) {
            (Some(id), None) => id.as_str(),
            (Some(id), Some(issued)) if id == issued.as_ref() => id.as_str(),
            (None, Some(issued)) if issued_client_id(issued) => issued.as_ref(),
            _ => return Some(Err(error(ErrorCode::InvalidResponse))),
        };
        let code = fields
            .get("code")
            .map(|value| value.as_ref())
            .unwrap_or_default();
        if !valid_token(code) || code.len() > 2_048 {
            return Some(Err(error(ErrorCode::InvalidResponse)));
        }
        Some(Ok((code.to_owned(), client.to_owned())))
    }

    pub(super) async fn listen(&self, listener: TcpListener) -> Result<(String, String), Error> {
        loop {
            let (mut stream, _) = listener
                .accept()
                .await
                .map_err(|_| error(ErrorCode::Unavailable))?;
            let header = tokio::time::timeout(Duration::from_secs(2), async {
                let mut header = Vec::new();
                let mut buffer = [0; 1024];
                while header.len() < MAX_CALLBACK_BYTES {
                    let len = stream.read(&mut buffer).await.ok()?;
                    if len == 0 {
                        return None;
                    }
                    header.extend_from_slice(&buffer[..len]);
                    if let Some(end) = header.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                        return String::from_utf8(header[..end].to_vec()).ok();
                    }
                }
                None
            })
            .await
            .ok()
            .flatten();
            let result = header.as_deref().and_then(|header| self.callback(header));
            let (status, body) = if result.is_some() {
                ("200 OK", "已收到授权回调。请返回魔法少女生成器查看结果。")
            } else {
                ("400 Bad Request", "回调与当前授权请求不匹配。")
            };
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                stream.write_all(response.as_bytes()),
            )
            .await;
            if let Some(result) = result {
                return result;
            }
        }
    }

    pub(super) async fn exchange(
        &self,
        http: &Client,
        code: &str,
        client: &str,
    ) -> Result<TokenReply, Error> {
        token_request(
            http,
            &[
                ("grant_type", "authorization_code"),
                ("client_id", client),
                ("code", code),
                ("code_verifier", &self.verifier),
                ("redirect_uri", &self.redirect),
                ("resource", RESOURCE),
            ],
        )
        .await
    }
}

#[derive(Deserialize)]
pub(super) struct TokenReply {
    pub(super) id_token: Option<String>,
    pub(super) access_token: Option<String>,
    pub(super) refresh_token: Option<String>,
    pub(super) token_type: Option<String>,
    pub(super) expires_in: Option<u64>,
    pub(super) scope: Option<String>,
    pub(super) earliest_refresh_at: Option<serde_json::Value>,
}

async fn token_request(http: &Client, pairs: &[(&str, &str)]) -> Result<TokenReply, Error> {
    let body: String = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs.iter().copied())
        .finish();
    let response = http
        .post(TOKEN)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|_| error(ErrorCode::Unavailable))?;
    if response.status() == StatusCode::BAD_REQUEST {
        #[derive(Deserialize)]
        struct Rejection {
            error: Option<String>,
        }
        let reply: Rejection = json_body(response, MAX_OAUTH_BYTES).await?;
        if matches!(
            reply.error.as_deref(),
            Some(
                "invalid_grant"
                    | "invalid_refresh_token"
                    | "token_expired"
                    | "refresh_token_expired"
                    | "refresh_token_invalidated"
                    | "refresh_token_reused"
            )
        ) {
            return Err(error(ErrorCode::ReauthorizationRequired));
        }
        return Err(error(ErrorCode::InvalidResponse));
    }
    match response.status() {
        StatusCode::OK => json_body(response, MAX_OAUTH_BYTES).await,
        StatusCode::UNAUTHORIZED => Err(error(ErrorCode::ReauthorizationRequired)),
        StatusCode::FORBIDDEN => Err(error(ErrorCode::Ineligible)),
        _ => Err(error(ErrorCode::Unavailable)),
    }
}

pub(super) async fn refresh(http: &Client, client: &str, token: &str) -> Result<TokenReply, Error> {
    token_request(
        http,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", client),
            ("refresh_token", token),
            ("resource", RESOURCE),
        ],
    )
    .await
}

pub(super) fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 24 * 1024
        && value.bytes().all(|byte| byte.is_ascii_graphic())
}

pub(super) async fn json_body<T: DeserializeOwned>(
    mut response: reqwest::Response,
    max: usize,
) -> Result<T, Error> {
    use zeroize::Zeroizing;

    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| error(ErrorCode::Unavailable))?
    {
        if bytes.len().saturating_add(chunk.len()) > max {
            return Err(error(ErrorCode::InvalidResponse));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| error(ErrorCode::InvalidResponse))
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

#[derive(Deserialize)]
pub(super) struct Identity {
    pub(super) sub: String,
    pub(super) email: Option<String>,
    pub(super) name: Option<String>,
    aud: Audience,
    azp: Option<String>,
    nonce: Option<String>,
    iat: u64,
}

fn verify_token(
    token: &str,
    jwks: &JwkSet,
    client: &str,
    nonce: &str,
    expected_sub: Option<&str>,
    first: bool,
) -> Result<Identity, Error> {
    let invalid = || error(ErrorCode::InvalidIdentity);
    let header = decode_header(token).map_err(|_| invalid())?;
    if !matches!(header.alg, Algorithm::RS256 | Algorithm::ES256) {
        return Err(invalid());
    }
    let key = jwks
        .find(header.kid.as_deref().ok_or_else(invalid)?)
        .ok_or_else(|| error(ErrorCode::Unavailable))?;
    let key = DecodingKey::from_jwk(key).map_err(|_| invalid())?;
    let mut validation = Validation::new(header.alg);
    validation.leeway = 30;
    validation.set_required_spec_claims(&["iss", "aud", "exp", "sub"]);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client]);
    validation.validate_nbf = true;
    let identity = decode::<Identity>(token, &key, &validation)
        .map_err(|_| invalid())?
        .claims;
    let audience_ok = match &identity.aud {
        Audience::One(value) => value == client,
        Audience::Many(values) => {
            values.iter().any(|value| value == client)
                && (values.len() == 1 || identity.azp.as_deref() == Some(client))
        }
    };
    if !audience_ok
        || identity.azp.as_deref().is_some_and(|azp| azp != client)
        || identity.sub.is_empty()
        || identity.sub.len() > 512
        || identity.sub.chars().any(char::is_control)
        || (first && identity.nonce.as_deref() != Some(nonce))
        || identity
            .nonce
            .as_deref()
            .is_some_and(|value| value != nonce)
        || expected_sub.is_some_and(|expected| expected != identity.sub)
        || identity.iat > super::now().saturating_add(30)
    {
        return Err(invalid());
    }
    Ok(identity)
}

pub(super) async fn verify_identity(
    http: &Client,
    token: &str,
    client: &str,
    nonce: &str,
    expected_sub: Option<&str>,
    first: bool,
) -> Result<Identity, Error> {
    if !valid_token(token) {
        return Err(error(ErrorCode::InvalidIdentity));
    }
    let response = http
        .get(JWKS)
        .send()
        .await
        .map_err(|_| error(ErrorCode::Unavailable))?;
    if !response.status().is_success() {
        return Err(error(ErrorCode::Unavailable));
    }
    let keys = json_body(response, MAX_OAUTH_BYTES)
        .await
        .map_err(|_| error(ErrorCode::Unavailable))?;
    verify_token(token, &keys, client, nonce, expected_sub, first)
}

pub(super) async fn revoke(http: &Client, client: &str, token: &str) -> Result<(), Error> {
    #[derive(Deserialize)]
    struct Discovery {
        issuer: String,
        revocation_endpoint: String,
    }
    let response = http
        .get(DISCOVERY)
        .send()
        .await
        .map_err(|_| error(ErrorCode::Unavailable))?;
    if !response.status().is_success() {
        return Err(error(ErrorCode::Unavailable));
    }
    let metadata: Discovery = json_body(response, MAX_OAUTH_BYTES).await?;
    let endpoint =
        Url::parse(&metadata.revocation_endpoint).map_err(|_| error(ErrorCode::InvalidResponse))?;
    if metadata.issuer != ISSUER
        || endpoint.origin().ascii_serialization() != ISSUER
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(error(ErrorCode::InvalidResponse));
    }
    let body: String = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("token", token),
            ("token_type_hint", "refresh_token"),
            ("client_id", client),
        ])
        .finish();
    let response = http
        .post(endpoint)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|_| error(ErrorCode::Unavailable))?;
    if response.status() == StatusCode::OK {
        Ok(())
    } else {
        Err(error(ErrorCode::Unavailable))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn completes_an_http_loopback_and_keeps_the_code_out_of_the_browser_page() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let flow = Authorization::new(address.port(), "urn:uuid:test", None).unwrap();
        let (returned, browser) = tokio::join!(flow.listen(listener), async {
            let mut browser = tokio::net::TcpStream::connect(address).await.unwrap();
            browser.write_all(format!("GET /auth/callback?state={}&code=synthetic-code&client_id=oaiapp_demo HTTP/1.1\r\nHost: {address}\r\n\r\n", flow.state).as_bytes()).await.unwrap();
            let mut result = String::new();
            browser.read_to_string(&mut result).await.unwrap();
            result
        });
        assert_eq!(
            returned.unwrap(),
            ("synthetic-code".to_owned(), "oaiapp_demo".to_owned())
        );
        assert!(browser.starts_with("HTTP/1.1 200 OK"));
        assert!(!browser.contains("synthetic-code"));
    }

    #[test]
    fn verifies_a_signed_identity_against_the_saved_client_nonce_and_account() {
        use aws_lc_rs::signature::{EcdsaKeyPair, KeyPair as _, ECDSA_P256_SHA256_FIXED_SIGNING};
        use jsonwebtoken::{encode, EncodingKey, Header};
        use serde_json::json;

        let signing = EcdsaKeyPair::generate(&ECDSA_P256_SHA256_FIXED_SIGNING).unwrap();
        let key = signing.to_pkcs8v1().unwrap();
        let public = signing.public_key().as_ref();
        let keys = serde_json::from_value(json!({"keys":[{"kty":"EC","crv":"P-256","kid":"synthetic","alg":"ES256",
            "x": URL_SAFE_NO_PAD.encode(&public[1..33]), "y": URL_SAFE_NO_PAD.encode(&public[33..65])}]})).unwrap();
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some("synthetic".into());
        let token = encode(
            &header,
            &json!({"iss":ISSUER,"sub":"synthetic-account","aud":"oaiapp_example",
            "nonce":"request-nonce","iat":super::super::now(),"exp":super::super::now()+600}),
            &EncodingKey::from_ec_der(key.as_ref()),
        )
        .unwrap();
        assert!(verify_token(
            &token,
            &keys,
            "oaiapp_example",
            "request-nonce",
            Some("synthetic-account"),
            true
        )
        .is_ok());
        assert!(verify_token(&token, &keys, "oaiapp_other", "request-nonce", None, true).is_err());
        assert!(verify_token(&token, &keys, "oaiapp_example", "other-nonce", None, true).is_err());
        assert!(verify_token(
            &token,
            &keys,
            "oaiapp_example",
            "request-nonce",
            Some("other-account"),
            false
        )
        .is_err());
    }

    #[test]
    fn callback_binds_host_state_and_issued_client() {
        let flow = Authorization::new(1234, "urn:uuid:test", None).unwrap();
        let attempt = |host: &str, state: &str, query: &str| {
            flow.callback(&format!(
                "GET /auth/callback?state={state}&{query} HTTP/1.1\r\nHost: {host}\r\n"
            ))
        };
        assert!(attempt(
            "127.0.0.1:1234",
            &flow.state,
            "code=only&client_id=oaiapp_demo"
        )
        .unwrap()
        .is_ok());
        assert!(attempt(
            "localhost:1234",
            &flow.state,
            "code=only&client_id=oaiapp_demo"
        )
        .is_none());
        assert!(attempt(
            "127.0.0.1:1234",
            "another-state",
            "code=only&client_id=oaiapp_demo"
        )
        .is_none());
        assert!(attempt(
            "127.0.0.1:1234",
            &flow.state,
            "code=one&code=two&client_id=oaiapp_demo"
        )
        .is_none());
        assert!(attempt(
            "127.0.0.1:1234",
            &flow.state,
            "code=only&client_id=dynamic_agent_client"
        )
        .unwrap()
        .is_err());
        assert_eq!(
            attempt("127.0.0.1:1234", &flow.state, "error=access_denied")
                .unwrap()
                .unwrap_err()
                .code,
            ErrorCode::ConsentDeclined
        );
    }
}
