#![windows_subsystem = "windows"]
use std::{error::Error, fs, io::{BufRead, BufReader}, os::windows::process::CommandExt, path::PathBuf, process::{Command, Stdio}};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

fn saved_path(dir: &std::path::Path, name: &str) -> Option<PathBuf> {
    if let Ok(bytes) = fs::read(dir.join(name)) {
        let wide: Vec<u16> = bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
        let candidate = PathBuf::from(String::from_utf16_lossy(&wide));
        if candidate.is_absolute() { return Some(candidate); }
    }
    None
}
fn chosen_node(dir: &std::path::Path) -> PathBuf {
    saved_path(dir,"node-path.txt").filter(|p| p.is_file()).unwrap_or_else(||dir.join("payload/runtime/node.exe"))
}

#[link(name="user32")]
extern "system" {fn SendMessageW(hwnd:isize,msg:u32,wparam:usize,lparam:isize)->isize;}
#[link(name="shell32")]
extern "system" {fn ExtractIconExW(file:*const u16,index:i32,large:*mut isize,small:*mut isize,count:u32)->u32;}
fn set_taskbar_icon(window:&tauri::WebviewWindow)->Result<(),Box<dyn Error>> {
    use std::os::windows::ffi::OsStrExt;
    let path:Vec<u16>=std::env::current_exe()?.as_os_str().encode_wide().chain(Some(0)).collect();
    let (mut large,mut small)=(0isize,0isize);
    let hwnd=window.hwnd()?.0 as isize;
    unsafe {
        // The single native window retains both handles for the lifetime of this process.
        if ExtractIconExW(path.as_ptr(),0,&mut large,&mut small,1)>0 {
            if large!=0 {SendMessageW(hwnd,0x80,1,large);}
            if small!=0 {SendMessageW(hwnd,0x80,0,small);}
        }
    }
    Ok(())
}
fn open(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    let dir = app.path().resource_dir()?;
    let data = std::env::var_os("CARNOT_DATA_DIR").map(PathBuf::from).or_else(||saved_path(&dir,"workspace-path.txt")).unwrap_or_else(||dir.join("workspace"));
    let version = app.package_info().version.to_string();
    let mut child = Command::new(chosen_node(&dir)).current_dir(dir.join("payload/app"))
        .args(["--input-type=module","-e",include_str!("../start.mjs")])
        .env("CARNOT_DESKTOP_VERSION", &version).env("CARNOT_DATA_DIR", &data).creation_flags(0x08000000)
        .stdout(Stdio::piped()).spawn()?;
    let stdout = child.stdout.take().ok_or("Missing startup pipe")?;
    let port = std::sync::Arc::new(std::sync::atomic::AtomicU16::new(0));
    let allowed = port.clone();
    // WebView2 initializes while the Node process loads Pi and opens the workspace.
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .decorations(false).background_color(tauri::webview::Color(245,247,250,255)).icon(app.default_window_icon().ok_or("Missing app icon")?.clone())?.data_directory(data.join("desktop-webview")).title("Carnot Agent Engine").inner_size(1200.0,800.0)
        .on_navigation(move |u| {
            let active=allowed.load(std::sync::atomic::Ordering::Acquire);
            (active==0 && (u.as_str()=="about:blank" || u.host_str()==Some("tauri.localhost"))) ||
            (active!=0 && u.scheme()=="http" && u.host_str()==Some("127.0.0.1") && u.port_or_known_default()==Some(active))
        })
        .initialization_script(if dir.join("payload/app/dist/web/basic-physics-map.mjs").is_file() {"window.__CARNOT_BASIC_PHYSICS__=true;"} else {"window.__CARNOT_BASIC_PHYSICS__=false;"})
        .initialization_script(format!("window.__CARNOT_DESKTOP_VERSION__='{}';", version))
        .initialization_script(include_str!("../chrome.js"))
        .build();
    let window = match window { Ok(w)=>w, Err(e)=>{let _=child.kill();let _=child.wait();return Err(e.into());} };
    set_taskbar_icon(&window)?;
    let handle = app.handle().clone();
    let main_window = window.clone();
    std::thread::spawn(move || {
        let mut reader=BufReader::new(stdout);
        let mut line=String::new();
        let ready=(|| -> Result<(), Box<dyn Error>> {
            reader.read_line(&mut line)?;
            let number=line.trim().parse::<u16>()?;
            if number==0 {return Err("Missing listening port".into());}
            port.store(number,std::sync::atomic::Ordering::Release);
            main_window.navigate(format!("http://127.0.0.1:{number}").parse()?)?;
            Ok(())
        })();
        if ready.is_err() {
            let _=child.kill();
            let _=child.wait();
            let _=main_window.eval("alert('Carnot could not open the workspace. Check that its data folder is available and is not in use.');");
            handle.exit(1);
            return;
        }
        std::io::copy(&mut reader,&mut std::io::sink()).ok();
        let _=child.wait();
        handle.exit(0);
    });
    let hidden = window.clone();
    window.on_window_event(move |event| if let WindowEvent::CloseRequested{api,..}=event {api.prevent_close(); let _=hidden.hide();});
    Ok(())
}
#[link(name="shell32")]
extern "system" { fn SetCurrentProcessExplicitAppUserModelID(id:*const u16)->i32; }
fn main() {
    let app_id:Vec<u16>="org.carnot.agentengine".encode_utf16().chain(Some(0)).collect();
    unsafe {SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());}
    tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app,_,_| {
        if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.unminimize();let _=w.set_focus();}
    })).setup(open).run(tauri::generate_context!()).expect("Carnot desktop startup failed");
}