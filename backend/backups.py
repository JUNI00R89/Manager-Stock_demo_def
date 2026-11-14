"""Consistent SQLite copies, verified restores and a daily local backup worker."""
import asyncio
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import tempfile
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def foreign_key_problems(path: Path) -> set[tuple]:
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as conn:
        return {tuple(row) for row in conn.execute('PRAGMA foreign_key_check')}


def verify(path: Path, known_fk_problems: set[tuple] = frozenset()) -> None:
    # closing(): sqlite3's own context manager only commits; an open handle blocks deleting the file on Windows.
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as conn:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('La copia no superó la verificación de integridad SQLite.')
    # Orphan rows already in the source (legacy data) must not block every backup; only new ones mean a bad copy.
    if foreign_key_problems(path) - set(known_fk_problems):
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
        verify(temporary, foreign_key_problems(source))
        try:
            # A hard link publishes atomically and refuses to overwrite a concurrent destination.
            os.link(temporary, target)
        except OSError:
            # No hard links (FAT32/exFAT USB drives, some network shares): exclusive create still refuses to overwrite.
            with temporary.open('rb') as src_file, target.open('xb') as dst_file:
                shutil.copyfileobj(src_file, dst_file)
                dst_file.flush()
                os.fsync(dst_file.fileno())
        target.chmod(0o600)  # holds every tenant's data and password hashes
    finally:
        temporary.unlink(missing_ok=True)
    return target


def sha256_file(path: Path) -> str:
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def create_backup(source: Path, directory: Path, automatic: bool = False) -> Path:
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = directory / f'manager_stock_{stamp}_{uuid.uuid4().hex[:8]}.db'
    copy_verified(source, target)
    digest = sha256_file(target)
    manifest = {'file': target.name, 'source': str(source.resolve()), 'sha256': digest, 'createdAt': datetime.now(timezone.utc).isoformat(), 'integrity': 'ok', 'automatic': automatic}
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
    created = create_backup(source, directory, automatic=True)
    prune_automatic_backups(directory, source)
    return created


def prune_automatic_backups(directory: Path, source: Path, keep: int = 14) -> None:
    """Keeps the newest `keep` automatic daily copies of this database. Manual or older copies (no 'automatic' mark) are never deleted."""
    automatic = []
    for path in directory.glob('manager_stock_*.db'):
        try:
            manifest = json.loads(path.with_suffix('.json').read_text())
        except (OSError, ValueError):
            continue
        if manifest.get('automatic') is True and manifest.get('source') == str(source.resolve()):
            automatic.append(path)
    for path in sorted(automatic, key=lambda p: p.stat().st_mtime, reverse=True)[keep:]:
        path.unlink(missing_ok=True)
        path.with_suffix('.json').unlink(missing_ok=True)


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
