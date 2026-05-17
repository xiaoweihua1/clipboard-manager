use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
fn read_clipboard_image() -> Result<Option<String>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    match clipboard.get_image() {
        Ok(image_data) => {
            let img = image::RgbaImage::from_raw(
                image_data.width as u32,
                image_data.height as u32,
                image_data.bytes.into_owned(),
            )
            .ok_or("Invalid image dimensions")?;

            let mut png_bytes: Vec<u8> = Vec::new();
            let mut cursor = std::io::Cursor::new(&mut png_bytes);
            img.write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;

            let base64_str = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &png_bytes,
            );
            Ok(Some(format!("data:image/png;base64,{}", base64_str)))
        }
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_clipboard_image(base64_data: String) -> Result<(), String> {
    let b64 = base64_data
        .strip_prefix("data:image/png;base64,")
        .or_else(|| base64_data.strip_prefix("data:image/bmp;base64,"))
        .unwrap_or(&base64_data);

    let png_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        b64,
    )
    .map_err(|e| e.to_string())?;

    let img = image::load_from_memory(&png_bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(rgba.into_raw()),
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None::<Vec<&str>>))
        .invoke_handler(tauri::generate_handler![read_clipboard_image, write_clipboard_image])
        .setup(|app| {
            app.global_shortcut().on_shortcut(
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyV),
                move |app_handle, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                },
            )?;
            // Enable auto-start on boot (silent)
            let _ = app.autolaunch().enable();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
