"""Resolve a standalone Flatpak recipe without reading files outside its root."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import yaml


def inspect_manifest(manifest):
    manifest = Path(manifest).absolute()
    root = manifest.parent.resolve()
    files, active, sources = {}, set(), []

    def local(name, parent):
        candidate = parent/name
        if Path(name).is_absolute() or not candidate.resolve().is_relative_to(root):
            raise ValueError('Local input escapes the independent recipe: '+str(name))
        if any(p.is_symlink() for p in [candidate, *candidate.parents] if p.is_relative_to(root)):
            raise ValueError('Symlink input is not accepted: '+str(name))
        if not candidate.is_file():
            raise ValueError('Missing local input: '+str(candidate))
        candidate = candidate.resolve()
        files[candidate.relative_to(root).as_posix()] = hashlib.sha256(candidate.read_bytes()).hexdigest()
        return candidate

    def include(name, parent, visit):
        file = local(name, parent)
        if file in active:
            raise ValueError('Recursive input include: '+str(file))
        active.add(file)
        visit(yaml.safe_load(file.read_text()), file.parent)
        active.remove(file)

    def walk_sources(items, parent):
        for source in items:
            if isinstance(source, str):
                include(source, parent, walk_sources)
                continue
            if not isinstance(source, dict):
                raise ValueError('Invalid source description')
            if 'path' in source:
                local(source['path'], parent)
            if 'url' in source:
                if not source['url'].startswith('https://'):
                    raise ValueError('Non-HTTPS source: '+source['url'])
                if source.get('type') == 'git':
                    valid = re.fullmatch('[0-9a-f]{40}', source.get('commit', ''))
                else:
                    valid = any(re.fullmatch('[0-9a-f]{%d}' % size, source.get(key, '')) for key,size in [('sha256',64),('sha512',128)])
                if not valid:
                    raise ValueError('Missing immutable source checksum/commit: '+source['url'])
            sources.append(source)

    def walk_modules(items, parent):
        for module in items:
            if isinstance(module, str):
                include(module, parent, lambda value, directory: walk_modules([value], directory))
            else:
                walk_sources(module.get('sources', []), parent)
                walk_modules(module.get('modules', []), parent)

    local(manifest.name, root)
    data = yaml.safe_load(manifest.read_text())
    walk_modules(data.get('modules', []), root)
    for name in ['flathub.json','README.md']:
        if (root/name).exists():
            local(name, root)
    arches = json.loads((root/'flathub.json').read_text()).get('only-arches') if (root/'flathub.json').exists() else None
    if arches is not None and (not isinstance(arches,list) or not arches or any(arch not in ['x86_64','aarch64'] for arch in arches)):
        raise ValueError('only-arches must be a nonempty list of supported architectures')
    return data, {'manifest':manifest.name, 'expanded_sources':len(sources), 'sha256':files,
                  'only_arches':arches, 'sources':sources}


def stage_manifest(manifest, target):
    data, inventory = inspect_manifest(manifest)
    source = Path(manifest).absolute().parent
    target = Path(target)
    target.mkdir(parents=True, exist_ok=False)
    for name in inventory['sha256']:
        file = target/name
        file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source/name, file)
    assert inspect_manifest(target/Path(manifest).name)[1] == inventory
    return data, inventory
