"""Hermes Workbench dashboard backend.

Provides a workspace-scoped text editor API and an authenticated raw shell
PTY for the standalone Workbench plugin.  HTTP routes are mounted by Hermes at
``/api/plugins/workbench``; WebSocket upgrades reuse Hermes' canonical dashboard
authentication gate.
"""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import json
import os
import pty
import select
import signal
import struct
import tempfile
import termios
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

router = APIRouter()

_MAX_TEXT_BYTES = 2 * 1024 * 1024
_MAX_SHELLS = 4
_SHELL_IDLE_SECONDS = 30 * 60
_RESIZE_PREFIX = "\x1b[RESIZE:"
_SENSITIVE_NAMES = frozenset(
    {
        ".env",
        ".netrc",
        ".npmrc",
        ".pypirc",
        "auth.json",
        "config.yaml",
        "credentials.json",
        "gateway_state.json",
        "id_ed25519",
        "id_rsa",
        "known_hosts",
        "nous_auth.json",
    }
)
_SENSITIVE_DIRS = frozenset({".git", ".gnupg", ".ssh", "codex-auth", "secrets"})
_SAFE_HIDDEN_NAMES = frozenset(
    {
        ".dockerignore",
        ".editorconfig",
        ".env.example",
        ".env.sample",
        ".gitattributes",
        ".github",
        ".gitignore",
        ".vscode",
    }
)
_IGNORED_TREE_DIRS = frozenset({".venv", "__pycache__", "node_modules", "venv"})
_active_shells = 0
_shell_lock = asyncio.Lock()


class FileWriteBody(BaseModel):
    """Complete UTF-8 file replacement with optimistic concurrency."""

    content: str = Field(max_length=_MAX_TEXT_BYTES)
    version: str | None = None


def _workspace_root() -> Path:
    """Resolve the single configured Workbench root for this dashboard."""

    configured = ""
    try:
        from hermes_cli.config import cfg_get, load_config

        configured = str(
            cfg_get(load_config(), "dashboard", "workbench", "root", default="")
            or ""
        ).strip()
    except Exception:
        configured = ""

    if configured:
        root = Path(configured).expanduser()
    elif Path("/opt/data").is_dir():
        root = Path("/opt/data")
    else:
        root = Path.cwd()
    try:
        resolved = root.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=500, detail=f"Workbench root is unavailable: {exc}")
    if not resolved.is_dir():
        raise HTTPException(status_code=500, detail="Workbench root is not a directory")
    return resolved


def _shell_limits() -> tuple[int, int]:
    """Read bounded shell concurrency and idle limits from Workbench config."""

    config: dict[str, Any] = {}
    try:
        from hermes_cli.config import cfg_get, load_config

        config = cfg_get(load_config(), "dashboard", "workbench", default={}) or {}
    except Exception:
        config = {}
    try:
        max_shells = int(config.get("max_shells", _MAX_SHELLS))
    except (TypeError, ValueError):
        max_shells = _MAX_SHELLS
    try:
        idle_seconds = int(config.get("shell_idle_timeout_seconds", _SHELL_IDLE_SECONDS))
    except (TypeError, ValueError):
        idle_seconds = _SHELL_IDLE_SECONDS
    return max(1, min(32, max_shells)), max(30, min(24 * 60 * 60, idle_seconds))


def _is_sensitive(relative: Path) -> bool:
    """Return whether a relative path may expose credentials or VCS internals."""

    lowered = [part.lower() for part in relative.parts]
    if any(part in _SENSITIVE_DIRS for part in lowered):
        return True
    if any(part.startswith(".") and part not in _SAFE_HIDDEN_NAMES for part in lowered):
        return True
    name = lowered[-1] if lowered else ""
    if name in _SENSITIVE_NAMES:
        return True
    if name in {".env.example", ".env.sample"}:
        return False
    if any(name.startswith(f"{base}.") or name.startswith(f"{base}-") for base in _SENSITIVE_NAMES):
        return True
    if name.endswith((".key", ".pem")):
        return True
    return name.startswith(".env.") and not name.endswith((".example", ".sample"))


def _hide_from_tree(relative: Path) -> bool:
    """Keep secrets and generated dependency trees out of file navigation."""

    lowered = [part.lower() for part in relative.parts]
    return _is_sensitive(relative) or any(part in _IGNORED_TREE_DIRS for part in lowered)


def _resolve_path(raw_path: str | None, *, must_exist: bool = True) -> tuple[Path, Path]:
    """Resolve one user path beneath the configured root without traversal."""

    root = _workspace_root()
    text = str(raw_path or "").strip()
    candidate = Path(text)
    if candidate.is_absolute():
        unresolved = candidate
    else:
        if ".." in candidate.parts:
            raise HTTPException(status_code=400, detail="Path cannot contain '..'")
        unresolved = root / candidate
    try:
        if must_exist or unresolved.exists():
            resolved = unresolved.resolve(strict=True)
        else:
            resolved = unresolved.parent.resolve(strict=True) / unresolved.name
        relative = resolved.relative_to(root)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Path not found")
    except (OSError, RuntimeError, ValueError):
        raise HTTPException(status_code=403, detail="Path is outside the Workbench root")
    if _is_sensitive(relative):
        raise HTTPException(status_code=403, detail="Sensitive paths are not available")
    return resolved, relative


