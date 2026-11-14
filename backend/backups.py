"""Consistent SQLite copies, verified restores and a daily local backup worker."""
import asyncio
import hashlib
import json
import logging
import os
import sqlite3
import tempfile
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def verify(path: Path) -> None:
    # closing(): sqlite3's own context manager only commits; an open handle blocks deleting the file on Windows.
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as conn:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('La copia no superó la verificación de integridad SQLite.')
        if conn.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('La copia contiene referencias inválidas.')


def copy_verified(source: Path, target: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError('La base de datos de origen no existe.')
    if target.exists():
        raise FileExistsError('El destino ya existe. Elige una ruta nueva para conservar los datos actuales.')
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.sqlite-copy-', suffix='.tmp', dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as src, closing(sqlite3.connect(temporary)) as dst:
            src.backup(dst)
        verify(temporary)
        # A hard link publishes atomically and refuses to overwrite a concurrent destination.
        os.link(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def sha256_file(path: Path) -> str:
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def create_backup(source: Path, directory: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = directory / f'manager_stock_{stamp}_{uuid.uuid4().hex[:8]}.db'
    copy_verified(source, target)
    digest = sha256_file(target)
    manifest = {'file': target.name, 'source': str(source.resolve()), 'sha256': digest, 'createdAt': datetime.now(timezone.utc).isoformat(), 'integrity': 'ok'}
    target.with_suffix('.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    target.with_suffix('.json').chmod(0o600)
    return target


def restore_backup(source: Path, target: Path) -> Path:
    manifest_path = source.with_suffix('.json')
    if manifest_path.exists():
        expected = json.loads(manifest_path.read_text())['sha256']
        if sha256_file(source) != expected:
            raise ValueError('La copia no coincide con su manifiesto SHA-256.')
    return copy_verified(source, target)


def backup_if_due(source: Path) -> Path | None:
    directory = Path(os.getenv('MANAGER_STOCK_BACKUP_DIR', str(source.parent / 'backups')))
    recent = sorted(directory.glob('manager_stock_*.db'), key=lambda p: p.stat().st_mtime, reverse=True)
    now = datetime.now(timezone.utc).timestamp()
    # Only a complete copy of this database counts; a directory may hold several sources.
    for path in recent:
        if now - path.stat().st_mtime >= 24 * 3600:
            break
        try:
            manifest = json.loads(path.with_suffix('.json').read_text())
            if manifest.get('source') == str(source.resolve()) and manifest.get('integrity') == 'ok':
                return None
        except (OSError, ValueError):
            continue
    return create_backup(source, directory)


async def backup_worker(source: Path):
    while True:
        work = asyncio.create_task(asyncio.to_thread(backup_if_due, source))
        try:
            await asyncio.shield(work)
        except asyncio.CancelledError:
            await work  # Finish an in-progress copy before shutdown removes a temporary database.
            raise
        except Exception:
            logging.getLogger(__name__).exception('No se pudo completar la copia local de seguridad.')
        await asyncio.sleep(3600)
