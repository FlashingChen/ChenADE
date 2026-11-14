use serde::{Deserialize, Serialize};

/// Lower bound accepted for the terminal font size.
pub const MIN_TERMINAL_FONT_SIZE: u16 = 8;
/// Upper bound accepted for the terminal font size.
pub const MAX_TERMINAL_FONT_SIZE: u16 = 32;

const DEFAULT_TERMINAL_FONT_SIZE: u16 = 12;
const DEFAULT_THEME: &str = "dark";

/// User preferences persisted as JSON values in the `settings` table.
///
/// Every field is optional when deserializing so a partial payload from the
/// webview never wipes the remaining preferences with serde errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub terminal_shell: Option<String>,
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: u16,
    #[serde(default)]
    pub default_editor: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_confirm_close_terminal")]
    pub confirm_close_terminal: bool,
    #[serde(default = "default_load_shell_profile")]
    pub load_shell_profile: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            terminal_shell: None,
            terminal_font_size: default_terminal_font_size(),
            default_editor: None,
            theme: default_theme(),
            confirm_close_terminal: default_confirm_close_terminal(),
            load_shell_profile: default_load_shell_profile(),
        }
    }
}

impl Settings {
    /// Clamp fields that accept a bounded range.
    pub fn normalize(&mut self) {
        self.terminal_font_size = self
            .terminal_font_size
            .clamp(MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE);
    }

    /// Consuming variant of [`Settings::normalize`], handy for command returns.
    pub fn normalized(mut self) -> Self {
        self.normalize();
        self
    }
}

fn default_terminal_font_size() -> u16 {
    DEFAULT_TERMINAL_FONT_SIZE
}

fn default_theme() -> String {
    DEFAULT_THEME.to_string()
}

fn default_confirm_close_terminal() -> bool {
    true
}

fn default_load_shell_profile() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_contract() {
        let settings = Settings::default();
        assert_eq!(settings.terminal_shell, None);
        assert_eq!(settings.terminal_font_size, 12);
        assert_eq!(settings.default_editor, None);
        assert_eq!(settings.theme, "dark");
        assert!(settings.confirm_close_terminal);
        assert!(settings.load_shell_profile);
    }

    #[test]
    fn normalize_clamps_font_size() {
        let mut settings = Settings {
            terminal_font_size: 99,
            ..Settings::default()
        };
        settings.normalize();
        assert_eq!(settings.terminal_font_size, MAX_TERMINAL_FONT_SIZE);

        let mut settings = Settings {
            terminal_font_size: 1,
            ..Settings::default()
        };
        settings.normalize();
        assert_eq!(settings.terminal_font_size, MIN_TERMINAL_FONT_SIZE);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"theme":"light"}"#).unwrap();
        assert_eq!(settings.theme, "light");
        assert_eq!(settings.terminal_font_size, 12);
        assert!(settings.confirm_close_terminal);
        assert!(settings.load_shell_profile);
        assert_eq!(settings.terminal_shell, None);
    }
}