def _version(data: bytes) -> str:
    """Build the stable content version used by optimistic saves."""

    return hashlib.sha256(data).hexdigest()


def _read_text(path: Path) -> tuple[str, bytes]:
    """Read one bounded UTF-8 text file and reject binary input."""

    try:
        size = path.stat().st_size
        if size > _MAX_TEXT_BYTES:
            raise HTTPException(status_code=413, detail="File is too large to edit")
        data = path.read_bytes()
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="File is not readable")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read file: {exc}")
    if b"\x00" in data:
        raise HTTPException(status_code=415, detail="Binary files cannot be edited")
    try:
        return data.decode("utf-8"), data
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="Only UTF-8 text files can be edited")


def _atomic_write(path: Path, content: str, expected_version: str | None) -> dict[str, Any]:
    """Atomically replace a text file after checking its current version."""

    encoded = content.encode("utf-8")
    if len(encoded) > _MAX_TEXT_BYTES:
        raise HTTPException(status_code=413, detail="File is too large to edit")
    existing_mode = 0o644
    if path.exists():
        if not path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")
        _text, current = _read_text(path)
        current_version = _version(current)
        if expected_version is not None and expected_version != current_version:
            raise HTTPException(
                status_code=409,
                detail={"message": "File changed on disk", "version": current_version},
            )
        existing_mode = path.stat().st_mode & 0o777
    elif expected_version not in (None, ""):
        raise HTTPException(status_code=409, detail="File no longer exists")

    temporary = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as handle:
            temporary = handle.name
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, existing_mode)
        os.replace(temporary, path)
        temporary = ""
    except PermissionError:
        raise HTTPException(status_code=403, detail="File is not writable")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not save file: {exc}")
    finally:
        if temporary:
            try:
                os.unlink(temporary)
            except OSError:
                pass
    return {"ok": True, "version": _version(encoded), "size": len(encoded)}


@router.get("/workspace")
async def workspace(profile: str = "default", session: str = "") -> dict[str, Any]:
    """Return the workspace bound to the selected Hermes session."""

    root = await asyncio.to_thread(_workspace_root)
    identity = hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:16]
    return {
        "workspace": {
            "id": identity,
            "name": root.name or str(root),
            "path": str(root),
            "profile": profile,
            "session_id": session,
        }
    }


@router.get("/files")
async def list_files(path: str = Query(default="")) -> dict[str, Any]:
    """List direct children of one workspace directory."""

    target, relative = await asyncio.to_thread(_resolve_path, path)
    root = await asyncio.to_thread(_workspace_root)
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    def _scan() -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        try:
            children = sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        except PermissionError:
            raise HTTPException(status_code=403, detail="Directory is not readable")
        for child in children:
            try:
                resolved = child.resolve(strict=True)
                child_relative = resolved.relative_to(root)
            except (OSError, RuntimeError, ValueError):
                continue
            if _hide_from_tree(child_relative):
                continue
            try:
                stat = resolved.stat()
            except OSError:
                continue
            entries.append(
                {
                    "name": child.name,
                    "path": child_relative.as_posix(),
                    "type": "directory" if resolved.is_dir() else "file",
                    "size": None if resolved.is_dir() else stat.st_size,
                    "mtime": stat.st_mtime,
                }
            )
        return entries

    return {"path": relative.as_posix(), "entries": await asyncio.to_thread(_scan)}


@router.get("/file")
async def get_file(path: str) -> dict[str, Any]:
    """Return one editable UTF-8 file and its content version."""

    target, relative = await asyncio.to_thread(_resolve_path, path)
    if not target.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    text, data = await asyncio.to_thread(_read_text, target)
    return {
        "path": relative.as_posix(),
        "name": target.name,
        "content": text,
        "version": _version(data),
        "size": len(data),
        "mtime": target.stat().st_mtime,
    }


@router.put("/file")
async def put_file(body: FileWriteBody, path: str) -> dict[str, Any]:
    """Save one UTF-8 file without overwriting unseen external changes."""

    target, relative = await asyncio.to_thread(_resolve_path, path, must_exist=False)
    if not target.parent.is_dir():
        raise HTTPException(status_code=400, detail="Parent directory does not exist")
    result = await asyncio.to_thread(_atomic_write, target, body.content, body.version)
    return {**result, "path": relative.as_posix(), "mtime": target.stat().st_mtime}


def _parse_resize_message(text: str) -> tuple[int, int] | None:
    """Parse JSON or Hermes-compatible CSI terminal resize messages."""

    cols: Any = None
    rows: Any = None
    if text.startswith(_RESIZE_PREFIX) and text.endswith("]"):
        payload = text[len(_RESIZE_PREFIX) : -1]
        try:
            cols, rows = payload.split(";", 1)
        except ValueError:
            return None
    elif text.startswith("{"):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return None
        if payload.get("type") != "resize":
            return None
        cols, rows = payload.get("cols"), payload.get("rows")
    else:
        return None
    try:
        width = max(20, min(500, int(cols)))
        height = max(5, min(200, int(rows)))
    except (TypeError, ValueError):
        return None
    return width, height


