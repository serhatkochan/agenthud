use super::{
    close_rect, current_frame, dip, percent_text, toggle_rect, wide, Frame, Line, CLOSE_SPACE,
    COMPACT_BRAND, COMPACT_HEIGHT, GROUP_HEIGHT, HEADER_HEIGHT, ROW_HEIGHT,
};
use crate::quota_view::CompactQuota;
use std::ffi::c_void;
use windows_sys::Win32::{
    Foundation::{COLORREF, HWND, POINT, RECT, SIZE},
    Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, CreateDIBSection, CreateFontW,
        CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, FillRect, GetDC, GetDIBits, ReleaseDC,
        SelectObject, SetBkMode, SetTextColor, AC_SRC_ALPHA, ANTIALIASED_QUALITY, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_CENTER,
        DT_END_ELLIPSIS, DT_LEFT, DT_RIGHT, DT_SINGLELINE, DT_VCENTER, FW_NORMAL, FW_SEMIBOLD, HDC,
        HFONT, TRANSPARENT,
    },
    UI::{
        HiDpi::GetDpiForWindow,
        WindowsAndMessaging::{GetWindowRect, UpdateLayeredWindow, ULW_ALPHA},
    },
};

fn tone(line: &Line) -> COLORREF {
    value_tone(line.remaining, line.disabled)
}

fn value_tone(remaining: Option<f64>, disabled: bool) -> COLORREF {
    if disabled {
        return rgb(0x9B, 0xAA, 0xA3);
    }
    match remaining {
        Some(value) if value < 20.0 => rgb(0xFF, 0xB4, 0xA9),
        Some(value) if value < 50.0 => rgb(0xF4, 0xD2, 0x9B),
        Some(_) => rgb(0xB7, 0xE2, 0xC9),
        None => rgb(0xAA, 0xBE, 0xB3),
    }
}

fn rgb(red: u8, green: u8, blue: u8) -> COLORREF {
    red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
}

pub(super) fn present(hwnd: HWND) {
    unsafe {
        let mut window = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        GetWindowRect(hwnd, &mut window);
        let width = window.right - window.left;
        let height = window.bottom - window.top;
        if width < 2 || height < 2 {
            return;
        }
        let screen = GetDC(std::ptr::null_mut());
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..BITMAPINFOHEADER::default()
            },
            ..BITMAPINFO::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let glass = CreateDIBSection(
            screen,
            &info,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        if glass.is_null() || bits.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen);
            return;
        }
        let count = (width * height) as usize;
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u32, count);
        let dpi = GetDpiForWindow(hwnd).max(96);
        fill_island(pixels, width, height, dip(22, dpi));
        let memory = CreateCompatibleDC(screen);
        let mask_bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous_mask = SelectObject(memory, mask_bitmap as _);
        let black = CreateSolidBrush(rgb(0, 0, 0));
        let full = RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        };
        FillRect(memory, &full, black);
        SetBkMode(memory, TRANSPARENT as i32);
        let font_text = font(dip(12, dpi), FW_NORMAL as i32);
        let font_header = font(dip(12, dpi), FW_SEMIBOLD as i32);
        let font_value = font(dip(13, dpi), FW_SEMIBOLD as i32);
        let font_small = font(dip(10, dpi), FW_NORMAL as i32);
        let original_font = SelectObject(memory, font_text as _);
        let frame = current_frame();
        paint_header(hwnd, memory, width, dpi, &frame, font_header);
        if frame.collapsed {
            paint_summary(memory, width, dpi, &frame.summary, font_small, font_value);
        } else {
            paint_expanded(
                memory,
                width,
                dpi,
                &frame.lines,
                font_text,
                font_header,
                font_value,
            );
        }
        SelectObject(memory, original_font);
        SelectObject(memory, previous_mask);
        let mut mask = vec![0u32; count];
        GetDIBits(
            screen,
            mask_bitmap,
            0,
            height as u32,
            mask.as_mut_ptr() as *mut c_void,
            &mut info,
            DIB_RGB_COLORS,
        );
        composite(pixels, &mask);
        let previous = SelectObject(memory, glass as _);
        let destination = POINT {
            x: window.left,
            y: window.top,
        };
        let origin = POINT { x: 0, y: 0 };
        let size = SIZE {
            cx: width,
            cy: height,
        };
        let blend = BLENDFUNCTION {
            BlendOp: 0,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        UpdateLayeredWindow(
            hwnd,
            std::ptr::null_mut(),
            &destination,
            &size,
            memory,
            &origin,
            0,
            &blend,
            ULW_ALPHA,
        );
        SelectObject(memory, previous);
        DeleteObject(font_text as _);
        DeleteObject(font_header as _);
        DeleteObject(font_value as _);
        DeleteObject(font_small as _);
        DeleteObject(black as _);
        DeleteObject(mask_bitmap as _);
        DeleteObject(glass as _);
        DeleteDC(memory);
        ReleaseDC(std::ptr::null_mut(), screen);
    }
}

