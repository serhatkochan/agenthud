use crate::layout::Rect;
#[derive(Clone, Copy, Debug)]
pub struct Hotspot {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Hotspot {
    pub fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.x >= 0.
            && self.y >= 0.
            && self.width > 0.
            && self.width <= 80.
            && self.height > 0.
            && self.height <= 48.
            && self.x + self.width <= 100.
            && self.y + self.height <= 48.
    }
}
#[derive(Default)]
pub struct Ghost {
    pub hotspot: Option<Hotspot>,
    pub anchor: Option<Rect>,
    pub peeking: bool,
}
#[derive(Default, Debug, PartialEq)]
pub struct Effect {
    pub ignore: bool,
    pub open: bool,
    pub close: bool,
    pub anchor: Option<Rect>,
}
impl Ghost {
    pub fn cancel(&mut self) {
        self.peeking = false;
        self.anchor = None;
    }
    pub fn step(
        &mut self,
        enabled: bool,
        mode: &str,
        visible: bool,
        bounds: Rect,
        pointer: (i32, i32),
        alt: bool,
        scale: f64,
    ) -> Effect {
        if !enabled || !visible || mode == "dashboard" {
            self.cancel();
            return Effect::default();
        }
        if self.peeking {
            if alt {
                return Effect::default();
            }
            let anchor = self.anchor;
            self.cancel();
            return Effect {
                close: true,
                anchor,
                ..Effect::default()
            };
        }
        if mode != "compact" {
            return Effect::default();
        }
        let x = (pointer.0 - bounds.x) as f64 / scale;
        let y = (pointer.1 - bounds.y) as f64 / scale;
        let inside = x >= 0.
            && y >= 0.
            && x < bounds.width as f64 / scale
            && y < bounds.height as f64 / scale;
        if alt && inside {
            self.peeking = true;
            self.anchor = Some(bounds);
            return Effect {
                open: true,
                ..Effect::default()
            };
        }
        let hotspot = self.hotspot.filter(|s| s.valid()).unwrap_or(Hotspot {
            x: 0.,
            y: 0.,
            width: 48.,
            height: 48.,
        });
        let on_mascot = x >= hotspot.x
            && x < hotspot.x + hotspot.width
            && y >= hotspot.y
            && y < hotspot.y + hotspot.height;
        Effect {
            ignore: !on_mascot,
            ..Effect::default()
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn bounds() -> Rect {
        Rect {
            x: 100,
            y: 100,
            width: 420,
            height: 48,
        }
    }
    #[test]
    fn mascot_stays_clickable_and_quota_passes_through() {
        let mut g = Ghost::default();
        g.hotspot = Some(Hotspot {
            x: 0.,
            y: 0.,
            width: 48.,
            height: 48.,
        });
        assert!(
            !g.step(true, "compact", true, bounds(), (120, 120), false, 1.)
                .ignore
        );
        assert!(
            g.step(true, "compact", true, bounds(), (250, 120), false, 1.)
                .ignore
        );
    }
    #[test]
    fn alt_peek_returns_to_original_anchor_after_pointer_leaves() {
        let mut g = Ghost::default();
        assert!(
            g.step(true, "compact", true, bounds(), (250, 120), true, 1.)
                .open
        );
        assert!(g.peeking);
        assert!(
            !g.step(true, "panel", true, bounds(), (5, 5), true, 1.)
                .close
        );
        let effect = g.step(true, "panel", true, bounds(), (5, 5), false, 1.);
        assert!(effect.close);
        assert_eq!(effect.anchor, Some(bounds()));
        assert!(!g.peeking);
    }
    #[test]
    fn alt_outside_and_explicit_panel_never_create_a_peek() {
        let mut g = Ghost::default();
        assert!(
            !g.step(true, "compact", true, bounds(), (50, 50), true, 1.)
                .open
        );
        assert!(
            !g.step(true, "panel", true, bounds(), (120, 120), true, 1.)
                .open
        );
    }
    #[test]
    fn dashboard_hidden_or_disabled_restores_input() {
        for (enabled, mode, visible) in [
            (false, "compact", true),
            (true, "dashboard", true),
            (true, "compact", false),
        ] {
            let mut g = Ghost::default();
            assert_eq!(
                g.step(enabled, mode, visible, bounds(), (250, 120), true, 1.),
                Effect::default()
            );
        }
    }
    #[test]
    fn invalid_hotspots_cannot_claim_the_entire_bar() {
        assert!(!Hotspot {
            x: 0.,
            y: 0.,
            width: 420.,
            height: 48.
        }
        .valid());
        assert!(!Hotspot {
            x: f64::NAN,
            y: 0.,
            width: 48.,
            height: 48.
        }
        .valid());
        assert!(Hotspot {
            x: 0.,
            y: 0.,
            width: 48.,
            height: 48.
        }
        .valid());
    }
}
