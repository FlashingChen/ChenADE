use tauri::State;

use crate::error::AppResult;
use crate::models::settings::Settings;
use crate::services::db::Db;

#[tauri::command]
pub fn settings_get(db: State<'_, Db>) -> AppResult<Settings> {
    db.get_settings()
}

#[tauri::command]
pub fn settings_set(db: State<'_, Db>, settings: Settings) -> AppResult<Settings> {
    let settings = settings.normalized();
    db.set_settings(&settings)?;
    Ok(settings)
}
