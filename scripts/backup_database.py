"""Create and verify a consistent local SQLite backup."""
import argparse
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.backups import create_backup

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=Path(os.getenv('MANAGER_STOCK_DB', str(ROOT / 'backend/data/manager_stock.db'))))
parser.add_argument('--directory', type=Path, default=None)
args = parser.parse_args()
directory = args.directory or Path(os.getenv('MANAGER_STOCK_BACKUP_DIR', str(args.source.parent / 'backups')))
try:
    print('Copia creada y verificada:', create_backup(args.source, directory))
except (ValueError, OSError) as exc:
    parser.exit(1, str(exc) + '\n')
