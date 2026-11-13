//! CSS Doctor desktop shell (Option B: Node HTTP sidecar + shared React SPA).
//!
//! The Webview loads the production Node server URL. Analysis stays in the
//! existing NAPI binding via that sidecar — this crate does not reimplement
//! Core and does not expose arbitrary shell/filesystem IPC to the frontend.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct SidecarState {
  child: Mutex<Option<Child>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let port = match free_loopback_port() {
    Ok(port) => port,
    Err(error) => {
      eprintln!("css-doctor-gui desktop: unable to reserve loopback port ({error})");
      std::process::exit(1);
    }
  };

  let package_root = resolve_package_root();
  let cli_js = package_root.join("dist-server/cli.js");
  if !cli_js.is_file() {
    eprintln!(
      "css-doctor-gui desktop: missing production server at {}.\nRun `pnpm --filter css-doctor-gui build` first.",
      cli_js.display()
    );
    std::process::exit(1);
  }

  let child = match spawn_sidecar(&package_root, &cli_js, port) {
    Ok(child) => child,
    Err(error) => {
      eprintln!("css-doctor-gui desktop: failed to start Node sidecar ({error})");
      std::process::exit(1);
    }
  };

  let url = format!("http://127.0.0.1:{port}/");
  if let Err(error) = wait_for_health(port, Duration::from_secs(20)) {
    let _ = kill_child(child);
    eprintln!("css-doctor-gui desktop: sidecar health check failed ({error})");
    std::process::exit(1);
  }

  let state = SidecarState {
    child: Mutex::new(Some(child)),
  };

  tauri::Builder::default()
    .manage(state)
    .setup(move |app| {
      let parsed = url
        .parse()
        .map_err(|error| std::io::Error::other(format!("invalid sidecar url: {error}")))?;
      WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
        .title("CSS Doctor")
        .inner_size(1280.0, 840.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .build()?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building CSS Doctor desktop shell")
    .run(|app_handle, event| {
      if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
        if let Some(state) = app_handle.try_state::<SidecarState>() {
          if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
              let _ = kill_child(child);
            }
          }
        }
      }
    });
}

fn resolve_package_root() -> PathBuf {
  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let local = manifest_dir
    .parent()
    .map(Path::to_path_buf)
    .unwrap_or_else(|| PathBuf::from("."));
  if local.join("dist-server/cli.js").is_file() {
    return local;
  }

  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      for candidate in [
        dir.join("resources"),
        dir.join("../Resources"),
        dir.to_path_buf(),
      ] {
        if candidate.join("dist-server/cli.js").is_file() {
          return candidate;
        }
      }
    }
  }

  local
}

fn free_loopback_port() -> std::io::Result<u16> {
  let listener = TcpListener::bind(("127.0.0.1", 0))?;
  let port = listener.local_addr()?.port();
  drop(listener);
  Ok(port)
}

fn spawn_sidecar(package_root: &Path, cli_js: &Path, port: u16) -> std::io::Result<Child> {
  let node = std::env::var_os("CSS_DOCTOR_GUI_NODE").unwrap_or_else(|| "node".into());
  let mut command = Command::new(node);
  command
    .arg(cli_js)
    .arg("--host")
    .arg("127.0.0.1")
    .arg("--port")
    .arg(port.to_string())
    .arg("--strict-port")
    .arg("--no-open")
    .current_dir(package_root)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  let mut child = command.spawn()?;
  pipe_logs("sidecar-stdout", child.stdout.take());
  pipe_logs("sidecar-stderr", child.stderr.take());
  Ok(child)
}

fn pipe_logs<T>(label: &'static str, stream: Option<T>)
where
  T: std::io::Read + Send + 'static,
{
  let Some(stream) = stream else {
    return;
  };
  thread::spawn(move || {
    let reader = BufReader::new(stream);
    for line in reader.lines().flatten() {
      eprintln!("css-doctor-gui desktop:{label}: {line}");
    }
  });
}

fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
  let started = Instant::now();
  while started.elapsed() < timeout {
    if http_health_ok(port) {
      return Ok(());
    }
    thread::sleep(Duration::from_millis(150));
  }
  Err(format!("timed out waiting for http://127.0.0.1:{port}/api/health"))
}

fn http_health_ok(port: u16) -> bool {
  let addr = SocketAddr::from(([127, 0, 0, 1], port));
  let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
    return false;
  };
  let request =
    format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
  if stream.write_all(request.as_bytes()).is_err() {
    return false;
  }
  let mut reader = BufReader::new(stream);
  let mut status = String::new();
  if reader.read_line(&mut status).is_err() {
    return false;
  }
  status.contains(" 200 ")
}

fn kill_child(mut child: Child) -> std::io::Result<()> {
  let _ = child.kill();
  let _ = child.wait();
  Ok(())
}