unsafe fn paint_header(
    hwnd: HWND,
    dc: HDC,
    width: i32,
    dpi: u32,
    frame: &Frame,
    header_font: HFONT,
) {
    let height = dip(
        if frame.collapsed {
            COMPACT_HEIGHT
        } else {
            HEADER_HEIGHT
        },
        dpi,
    );
    SelectObject(dc, header_font as _);
    SetTextColor(dc, rgb(0xE0, 0xEA, 0xE4));
    paint_text(
        dc,
        "AgentHUD",
        RECT {
            left: dip(15, dpi),
            top: 0,
            right: dip(92, dpi),
            bottom: height,
        },
        DT_LEFT | DT_VCENTER | DT_SINGLELINE,
    );
    let toggle = toggle_rect(hwnd);
    SetTextColor(dc, rgb(0xBA, 0xCC, 0xC1));
    paint_text(
        dc,
        if frame.collapsed { "+" } else { "−" },
        RECT {
            left: toggle.left,
            top: toggle.top,
            right: toggle.right,
            bottom: toggle.bottom,
        },
        DT_CENTER | DT_VCENTER | DT_SINGLELINE,
    );
    let close = close_rect(hwnd);
    paint_text(
        dc,
        "×",
        RECT {
            left: close.left,
            top: close.top,
            right: close.right,
            bottom: close.bottom,
        },
        DT_CENTER | DT_VCENTER | DT_SINGLELINE,
    );
    if !frame.collapsed {
        rule(
            dc,
            RECT {
                left: dip(14, dpi),
                top: height - 1,
                right: width - dip(14, dpi),
                bottom: height,
            },
            rgb(0x42, 0x54, 0x4A),
        );
    }
}

unsafe fn paint_expanded(
    dc: HDC,
    width: i32,
    dpi: u32,
    rows: &[Line],
    text_font: HFONT,
    header_font: HFONT,
    value_font: HFONT,
) {
    let mut top = dip(HEADER_HEIGHT, dpi);
    let format = DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS;
    for (index, line) in rows.iter().enumerate() {
        let height = dip(
            if line.header {
                GROUP_HEIGHT
            } else {
                ROW_HEIGHT
            },
            dpi,
        );
        let right = width - dip(76, dpi);
        if line.header {
            if index > 0 {
                rule(
                    dc,
                    RECT {
                        left: dip(14, dpi),
                        top: top + dip(3, dpi),
                        right: width - dip(14, dpi),
                        bottom: top + dip(3, dpi) + 1,
                    },
                    rgb(0x35, 0x46, 0x3D),
                );
            }
            SelectObject(dc, header_font as _);
            SetTextColor(dc, rgb(0xAD, 0xC3, 0xB6));
        } else {
            SelectObject(dc, text_font as _);
            SetTextColor(
                dc,
                if line.disabled {
                    rgb(0x9B, 0xAA, 0xA3)
                } else {
                    rgb(0xDC, 0xE5, 0xDF)
                },
            );
        }
        paint_text(
            dc,
            &line.text,
            RECT {
                left: dip(if line.header { 15 } else { 23 }, dpi),
                top: top + if line.header { dip(6, dpi) } else { 0 },
                right: if line.header {
                    width - dip(15, dpi)
                } else {
                    right
                },
                bottom: top + height,
            },
            format,
        );
        if !line.header && (line.remaining.is_some() || line.disabled) {
            SelectObject(dc, if line.disabled { text_font } else { value_font } as _);
            SetTextColor(dc, tone(line));
            let value = if line.disabled {
                "Kapalı".into()
            } else {
                percent_text(line.remaining)
            };
            paint_text(
                dc,
                &value,
                RECT {
                    left: right,
                    top,
                    right: width - dip(16, dpi),
                    bottom: top + height,
                },
                DT_RIGHT | DT_VCENTER | DT_SINGLELINE,
            );
        }
        top += height;
    }
}

unsafe fn paint_summary(
    dc: HDC,
    width: i32,
    dpi: u32,
    rows: &[CompactQuota],
    small_font: HFONT,
    value_font: HFONT,
) {
    let start = dip(COMPACT_BRAND, dpi);
    let end = width - dip(CLOSE_SPACE, dpi);
    let count = rows.len().max(1) as i32;
    let format = DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS;
    for (index, quota) in rows.iter().enumerate() {
        let left = start + (end - start) * index as i32 / count;
        let right = start + (end - start) * (index as i32 + 1) / count;
        rule(
            dc,
            RECT {
                left,
                top: dip(11, dpi),
                right: left + 1,
                bottom: dip(COMPACT_HEIGHT - 11, dpi),
            },
            rgb(0x3B, 0x4E, 0x42),
        );
        SelectObject(dc, small_font as _);
        SetTextColor(dc, rgb(0xBA, 0xCC, 0xC1));
        paint_text(
            dc,
            quota.name,
            RECT {
                left: left + dip(11, dpi),
                top: dip(5, dpi),
                right: right - dip(6, dpi),
                bottom: dip(22, dpi),
            },
            format,
        );
        let rect = RECT {
            left: left + dip(11, dpi),
            top: dip(23, dpi),
            right: right - dip(6, dpi),
            bottom: dip(44, dpi),
        };
        if quota.remaining.is_some() {
            SelectObject(dc, value_font as _);
            SetTextColor(dc, value_tone(quota.remaining, quota.disabled));
            paint_text(dc, &percent_text(quota.remaining), rect, format);
            SelectObject(dc, small_font as _);
            SetTextColor(dc, rgb(0x9B, 0xAF, 0xA1));
            paint_text(
                dc,
                if quota.stale { "eski" } else { quota.window },
                RECT {
                    left: left + dip(54, dpi),
                    ..rect
                },
                format,
            );
        } else {
            SetTextColor(dc, rgb(0xA4, 0xB5, 0xAB));
            paint_text(dc, quota.window, rect, format);
        }
    }
}