def _resize_pty(master_fd: int, cols: int, rows: int) -> None:
    """Apply browser terminal dimensions to the shell PTY."""

    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _read_pty(master_fd: int) -> bytes | None:
    """Read one PTY chunk without permanently occupying an async worker."""

    readable, _, _ = select.select([master_fd], [], [], 0.2)
    if not readable:
        return b""
    try:
        return os.read(master_fd, 65536)
    except OSError:
        return None


def _ws_authorized(websocket: WebSocket) -> bool:
    """Delegate shell upgrade authentication to the Hermes dashboard gate."""

    try:
        from hermes_cli import web_server

        return bool(web_server._ws_auth_ok(websocket))
    except Exception:
        return False


async def _claim_shell(limit: int) -> bool:
    """Reserve one bounded shell slot for this dashboard process."""

    global _active_shells
    async with _shell_lock:
        if _active_shells >= limit:
            return False
        _active_shells += 1
        return True


async def _release_shell() -> None:
    """Return a shell slot after process cleanup."""

    global _active_shells
    async with _shell_lock:
        _active_shells = max(0, _active_shells - 1)


def _spawn_shell(root: Path) -> tuple[int, int]:
    """Spawn the user's raw shell inside the Hermes runtime container."""

    pid, master_fd = pty.fork()
    if pid == 0:  # pragma: no cover - child is replaced by exec immediately
        os.chdir(root)
        env = os.environ.copy()
        env["PWD"] = str(root)
        env.setdefault("TERM", "xterm-256color")
        shell = env.get("SHELL") or "/bin/sh"
        if not Path(shell).is_file():
            shell = "/bin/sh"
        os.execvpe(shell, [shell, "-l"], env)
    return pid, master_fd


def _close_shell(pid: int, master_fd: int) -> None:
    """Close a shell PTY and reap the complete child process group."""

    try:
        os.close(master_fd)
    except OSError:
        pass
    for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            break
        except (PermissionError, OSError):
            try:
                os.kill(pid, sig)
            except OSError:
                break
        try:
            waited, _status = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                return
        except (ChildProcessError, OSError):
            return
        time.sleep(0.05)
    try:
        os.waitpid(pid, 0)
    except (ChildProcessError, OSError):
        pass


def _write_pty(master_fd: int, data: bytes) -> None:
    """Write complete input bytes even when a PTY performs a short write."""

    remaining = memoryview(data)
    while remaining:
        try:
            written = os.write(master_fd, remaining)
            remaining = remaining[written:]
        except BlockingIOError:
            select.select([], [master_fd], [], 0.2)


@router.websocket("/shell")
async def shell_socket(websocket: WebSocket) -> None:
    """Bridge an authenticated browser xterm to a raw container shell PTY."""

    if not _ws_authorized(websocket):
        await websocket.close(code=4401, reason="Unauthorized")
        return
    max_shells, idle_seconds = _shell_limits()
    if not await _claim_shell(max_shells):
        await websocket.close(code=4429, reason="Too many shell sessions")
        return
    await websocket.accept()
    pid = -1
    master_fd = -1
    try:
        root = await asyncio.to_thread(_workspace_root)
        pid, master_fd = await asyncio.to_thread(_spawn_shell, root)

        async def _pump_output() -> None:
            """Forward PTY output until the child exits or the socket closes."""

            while True:
                chunk = await asyncio.to_thread(_read_pty, master_fd)
                if chunk is None:
                    return
                if not chunk:
                    await asyncio.sleep(0)
                    continue
                await websocket.send_bytes(chunk)

        async def _pump_input() -> None:
            """Forward browser input and consume resize control frames."""

            while True:
                try:
                    message = await asyncio.wait_for(
                        websocket.receive(), timeout=idle_seconds
                    )
                except asyncio.TimeoutError:
                    await websocket.close(code=4408, reason="Shell idle timeout")
                    return
                if message.get("type") == "websocket.disconnect":
                    return
                raw = message.get("bytes")
                text = message.get("text")
                if raw is not None:
                    await asyncio.to_thread(_write_pty, master_fd, raw)
                    continue
                if not isinstance(text, str) or not text:
                    continue
                dimensions = _parse_resize_message(text)
                if dimensions is not None:
                    await asyncio.to_thread(_resize_pty, master_fd, *dimensions)
                else:
                    await asyncio.to_thread(_write_pty, master_fd, text.encode("utf-8"))

        output_task = asyncio.create_task(_pump_output())
        input_task = asyncio.create_task(_pump_input())
        done, pending = await asyncio.wait(
            {output_task, input_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            await task
    except WebSocketDisconnect:
        pass
    finally:
        if pid > 0 and master_fd >= 0:
            await asyncio.to_thread(_close_shell, pid, master_fd)
        await _release_shell()
