//! 비밀값(비밀번호·토큰) 보호: 윈도우 DPAPI(현재 윈도우 사용자 계정으로만 풀 수 있는 암호화)로 감싸 저장한다.
//! 저장 파일을 다른 PC나 다른 사용자 계정으로 가져가면 풀 수 없다. 윈도우가 아니면(개발·테스트 환경) 그대로 둔다.

#[cfg(windows)]
use base64::{engine::general_purpose::STANDARD as B64, Engine};

pub const PREFIX: &str = "dpapi:";

#[cfg(windows)]
mod ffi {
    use std::ffi::c_void;
    #[repr(C)]
    pub struct Blob {
        pub len: u32,
        pub data: *mut u8,
    }
    #[link(name = "crypt32")]
    extern "system" {
        pub fn CryptProtectData(input: *const Blob, descr: *const u16, entropy: *const Blob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut Blob) -> i32;
        pub fn CryptUnprotectData(input: *const Blob, descr: *mut *mut u16, entropy: *const Blob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        pub fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }
}

#[cfg(windows)]
const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

#[cfg(windows)]
fn dpapi(input: &[u8], encrypt: bool) -> Option<Vec<u8>> {
    use std::ptr::{null, null_mut};
    let inb = ffi::Blob { len: input.len() as u32, data: input.as_ptr() as *mut u8 };
    let mut out = ffi::Blob { len: 0, data: null_mut() };
    unsafe {
        let ok = if encrypt {
            ffi::CryptProtectData(&inb, null(), null(), null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            ffi::CryptUnprotectData(&inb, null_mut(), null(), null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok == 0 || out.data.is_null() {
            return None;
        }
        let v = std::slice::from_raw_parts(out.data, out.len as usize).to_vec();
        ffi::LocalFree(out.data as *mut _);
        Some(v)
    }
}

/// 평문 → 저장용 문자열("dpapi:..."). 빈 값과 이미 보호된 값은 그대로.
pub fn protect(s: &str) -> String {
    if s.is_empty() || s.starts_with(PREFIX) {
        return s.to_string();
    }
    #[cfg(windows)]
    {
        if let Some(v) = dpapi(s.as_bytes(), true) {
            return format!("{PREFIX}{}", B64.encode(v));
        }
    }
    s.to_string()
}

/// 저장된 문자열 → 평문. 보호되지 않은(예전) 값은 그대로. 풀 수 없으면(다른 PC·계정) 빈 값 → 다시 로그인하면 된다.
pub fn reveal(s: &str) -> String {
    let Some(rest) = s.strip_prefix(PREFIX) else { return s.to_string() };
    #[cfg(windows)]
    {
        if let Ok(bytes) = B64.decode(rest) {
            if let Some(v) = dpapi(&bytes, false) {
                return String::from_utf8(v).unwrap_or_default();
            }
        }
    }
    let _ = rest;
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plain_values_pass_through_and_empty_stays_empty() {
        assert_eq!(reveal("abc"), "abc");
        assert_eq!(protect(""), "");
        assert_eq!(reveal(&protect("secret")), "secret");
    }
}