unsafe fn paint_text(dc: HDC, label: &str, rect: RECT, format: u32) {
    let mut label = wide(label);
    draw(dc, &mut label, rect, format);
}

unsafe fn rule(dc: HDC, rect: RECT, color: COLORREF) {
    let brush = CreateSolidBrush(color);
    FillRect(dc, &rect, brush);
    DeleteObject(brush as _);
}

fn fill_island(pixels: &mut [u32], width: i32, height: i32, radius: i32) {
    let radius = radius as f32;
    for y in 0..height {
        for x in 0..width {
            let coverage = round_coverage(
                x as f32 + 0.5,
                y as f32 + 0.5,
                width as f32,
                height as f32,
                radius,
            );
            let inner = round_coverage(
                x as f32 - 0.5,
                y as f32 - 0.5,
                width as f32 - 2.0,
                height as f32 - 2.0,
                (radius - 1.0).max(0.0),
            );
            let edge = ((coverage - inner).max(0.0) * 30.0) as u8;
            let light = (5.0 * (1.0 - y as f32 / height as f32)) as u8;
            let alpha = (coverage * 216.0) as u8;
            pixels[(y * width + x) as usize] = premul(
                27 + light + edge,
                37 + light + edge,
                35 + light + edge,
                alpha,
            );
        }
    }
}

fn round_coverage(x: f32, y: f32, width: f32, height: f32, radius: f32) -> f32 {
    let dx = (x - width * 0.5).abs() - (width * 0.5 - radius);
    let dy = (y - height * 0.5).abs() - (height * 0.5 - radius);
    let outside =
        (dx.max(0.0).powi(2) + dy.max(0.0).powi(2)).sqrt() + dx.min(0.0).max(dy.min(0.0)) - radius;
    (0.5 - outside).clamp(0.0, 1.0)
}

fn premul(red: u8, green: u8, blue: u8, alpha: u8) -> u32 {
    let scale = alpha as u32;
    let red = red as u32 * scale / 255;
    let green = green as u32 * scale / 255;
    let blue = blue as u32 * scale / 255;
    (alpha as u32) << 24 | red << 16 | green << 8 | blue
}

fn composite(glass: &mut [u32], mask: &[u32]) {
    for (pixel, source) in glass.iter_mut().zip(mask) {
        let blue = (source & 0xff) as f32;
        let green = ((source >> 8) & 0xff) as f32;
        let red = ((source >> 16) & 0xff) as f32;
        let coverage = red.max(green).max(blue) / 255.0;
        if coverage < 0.04 {
            continue;
        }
        let red = (red / coverage).min(255.0);
        let green = (green / coverage).min(255.0);
        let blue = (blue / coverage).min(255.0);
        let dest_a = ((*pixel >> 24) & 0xff) as f32 / 255.0;
        let dest_r = ((*pixel >> 16) & 0xff) as f32;
        let dest_g = ((*pixel >> 8) & 0xff) as f32;
        let dest_b = (*pixel & 0xff) as f32;
        let out_a = coverage + dest_a * (1.0 - coverage);
        let out_r = red * coverage + dest_r * (1.0 - coverage);
        let out_g = green * coverage + dest_g * (1.0 - coverage);
        let out_b = blue * coverage + dest_b * (1.0 - coverage);
        *pixel = ((out_a * 255.0) as u32) << 24
            | (out_r as u32).min(255) << 16
            | (out_g as u32).min(255) << 8
            | (out_b as u32).min(255);
    }
}

fn font(height: i32, weight: i32) -> windows_sys::Win32::Graphics::Gdi::HFONT {
    let face = wide("Segoe UI");
    unsafe {
        CreateFontW(
            -height,
            0,
            0,
            0,
            weight,
            0,
            0,
            0,
            DEFAULT_CHARSET as u32,
            0,
            0,
            ANTIALIASED_QUALITY as u32,
            0,
            face.as_ptr(),
        )
    }
}

unsafe fn draw(
    dc: windows_sys::Win32::Graphics::Gdi::HDC,
    text: &mut [u16],
    mut rect: RECT,
    format: u32,
) {
    DrawTextW(dc, text.as_mut_ptr(), -1, &mut rect, format);
}
