use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{error, Error, ErrorCode};

const MAX_BYTES: usize = 256 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Grant {
    pub(super) access: String,
    pub(super) refresh: String,
    pub(super) scope: String,
    pub(super) expires_at: u64,
    pub(super) earliest_refresh_at: u64,
    pub(super) pending_identity: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Connection {
    pub(super) id: String,
    pub(super) client_id: String,
    pub(super) subject: String,
    pub(super) label: String,
    pub(super) nonce: String,
    pub(super) identity_hint: Option<String>,
    pub(super) grant: Option<Grant>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Saved {
    version: u8,
    pub(super) host_id: String,
    pub(super) connection: Option<Connection>,
}

impl Saved {
    pub(super) fn load(path: &Path) -> Result<Self, Error> {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self {
                    version: 1,
                    host_id: format!("urn:uuid:{}", uuid::Uuid::new_v4()),
                    connection: None,
                });
            }
            Err(_) => return Err(super::error(ErrorCode::Storage)),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| error(ErrorCode::Storage))?;
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return Err(error(ErrorCode::Storage));
        }
        let plaintext = protect(&mut bytes, false)?;
        let saved: Self =
            serde_json::from_slice(&plaintext).map_err(|_| error(ErrorCode::Storage))?;
        if saved.version != 1
            || saved
                .host_id
                .strip_prefix("urn:uuid:")
                .and_then(|id| uuid::Uuid::parse_str(id).ok())
                .is_none()
        {
            return Err(error(ErrorCode::Storage));
        }
        Ok(saved)
    }

    pub(super) fn save(&self, path: &Path) -> Result<(), Error> {
        let mut plaintext =
            Zeroizing::new(serde_json::to_vec(self).map_err(|_| error(ErrorCode::Storage))?);
        if plaintext.len() > MAX_BYTES {
            return Err(error(ErrorCode::Storage));
        }
        let sealed = protect(&mut plaintext, true)?;
        let directory = path.parent().ok_or_else(|| error(ErrorCode::Storage))?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(directory).map_err(|_| error(ErrorCode::Storage))?;
        temporary
            .write_all(&sealed)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|_| error(ErrorCode::Storage))?;
        temporary
            .persist(path)
            .map_err(|_| error(ErrorCode::Storage))?;
        Ok(())
    }
}

#[cfg(windows)]
fn protect(bytes: &mut [u8], encrypt: bool) -> Result<Zeroizing<Vec<u8>>, Error> {
    use std::ptr::null;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    use zeroize::Zeroize;

    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: input and output blobs live through the call. DPAPI owns the returned allocation
    // until LocalFree. No machine-scope flag is passed, and no UI may be opened.
    let ok = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if output.pbData.is_null() {
        return Err(error(ErrorCode::Storage));
    }
    // SAFETY: the non-null pointer and length were supplied by DPAPI. Free exactly once.
    let result = unsafe {
        let data = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let result = (ok != 0 && !data.is_empty() && data.len() <= MAX_BYTES)
            .then(|| Zeroizing::new(data.to_vec()));
        data.zeroize();
        LocalFree(output.pbData.cast());
        result
    };
    result.ok_or_else(|| error(ErrorCode::Storage))
}

#[cfg(not(windows))]
fn protect(_: &mut [u8], _: bool) -> Result<Zeroizing<Vec<u8>>, Error> {
    Err(error(ErrorCode::UnsupportedPlatform))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn protects_a_rotating_record_larger_than_wincred_and_reopens_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("siwc.dpapi");
        let mut saved = Saved::load(&path).unwrap();
        let host_id = saved.host_id.clone();
        saved.connection = Some(Connection {
            id: "sample-connection".into(),
            client_id: "oaiapp_sample".into(),
            subject: "sample-sub".into(),
            label: "sample-account".into(),
            nonce: "sample-nonce".into(),
            identity_hint: None,
            grant: Some(Grant {
                access: "sample-long-token".repeat(600),
                refresh: "sample-rotation-one".into(),
                scope: "sample-scope".into(),
                expires_at: 100,
                earliest_refresh_at: 50,
                pending_identity: None,
            }),
        });
        saved.save(&path).unwrap();
        let encrypted = std::fs::read(&path).unwrap();
        assert!(!encrypted
            .windows(b"sample-long-token".len())
            .any(|part| part == b"sample-long-token"));
        let mut reopened = Saved::load(&path).unwrap();
        assert_eq!(reopened.host_id, host_id);
        reopened
            .connection
            .as_mut()
            .unwrap()
            .grant
            .as_mut()
            .unwrap()
            .refresh = "sample-rotation-two".into();
        reopened.save(&path).unwrap();
        assert_eq!(
            Saved::load(&path)
                .unwrap()
                .connection
                .unwrap()
                .grant
                .unwrap()
                .refresh,
            "sample-rotation-two"
        );
        std::fs::write(&path, b"not an encrypted vault").unwrap();
        assert_eq!(Saved::load(&path).err().unwrap().code, ErrorCode::Storage);
    }
}
