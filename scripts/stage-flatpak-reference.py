#!/usr/bin/env python3
"""Stage only declared recipe inputs, architecture policy and review README."""
import argparse
import json
from pathlib import Path
from flatpak_reference_inputs import stage_manifest

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
_, inventory = stage_manifest(args.manifest, args.output)
(args.output/'SHA256SUMS').write_text(''.join(f'{digest}  {name}\n' for name,digest in sorted(inventory['sha256'].items())))
inventory_file = args.output.parent/(args.output.name+'-inventory.json')
with inventory_file.open('x') as file:
    json.dump(inventory,file,indent=2)
    file.write('\n')
print(args.output.resolve())
print(inventory_file.resolve())
