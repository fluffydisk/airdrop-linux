"""Bounded retries for public-channel acceptance updates on a disposable CI VM.

Use the same ordinary Flatpak transaction on each attempt. Repository/commit
signature verification and post-update assertions remain unchanged.
"""
import os
import re
import subprocess
import time


def update(*args, attempts=3, delay=5):
    command = ['flatpak', 'update', *map(str, args)]
    for attempt in range(attempts):
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding='utf-8', errors='backslashreplace',
                                env={**os.environ, 'LC_ALL': 'C'})
        print(result.stdout, end='', flush=True)
        if result.returncode == 0:
            return result
        # Only an explicit Flatpak/OSTree HTTP error is retryable. Integrity,
        # trust, permissions and other failures keep their original exit code.
        errors = [line for line in result.stdout.splitlines()
                  if re.match(r'(?i)^error:', line)]
        transient = errors and all(re.search(r'\bServer returned HTTP (429|500|502|503|504)\b', line)
                                   for line in errors)
        integrity = re.search(r'signature|checksum|certificate|corrupt|permission denied',
                              result.stdout, re.I)
        if not transient or integrity or attempt + 1 == attempts:
            result.check_returncode()
        print(f'Transient HTTP response; retrying the same verified Flatpak update '
              f'({attempt + 2}/{attempts})', flush=True)
        time.sleep(delay * (attempt + 1))
