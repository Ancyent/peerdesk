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
    MouseMove { x: i32, y: i32 },
    MouseDown { button: u8 },
    MouseUp { button: u8 },
    KeyDown { key: String },
    KeyUp { key: String },
    Scroll { delta_x: i32, delta_y: i32 },
}

fn web_key_to_enigo(key: &str) -> Key {
    match key {
        "Enter" => Key::Return,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        " " => Key::Space,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "Control" => Key::Control,
        "Shift" => Key::Shift,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        k if k.len() == 1 => Key::Unicode(k.chars().next().unwrap()),
        _ => Key::Unicode(' '),
    }
}

pub async fn run(mut rx: Receiver<InputEvent>) -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default())?;
    while let Some(event) = rx.recv().await {
        let _ = match event {
            InputEvent::MouseMove { x, y } => enigo
                .move_mouse(x, y, Coordinate::Abs)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseDown { button: 0 } => enigo
                .button(enigo::Button::Left, Press)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::MouseUp { button: 0 } => enigo
                .button(enigo::Button::Left, Release)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::KeyDown { ref key } => enigo
                .key(web_key_to_enigo(key), Press)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::KeyUp { ref key } => enigo
                .key(web_key_to_enigo(key), Release)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            InputEvent::Scroll { delta_y, .. } => enigo
                .scroll(delta_y, enigo::Axis::Vertical)
                .map_err(|e| anyhow::anyhow!("{e:?}")),
            _ => Ok(()),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mouse_move_event() {
        let json = r#"{"type":"mouse_move","x":100,"y":200}"#;
        let event: InputEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, InputEvent::MouseMove { x: 100, y: 200 }));
    }

    #[test]
    fn parses_key_down_event() {
        let json = r#"{"type":"key_down","key":"a"}"#;
        let event: InputEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, InputEvent::KeyDown { key } if key == "a"));
    }
}
