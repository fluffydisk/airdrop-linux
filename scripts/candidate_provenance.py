"""Verify the producer build without depending on its publication bookkeeping."""
REPOSITORY = 'fluffydisk/airdrop-linux'
WORKFLOW = '.github/workflows/flatpak-update-repository.yml'
REQUIRED = {
    'Recreate pinned source recipe and clean offline build',
    'Package verified candidate and download actual r2 baseline',
    'Real signing, update, migration and negative-signature tests',
    'Rehearse existing APT/RPM publisher without production keys',
    'Archive the tested unsigned candidate for protected signing',
}

def verified_build(run, jobs):
    if (run.get('head_branch') != 'main' or
        run.get('head_repository', {}).get('full_name') != REPOSITORY or
        run.get('path') != WORKFLOW or
        run.get('conclusion') not in (None, 'success')):
        return False
    builds = [job for job in jobs if job.get('name') == 'build']
    if len(builds) != 1:
        return False
    build = builds[0]
    if build.get('run_id') != run.get('id') or build.get('conclusion') not in (None, 'success'):
        return False
    steps = build.get('steps') or []
    # Require every named validation gate, artifact upload, runner cleanup and
    # its final completion record. A still-running test or a failed/cancelled
    # step is never sufficient, even when the artifact already exists.
    if not steps or any(s.get('status') != 'completed' or s.get('conclusion') not in ('success', 'skipped') for s in steps):
        return False
    passed = {s.get('name') for s in steps if s.get('conclusion') == 'success'}
    if not REQUIRED.issubset(passed) or not any(n.startswith('Run actions/upload-artifact@') for n in passed):
        return False
    if steps[-1].get('name') != 'Complete job' or steps[-1].get('conclusion') != 'success':
        return False
    return True
