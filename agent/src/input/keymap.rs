//! Resolves a browser key event (`e.code` physical key + `e.key` character) to an
//! enigo key. Modifier-held shortcuts use the physical key so they combine;
//! plain text uses Unicode for layout correctness.

#[cfg(feature = "gui-capture")]
use enigo::Key;

/// True for Control/Alt/Meta (the modifiers that turn a keypress into a shortcut).
/// Shift is intentionally excluded — Shift+letter is text (uppercase via `e.key`).
pub fn is_shortcut_modifier(code: &str) -> bool {
    matches!(
        code,
        "ControlLeft" | "ControlRight" | "AltLeft" | "AltRight" | "MetaLeft" | "MetaRight"
    )
}

/// macOS Ctrl<->Cmd: when `translate` is on, a Control code is emitted as the Meta
/// (Command) key and vice versa. Returns the (possibly remapped) code.
pub fn translated_code(code: &str, translate: bool) -> &str {
    if !translate {
        return code;
    }
    match code {
        "ControlLeft" => "MetaLeft",
        "ControlRight" => "MetaRight",
        "MetaLeft" => "ControlLeft",
        "MetaRight" => "ControlRight",
        other => other,
    }
}

/// Windows virtual-key code for a character `e.code`, or None. Pure (testable on
/// any OS): VK_A..VK_Z == 0x41..0x5A and VK_0..VK_9 == 0x30..0x39 equal their
/// ASCII codes.
pub fn code_to_vk(code: &str) -> Option<u32> {
    if let Some(l) = code.strip_prefix("Key") {
        if l.len() == 1 {
            let c = l.chars().next().unwrap().to_ascii_uppercase();
            if c.is_ascii_uppercase() {
                return Some(c as u32);
            }
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        if d.len() == 1 {
            let c = d.chars().next().unwrap();
            if c.is_ascii_digit() {
                return Some(c as u32);
            }
        }
    }
    None
}

/// Physical key for letters/digits when a modifier is held (so the shortcut
/// combines). Windows uses the virtual-key; other platforms return None and the
/// caller falls back to Unicode (which combines with modifiers on Linux).
#[cfg(all(feature = "gui-capture", target_os = "windows"))]
pub fn physical_letter_key(code: &str) -> Option<Key> {
    code_to_vk(code).map(Key::Other)
}
#[cfg(all(feature = "gui-capture", not(target_os = "windows")))]
pub fn physical_letter_key(_code: &str) -> Option<Key> {
    None
}

/// Named enigo key for a non-character `e.code` (special keys + modifiers).
#[cfg(feature = "gui-capture")]
pub fn named_key(code: &str) -> Option<Key> {
    Some(match code {
        "Enter" | "NumpadEnter" => Key::Return,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Space" => Key::Space,
        "Delete" => Key::Delete,
        "Insert" => Key::Insert,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "CapsLock" => Key::CapsLock,
        "ControlLeft" | "ControlRight" => Key::Control,
        "ShiftLeft" | "ShiftRight" => Key::Shift,
        "AltLeft" | "AltRight" => Key::Alt,
        "MetaLeft" | "MetaRight" => Key::Meta,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        _ => return None,
    })
}

/// Resolve a key event to the enigo key to press/release. `modifier_held` is true
/// when any Control/Alt/Meta is currently down. `translate_cmd` swaps Ctrl<->Cmd
/// (macOS hosts). Returns None for unmapped keys.
#[cfg(feature = "gui-capture")]
pub fn resolve(code: &str, key: &str, modifier_held: bool, translate_cmd: bool) -> Option<Key> {
    let code = translated_code(code, translate_cmd);
    if let Some(k) = named_key(code) {
        return Some(k);
    }
    if modifier_held {
        if let Some(k) = physical_letter_key(code) {
            return Some(k);
        }
    }
    let mut chars = key.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => Some(Key::Unicode(c)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modifiers_classified() {
        assert!(is_shortcut_modifier("ControlLeft"));
        assert!(is_shortcut_modifier("AltRight"));
        assert!(is_shortcut_modifier("MetaLeft"));
        assert!(!is_shortcut_modifier("ShiftLeft"));
        assert!(!is_shortcut_modifier("KeyA"));
    }

    #[test]
    fn vk_for_letters_and_digits() {
        assert_eq!(code_to_vk("KeyC"), Some(0x43)); // VK_C
        assert_eq!(code_to_vk("KeyA"), Some(0x41));
        assert_eq!(code_to_vk("Digit1"), Some(0x31)); // VK_1
        assert_eq!(code_to_vk("F5"), None);
        assert_eq!(code_to_vk("Enter"), None);
    }

    #[test]
    fn cmd_translation_swaps_ctrl_meta() {
        assert_eq!(translated_code("ControlLeft", true), "MetaLeft");
        assert_eq!(translated_code("MetaLeft", true), "ControlLeft");
        assert_eq!(translated_code("ControlLeft", false), "ControlLeft");
        assert_eq!(translated_code("KeyC", true), "KeyC");
    }

    #[cfg(feature = "gui-capture")]
    #[test]
    fn named_keys_resolve() {
        assert_eq!(named_key("F5"), Some(Key::F5));
        assert_eq!(named_key("ArrowUp"), Some(Key::UpArrow));
        assert_eq!(named_key("ControlLeft"), Some(Key::Control));
        assert_eq!(named_key("KeyA"), None);
    }

    #[cfg(feature = "gui-capture")]
    #[test]
    fn resolve_named_before_anything() {
        assert_eq!(resolve("F5", "F5", false, false), Some(Key::F5));
        assert_eq!(resolve("ControlLeft", "Control", true, false), Some(Key::Control));
    }

    #[cfg(feature = "gui-capture")]
    #[test]
    fn resolve_plain_char_is_unicode() {
        assert_eq!(resolve("KeyA", "a", false, false), Some(Key::Unicode('a')));
        assert_eq!(resolve("Digit1", "1", false, false), Some(Key::Unicode('1')));
        assert_eq!(resolve("Foo", "Dead", false, false), None);
    }

    #[cfg(feature = "gui-capture")]
    #[test]
    fn resolve_translation_applies() {
        assert_eq!(resolve("ControlLeft", "Control", true, true), Some(Key::Meta));
    }
}
