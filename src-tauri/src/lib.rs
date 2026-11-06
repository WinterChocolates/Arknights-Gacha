//! Tauri 桌面外壳 + 本机数据层。
//!
//! 前端（Nuxt SPA）负责全部业务逻辑，这里只提供三件事：
//!   1. 打开窗口加载打包好的静态页面，站外链接交给系统浏览器；
//!   2. 读写本机 JSON（账号配置 / 寻访记录），原子替换 + `.bak` 兜底；
//!   3. 代发 HTTP 请求（reqwest 自带 cookie jar，绕开 WebView 的 CORS 限制）。
//!
//! 没有子进程、没有内置 Node 服务；`windows_subsystem = "windows"` 保证双击 exe 不出控制台。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, Theme, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const WINDOW_TITLE: &str = "明日方舟寻访记录";

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ---- 窗口 ----

/// 应用自身的地址（tauri 协议 / 本地回环）才算「站内」。
fn is_internal(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => matches!(
            url.host_str(),
            Some("tauri.localhost") | Some("127.0.0.1") | Some("localhost") | Some("[::1]")
        ),
        // 这些交给系统程序（邮件 / 拨号 / 本地文件）
        "mailto" | "tel" | "file" => false,
        // about:/blob:/data:/chrome-error: 之类是 WebView 自身行为，不能拦
        _ => true,
    }
}

/// WebView 里没有标签页：外链一律交给系统默认浏览器。
fn open_in_browser(app: &AppHandle, url: &str) {
    let _ = app.opener().open_url(url, None::<&str>);
}

fn open_window(app: &AppHandle) -> tauri::Result<()> {
    let new_window_handle = app.clone();
    let navigation_handle = app.clone();

    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title(WINDOW_TITLE)
        .inner_size(1180.0, 820.0)
        .min_inner_size(960.0, 640.0)
        .center()
        // 界面是纯白浅色设计：强制亮色主题，避免 Windows 深色模式把 WebView 染成暗色
        .theme(Some(Theme::Light))
        // target="_blank" / window.open：WebView2 默认直接丢弃，改成用系统浏览器打开
        .on_new_window(move |target, _features| {
            open_in_browser(&new_window_handle, target.as_str());
            NewWindowResponse::Deny
        })
        // 同窗口的站外跳转：拦住，别把应用页面顶掉
        .on_navigation(move |target| {
            if is_internal(target) {
                return true;
            }
            open_in_browser(&navigation_handle, target.as_str());
            false
        })
        .build()?;

    Ok(())
}

// ---- 本机存储 ----

/// 数据目录：exe 同目录下的 `userData/`（便携式，拷走就能带走），
/// 该目录不可写时（例如装在受保护路径）退回用户数据目录。
fn resolve_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let portable = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .map(|dir| dir.join("userData"));

    if let Some(dir) = portable {
        if fs::create_dir_all(dir.join("gachaData")).is_ok() {
            return Ok(dir);
        }
    }

    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法获取数据目录：{error}"))?;
    fs::create_dir_all(dir.join("gachaData")).map_err(|error| format!("无法创建数据目录：{error}"))?;
    Ok(dir)
}

fn record_path(app: &AppHandle, uid: &str) -> Result<PathBuf, String> {
    let safe: String = uid
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    Ok(resolve_data_dir(app)?.join("gachaData").join(format!("{safe}.json")))
}

/// 文件损坏时自动回退到上一版 `.bak`
fn read_json_with_backup(path: &Path) -> Option<serde_json::Value> {
    let backup = PathBuf::from(format!("{}.bak", path.display()));
    for candidate in [path.to_path_buf(), backup] {
        let Ok(text) = fs::read_to_string(&candidate) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str(&text) {
            return Some(value);
        }
    }
    None
}

/// 原子写：先写临时文件再 rename，成功前保留上一版 `.bak`
fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    let body = format!(
        "{}\n",
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?
    );
    fs::write(&tmp, body).map_err(|error| error.to_string())?;
    if path.exists() {
        let _ = fs::copy(path, PathBuf::from(format!("{}.bak", path.display())));
    }
    fs::rename(&tmp, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn data_dir(app: AppHandle) -> Result<String, String> {
    Ok(resolve_data_dir(&app)?.display().to_string())
}

#[tauri::command]
fn read_config(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = resolve_data_dir(&app)?.join("config.json");
    Ok(read_json_with_backup(&path).unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
fn save_config(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    write_json_atomic(&resolve_data_dir(&app)?.join("config.json"), &data)
}

#[tauri::command]
fn read_records(app: AppHandle, uid: String) -> Result<serde_json::Value, String> {
    Ok(read_json_with_backup(&record_path(&app, &uid)?).unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
fn save_records(app: AppHandle, uid: String, data: serde_json::Value) -> Result<(), String> {
    write_json_atomic(&record_path(&app, &uid)?, &data)
}

#[tauri::command]
fn delete_records(app: AppHandle, uid: String) -> Result<(), String> {
    let path = record_path(&app, &uid)?;
    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(format!("{}.bak", path.display()));
    Ok(())
}

/// 导出文件写到系统「下载」目录，返回实际路径
#[tauri::command]
fn export_file(app: AppHandle, file_name: String, contents: String) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("找不到下载目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let name: String = file_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let path = dir.join(name);
    fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

// ---- HTTP 转发 ----

#[derive(Default)]
struct HttpState(Mutex<Option<reqwest::Client>>);

fn http_client(state: &State<'_, HttpState>) -> Result<reqwest::Client, String> {
    let mut guard = state.0.lock().map_err(|_| "网络客户端状态异常".to_string())?;
    if let Some(client) = guard.as_ref() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        // 官方 `ak.hypergryph.com/user` 会下发 session cookie，后续角色登录与翻页都依赖它
        .cookie_store(true)
        .user_agent(DEFAULT_USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法初始化网络客户端：{error}"))?;
    *guard = Some(client.clone());
    Ok(client)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn http_request(
    state: State<'_, HttpState>,
    request: HttpRequest,
) -> Result<HttpResponse, String> {
    let client = http_client(&state)?;
    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|error| format!("非法的方法名：{error}"))?;

    let mut builder = client.request(method, &request.url);
    if let Some(timeout) = request.timeout_ms {
        builder = builder.timeout(Duration::from_millis(timeout));
    }
    for (key, value) in &request.headers {
        builder = builder.header(key, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("网络请求失败：{error}"))?;
    let status = response.status().as_u16();

    let mut headers = HashMap::new();
    for (name, value) in response.headers().iter() {
        // set-cookie 由 cookie jar 处理，不往 JS 传
        if name == "set-cookie" {
            continue;
        }
        if let Ok(text) = value.to_str() {
            headers.insert(name.as_str().to_string(), text.to_string());
        }
    }

    let body = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;

    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

/// 每次同步开始前换一个新会话，避免沿用上一个账号的 cookie
#[tauri::command]
fn reset_cookies(state: State<'_, HttpState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "网络客户端状态异常".to_string())?;
    *guard = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(HttpState::default())
        .invoke_handler(tauri::generate_handler![
            data_dir,
            read_config,
            save_config,
            read_records,
            save_records,
            delete_records,
            export_file,
            http_request,
            reset_cookies
        ])
        .setup(|app| {
            open_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("无法启动 Tauri 应用");
}
