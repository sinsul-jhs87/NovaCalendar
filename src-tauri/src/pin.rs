//! 위젯을 바탕화면에 붙여 둔다.
//!
//! - 항상 다른 창 뒤에 있도록 한다(창 옵션 alwaysOnBottom).
//! - Alt+Tab 목록에 나오지 않게 도구 창 속성(WS_EX_TOOLWINDOW)을 준다.
//! - 바탕화면 아이콘을 품은 창(Progman 또는 WorkerW)을 위젯의 '소유자'로 지정한다.
//!   윈도우 10·11의 Win+D(바탕화면 보기)는 창을 최소화하지 않고 바탕화면 창을 맨 앞으로 올리는데,
//!   소유된 창은 늘 소유자 위에 그려지므로 위젯이 함께 보인다. 탐색기가 다시 시작되면 다시 찾아 지정한다.
//! - 위젯을 누르면 바탕화면 소속을 잠시 풀어 다른 창보다 앞으로 나오고, 다른 곳을 누르면 다시 붙는다.
//! - 그래도 최소화·숨김 상태가 되면 곧바로 다시 보이게 한다.
//!   사용자가 트레이에서 일부러 숨긴 경우에는 건드리지 않는다.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static WANT_VISIBLE: AtomicBool = AtomicBool::new(true);
/// 위젯이 지금 눌려서(포커스) 앞에 나와 있는지. 이때는 바탕화면에 다시 붙이지 않는다.
static FOCUSED: AtomicBool = AtomicBool::new(false);

/// 위젯을 보이게 둘지 여부. 트레이에서 숨기면 false.
pub fn set_visible(v: bool) {
    WANT_VISIBLE.store(v, Ordering::SeqCst);
}

#[cfg(windows)]
mod ffi {
    use std::ffi::c_void;
    pub type Hwnd = *mut c_void;
    pub type EnumProc = unsafe extern "system" fn(Hwnd, isize) -> i32;
    #[link(name = "user32")]
    extern "system" {
        pub fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
        pub fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
        pub fn SetWindowPos(hwnd: Hwnd, insert_after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        pub fn ShowWindow(hwnd: Hwnd, cmd: i32) -> i32;
        pub fn IsIconic(hwnd: Hwnd) -> i32;
        pub fn IsWindowVisible(hwnd: Hwnd) -> i32;
        pub fn EnumWindows(cb: EnumProc, lparam: isize) -> i32;
        pub fn FindWindowExW(parent: Hwnd, after: Hwnd, class: *const u16, title: *const u16) -> Hwnd;
    }
}

/// 바탕화면 아이콘 목록(SHELLDLL_DefView)을 품고 있는 최상위 창. 보통 Progman, 배경 슬라이드쇼 등에서는 WorkerW.
#[cfg(windows)]
fn desktop_host() -> ffi::Hwnd {
    unsafe extern "system" fn cb(h: ffi::Hwnd, lp: isize) -> i32 {
        let class: Vec<u16> = "SHELLDLL_DefView".encode_utf16().chain(Some(0)).collect();
        if !ffi::FindWindowExW(h, std::ptr::null_mut(), class.as_ptr(), std::ptr::null()).is_null() {
            *(lp as *mut isize) = h as isize;
            return 0; // 찾았으니 그만 훑는다
        }
        1
    }
    let mut found: isize = 0;
    unsafe {
        ffi::EnumWindows(cb, &mut found as *mut isize as isize);
    }
    found as ffi::Hwnd
}

#[cfg(windows)]
pub fn install(app: &AppHandle) {
    use std::time::Duration;
    use tauri::Manager;

    const GWL_EXSTYLE: i32 = -20;
    const GWLP_HWNDPARENT: i32 = -8;
    const WS_EX_TOOLWINDOW: isize = 0x80;
    const SW_HIDE: i32 = 0;
    const SW_SHOWNOACTIVATE: i32 = 4;
    const HWND_BOTTOM: isize = 1;
    const SWP_NOSIZE_NOMOVE_NOACTIVATE: u32 = 0x1 | 0x2 | 0x10;

    let Some(win) = app.get_webview_window("main") else { return };
    std::thread::spawn(move || {
        let mut styled = false;
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            if !WANT_VISIBLE.load(Ordering::SeqCst) {
                continue;
            }
            let Ok(h) = win.hwnd() else { continue };
            let hwnd = (h.0 as isize) as ffi::Hwnd;
            unsafe {
                if !styled {
                    let ex = ffi::GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                    if ex & WS_EX_TOOLWINDOW == 0 {
                        ffi::SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW);
                        // 스타일 변경을 적용하려면 한 번 숨겼다가 다시 보여야 한다.
                        ffi::ShowWindow(hwnd, SW_HIDE);
                        ffi::ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    }
                    styled = true;
                }
                // 약 3초마다 바탕화면 창을 다시 찾아 소유자로 지정한다(탐색기 재시작 대비).
                if tick % 4 == 0 && !FOCUSED.load(Ordering::SeqCst) {
                    let host = desktop_host();
                    if !host.is_null() && ffi::GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT) != host as isize {
                        ffi::SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, host as isize);
                        ffi::SetWindowPos(hwnd, HWND_BOTTOM as ffi::Hwnd, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE);
                    }
                }
                tick = tick.wrapping_add(1);
                if ffi::IsIconic(hwnd) != 0 || ffi::IsWindowVisible(hwnd) == 0 {
                    ffi::ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    ffi::SetWindowPos(hwnd, HWND_BOTTOM as ffi::Hwnd, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE);
                }
            }
        }
    });
}

/// 위젯을 누르면(포커스를 얻으면) 바탕화면 소속을 잠시 풀고 다른 창보다 앞으로 꺼낸다.
/// 다른 곳을 누르면(포커스를 잃으면) 다시 바탕화면에 붙인다. 그래서 Win+D에서도 사라지지 않는다.
#[cfg(windows)]
pub fn on_focus(win: &tauri::Window, focused: bool) {
    const GWLP_HWNDPARENT: i32 = -8;
    const HWND_TOP: isize = 0;
    const SWP_NOSIZE_NOMOVE_NOACTIVATE: u32 = 0x1 | 0x2 | 0x10;
    FOCUSED.store(focused, Ordering::SeqCst);
    let Ok(h) = win.hwnd() else { return };
    let hwnd = (h.0 as isize) as ffi::Hwnd;
    if focused {
        let _ = win.set_always_on_bottom(false);
        unsafe {
            ffi::SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
            ffi::SetWindowPos(hwnd, HWND_TOP as ffi::Hwnd, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE);
        }
    } else {
        let host = desktop_host();
        unsafe {
            if !host.is_null() {
                ffi::SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, host as isize);
            }
        }
        let _ = win.set_always_on_bottom(true);
    }
}

#[cfg(not(windows))]
pub fn on_focus(_win: &tauri::Window, _focused: bool) {}

#[cfg(not(windows))]
pub fn install(_app: &AppHandle) {}
