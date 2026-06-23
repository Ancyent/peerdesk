pub mod mouse;

use anyhow::Result;
use enigo::{
    Coordinate,
    Direction::{Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};
use serde::Deserialize;
use tokio::sync::mpsc::Receiver;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputEvent {
    MouseMove { x: f32, y: f32 },
    MouseDown { button: u8 },
    MouseUp { button: u8 },
    KeyDown { key: String },
    KeyUp { key: String },
    Scroll { delta_x: i32, delta_y: i32 },
}

fn web_key_to_enigo(key: &str) -> Option<Key> {
    Some(match key {
        "Enter" => Key::Return,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        " " => Key::Space,
        "Delete" => Key::Delete,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "Control" => Key::Control,
        "Shift" => Key::Shift,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        k if k.len() == 1 => Key::Unicode(k.chars().next().unwrap()),
        _ => return None,
    })
}

pub async fn run(mut rx: Receiver<InputEvent>) -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default())?;
    while let Some(event) = rx.recv().await {
        let _ = match event {
            InputEvent::MouseMove { x, y } => {
                let (sw, sh) = enigo.main_display().unwrap_or((1, 1));
                let (px, py) = norm_to_native(x, y, sw, sh);
                enigo
                    .move_mouse(px, py, Coordinate::Abs)
                    .map_err(|e| anyhow::anyhow!("{e:?}"))
            }
            InputEvent::MouseDown { button: 0 } => enigo
                .button(enigo::Button::Left, Press)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseDown { button: 1 } => enigo
                .button(enigo::Button::Right, Press)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseDown { button: 2 } => enigo
                .button(enigo::Button::Middle, Press)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseDown { .. } => Ok(()),
            InputEvent::MouseUp { button: 0 } => enigo
                .button(enigo::Button::Left, Release)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseUp { button: 1 } => enigo
                .button(enigo::Button::Right, Release)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseUp { button: 2 } => enigo
                .button(enigo::Button::Middle, Release)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseUp { .. } => Ok(()),
            InputEvent::KeyDown { ref key } => {
                if let Some(k) = web_key_to_enigo(key) {
                    enigo.key(k, Press).map_err(|e| anyhow::anyhow!("{e:?}"))
                } else {
                    Ok(())
                }
            }
            InputEvent::KeyUp { ref key } => {
                if let Some(k) = web_key_to_enigo(key) {
                    enigo.key(k, Release).map_err(|e| anyhow::anyhow!("{e:?}"))
                } else {
                    Ok(())
                }
            }
            InputEvent::Scroll { delta_x, delta_y } => {
                if delta_x != 0 {
                    let _ = enigo
                        .scroll(delta_x, enigo::Axis::Horizontal)
                        .map_err(|e| anyhow::anyhow!("{e:?}"));
                }
                enigo
                    .scroll(delta_y, enigo::Axis::Vertical)
                    .map_err(|e| anyhow::anyhow!("{e:?}"))
            }
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mouse_move_event() {
        let json = r#"{"type":"mouse_move","x":0.5,"y":0.25}"#;
        let event: InputEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, InputEvent::MouseMove { x, y } if x == 0.5 && y == 0.25));
    }

    #[test]
    fn parses_key_down_event() {
        let json = r#"{"type":"key_down","key":"a"}"#;
        let event: InputEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, InputEvent::KeyDown { key } if key == "a"));
    }
}

/// Map a normalized (0..1) pointer position to absolute screen pixels for a
/// display of size (sw, sh). Clamps to the display bounds.
pub fn norm_to_native(x: f32, y: f32, sw: i32, sh: i32) -> (i32, i32) {
    let cx = (x.clamp(0.0, 1.0) * sw as f32).round() as i32;
    let cy = (y.clamp(0.0, 1.0) * sh as f32).round() as i32;
    (cx.clamp(0, (sw - 1).max(0)), cy.clamp(0, (sh - 1).max(0)))
}

#[cfg(test)]
mod coord_tests {
    use super::norm_to_native;
    #[test]
    fn maps_center_and_edges() {
        assert_eq!(norm_to_native(0.5, 0.5, 1920, 1080), (960, 540));
        assert_eq!(norm_to_native(0.0, 0.0, 1920, 1080), (0, 0));
        assert_eq!(norm_to_native(1.0, 1.0, 1920, 1080), (1919, 1079));
    }
    #[test]
    fn clamps_out_of_range() {
        assert_eq!(norm_to_native(2.0, -1.0, 1280, 720), (1279, 0));
    }
}
