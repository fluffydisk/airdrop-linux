#!/usr/bin/env python3
"""Keep transient-update recovery bounded, preserving all trust failures."""
import contextlib
import io
import subprocess
import unittest
from unittest.mock import patch
from public_flatpak_network import update


class UpdateRetry(unittest.TestCase):
    def exercise(self, outputs):
        results = [subprocess.CompletedProcess([], code, output) for code, output in outputs]
        return patch('public_flatpak_network.subprocess.run', side_effect=results)

    def test_transient_recovery_uses_the_identical_standard_update(self):
        error = 'Error: Failed to update application: While pulling app from remote: Server returned HTTP 503\n'
        with self.exercise([(1, error), (0, 'Updated\n')]) as command:
            update('--user', '--noninteractive', 'application//stable', delay=0)
        self.assertEqual(command.call_count, 2)
        self.assertEqual(command.call_args_list[0], command.call_args_list[1])
        self.assertEqual(command.call_args.args[0],
                         ['flatpak', 'update', '--user', '--noninteractive', 'application//stable'])

    def test_persistent_transient_error_keeps_its_failure_exit_code(self):
        with self.exercise([(7, 'error: Server returned HTTP 503\n')] * 3) as command:
            with self.assertRaises(subprocess.CalledProcessError) as failure:
                update('--user', 'application//stable', delay=0)
        self.assertEqual(command.call_count, 3)
        self.assertEqual(failure.exception.returncode, 7)

    def test_trust_permission_and_non_transient_failures_are_not_retried(self):
        for output in ['error: GPG verification failed\n', 'error: Server returned HTTP 403\n',
                       'error: Server returned HTTP 404\n', 'error: certificate verification failed\n',
                       'error: Server returned HTTP 503\nerror: checksum mismatch\n',
                       'Server returned HTTP 503\nerror: Permission denied\n']:
            with self.subTest(output=output), self.exercise([(9, output)]) as command:
                with self.assertRaises(subprocess.CalledProcessError):
                    update('--user', 'application//stable', delay=0)
                self.assertEqual(command.call_count, 1)


if __name__ == '__main__':
    with contextlib.redirect_stdout(io.StringIO()):
        unittest.main()
