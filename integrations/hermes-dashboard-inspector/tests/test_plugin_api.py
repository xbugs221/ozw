"""Business-contract tests for the Hermes Workbench file and PTY helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from fastapi import HTTPException


def _load_plugin_api():
    """Load the standalone dashboard API without requiring a Python package name."""

    path = Path(__file__).parents[1] / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("hermes_workbench_plugin_api", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def plugin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Bind every path operation to a disposable workspace root."""

    module = _load_plugin_api()
    monkeypatch.setattr(module, "_workspace_root", lambda: tmp_path.resolve())
    return module


def test_path_escape_is_rejected(plugin) -> None:
    """Relative traversal cannot leave the selected workspace."""

    with pytest.raises(HTTPException) as caught:
        plugin._resolve_path("../outside", must_exist=False)
    assert caught.value.status_code == 400


def test_sensitive_file_is_rejected(plugin, tmp_path: Path) -> None:
    """Credential-shaped files remain unavailable to the editor."""

    (tmp_path / ".env").write_text("TOKEN=secret", encoding="utf-8")
    with pytest.raises(HTTPException) as caught:
        plugin._resolve_path(".env")
    assert caught.value.status_code == 403


def test_save_rejects_symlink_outside_workspace(plugin, tmp_path: Path) -> None:
    """Saving through an existing symlink cannot replace an external file."""

    outside = tmp_path.parent / "outside-workbench.txt"
    outside.write_text("outside", encoding="utf-8")
    (tmp_path / "link.txt").symlink_to(outside)
    with pytest.raises(HTTPException) as caught:
        plugin._resolve_path("link.txt", must_exist=False)
    assert caught.value.status_code == 403


def test_atomic_save_uses_content_versions(plugin, tmp_path: Path) -> None:
    """A stale editor cannot overwrite a file changed by another process."""

    target = tmp_path / "notes.md"
    target.write_text("first", encoding="utf-8")
    initial = plugin._version(b"first")
    saved = plugin._atomic_write(target, "second", initial)
    assert target.read_text(encoding="utf-8") == "second"
    assert saved["version"] == plugin._version(b"second")

    with pytest.raises(HTTPException) as caught:
        plugin._atomic_write(target, "stale", initial)
    assert caught.value.status_code == 409
    assert target.read_text(encoding="utf-8") == "second"


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("\x1b[RESIZE:120;40]", (120, 40)),
        ('{"type":"resize","cols":90,"rows":24}', (90, 24)),
        ("not-a-resize", None),
        ('{"type":"input","data":"x"}', None),
    ],
)
def test_resize_protocol(plugin, message: str, expected) -> None:
    """Both Hermes CSI and JSON shell resize frames share one parser."""

    assert plugin._parse_resize_message(message) == expected
