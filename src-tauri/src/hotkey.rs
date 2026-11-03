//! 빠른 입력 전역 단축키(Ctrl+Alt+N): 어떤 프로그램을 쓰고 있어도 위젯을 앞으로 띄우고 빠른 입력 창을 연다.
//! 새 라이브러리 없이 윈도우 RegisterHotKey 를 쓴다(전용 스레드에서 메시지를 받는다).

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

static REGISTERED: AtomicBool = AtomicBool::new(false);

/// 단축키가 등록됐는지(다른 프로그램이 이미 쓰고 있으면 false)
pub fn registered() -> bool {
    REGISTERED.load(Ordering::SeqCst)
}

#[cfg(windows)]
mod ffi {
    #[repr(C)]
    pub struct Msg {
        pub hwnd: isize,
        pub message: u32,
        pub wparam: usize,
        pub lparam: isize,
        pub time: u32,
        pub pt_x: i32,
        pub pt_y: i32,
        pub private: u32,
    }
    #[link(name = "user32")]
    extern "system" {
        pub fn RegisterHotKey(hwnd: isize, id: i32, modifiers: u32, vk: u32) -> i32;
        pub fn GetMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32) -> i32;
    }
}

#[cfg(windows)]
pub fn install(app: AppHandle) {
    const MOD_ALT: u32 = 0x0001;
    const MOD_CONTROL: u32 = 0x0002;
    const MOD_NOREPEAT: u32 = 0x4000;
    const WM_HOTKEY: u32 = 0x0312;
    const VK_N: u32 = 0x4E;
    std::thread::spawn(move || unsafe {
        // 등록한 스레드에서만 WM_HOTKEY 를 받는다
        if ffi::RegisterHotKey(0, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_N) == 0 {
            eprintln!("빠른 입력 단축키(Ctrl+Alt+N)를 등록하지 못했습니다(다른 프로그램이 쓰는 중).");
            return;
        }
        REGISTERED.store(true, Ordering::SeqCst);
        let mut msg: ffi::Msg = std::mem::zeroed();
        while ffi::GetMessageW(&mut msg, 0, 0, 0) > 0 {
            if msg.message == WM_HOTKEY {
                crate::show_widget(&app, false);
                let _ = app.emit("quick-add", ());
            }
        }
    });
}

#[cfg(not(windows))]
pub fn install(_app: AppHandle) {}
