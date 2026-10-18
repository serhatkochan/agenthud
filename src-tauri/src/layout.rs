#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn layout(
    mode: &str,
    previous_mode: &str,
    previous: Rect,
    work: Rect,
    scale: f64,
    anchor: Option<Rect>,
) -> (Rect, (u32, u32)) {
    let (w, h) = match mode {
        "compact" => (420., 48.),
        "panel" => (420., 720.),
        _ => (1120., 940.),
    };
    let width = ((w * scale).round() as u32).min(work.width);
    let height = ((h * scale).round() as u32).min(work.height);
    let minimum = (
        (((if mode == "dashboard" { 760. } else { 380. }) * scale).round() as u32).min(work.width),
        (((if mode == "compact" { 48. } else { 540. }) * scale).round() as u32).min(work.height),
    );
    let (mut x, mut y) = (previous.x, previous.y);
    if mode != "dashboard" {
        if let Some(a) = anchor {
            x = a.x;
            y = a.y;
        } else if previous_mode == "dashboard" {
            x = work.x + work.width as i32 - width as i32 - (24. * scale) as i32;
            y = work.y + (24. * scale) as i32;
        } else {
            x = previous.x + previous.width as i32 - width as i32;
        }
    }
    x = x.max(work.x).min(work.x + work.width as i32 - width as i32);
    y = y
        .max(work.y)
        .min(work.y + work.height as i32 - height as i32);
    (
        Rect {
            x,
            y,
            width,
            height,
        },
        minimum,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dashboard_expansion_fits_display_and_high_dpi() {
        let work = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let (rect, _) = layout(
            "dashboard",
            "compact",
            Rect {
                x: 1476,
                y: 24,
                width: 420,
                height: 48,
            },
            work,
            1.0,
            None,
        );
        assert_eq!(
            rect,
            Rect {
                x: 800,
                y: 24,
                width: 1120,
                height: 940
            }
        );
        let (scaled, _) = layout("compact", "dashboard", rect, work, 1.5, None);
        assert_eq!((scaled.width, scaled.height), (630, 72));
        assert!(scaled.x + scaled.width as i32 <= 1920);
    }
    #[test]
    fn small_negative_display_and_peek_anchor_remain_reachable() {
        let work = Rect {
            x: -800,
            y: 0,
            width: 800,
            height: 500,
        };
        let previous = Rect {
            x: -500,
            y: 30,
            width: 420,
            height: 48,
        };
        let (rect, min) = layout("panel", "compact", previous, work, 1.0, Some(previous));
        assert_eq!(
            rect,
            Rect {
                x: -500,
                y: 0,
                width: 420,
                height: 500
            }
        );
        assert_eq!(min, (380, 500));
    }
}
