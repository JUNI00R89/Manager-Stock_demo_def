"""Restore into a NEW path; never overwrite a running database."""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.backups import restore_backup

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('target', type=Path)
args = parser.parse_args()
try:
    print('Copia restaurada y verificada:', restore_backup(args.source, args.target))
except (ValueError, OSError) as exc:
    parser.exit(1, str(exc) + '\n')
