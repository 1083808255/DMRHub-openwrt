#!/usr/bin/env python3
"""Deploy a firmware release straight to a DMRHub box on the LAN.

The device downloads nothing: this machine fetches the image, checks it, pushes
it over SSH to the box and runs sysupgrade there with -k -u, so configuration
survives. That makes it the fastest route when github.com is unreachable and
the Gitee mirror is slow to fill.

    DMR88_PASS=... python3 tools/deploy-88.py                # newest release
    DMR88_PASS=... python3 tools/deploy-88.py fw-x86_64-ab12-7
    DMR88_PASS=... python3 tools/deploy-88.py --check        # stop before flashing

Environment: DMR88_HOST (default 192.168.8.8), DMR88_USER (root), DMR88_PASS.
"""
import hashlib
import os
import re
import socket
import subprocess
import sys
import tempfile
import time

import paramiko

HOST = os.environ.get('DMR88_HOST', '192.168.8.8')
USER = os.environ.get('DMR88_USER', 'root')
PASSWORD = os.environ.get('DMR88_PASS', '')
REMOTE_IMAGE = '/tmp/dmrhub-deploy.img.gz'


def connect(timeout=20):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=timeout,
                   allow_agent=False, look_for_keys=False)
    return client


def run(client, command, timeout=120):
    _, out, err = client.exec_command(command, timeout=timeout)
    text = out.read().decode('utf-8', 'replace')
    error = err.read().decode('utf-8', 'replace')
    return text + error


def push(client, local, remote):
    size = os.path.getsize(local)
    stdin, stdout, stderr = client.exec_command(f'cat > {remote}', timeout=1800)
    sent = 0
    with open(local, 'rb') as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            stdin.write(chunk)
            sent += len(chunk)
            pct = sent * 100 // size
            print(f'\r  pushing {pct:3d}%  {sent >> 20} MiB', end='', flush=True)
    stdin.channel.shutdown_write()
    rc = stdout.channel.recv_exit_status()
    print()
    if rc != 0:
        raise SystemExit('push failed: ' + stderr.read().decode('utf-8', 'replace'))


def latest_tag():
    out = subprocess.run(['gh', 'release', 'view', '--repo', '1083808255/DMRHub-openwrt',
                          '--json', 'tagName', '--jq', '.tagName'],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit('cannot read the newest release: ' + out.stderr.strip())
    return out.stdout.strip()


def fetch(tag, workdir):
    subprocess.run(['gh', 'release', 'download', tag, '--repo', '1083808255/DMRHub-openwrt',
                    '--dir', workdir, '--pattern', '*.img.gz',
                    '--pattern', 'checksums.sha256', '--clobber'],
                   check=True, capture_output=True)
    image = next(os.path.join(workdir, f) for f in os.listdir(workdir) if f.endswith('.img.gz'))
    return image


def expected_sum(workdir, image):
    path = os.path.join(workdir, 'checksums.sha256')
    name = os.path.basename(image)
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            if line.strip().endswith(name):
                return line.split()[0]
    return ''


def digest(path):
    sha = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            sha.update(chunk)
    return sha.hexdigest()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check_only = '--check' in sys.argv
    if not PASSWORD:
        raise SystemExit('DMR88_PASS is not set')

    tag = args[0] if args else latest_tag()
    print(f'target: {HOST}  release: {tag}')

    with tempfile.TemporaryDirectory() as workdir:
        print('downloading ...')
        image = fetch(tag, workdir)
        want = expected_sum(workdir, image)
        got = digest(image)
        if want and want != got:
            raise SystemExit(f'sha256 mismatch: expected {want}, got {got}')
        print(f'image: {os.path.basename(image)}  ({os.path.getsize(image) >> 20} MiB)  sha256 ok')

        client = connect()
        print('device: ' + run(client, '/usr/bin/dmrhub --version').strip())
        print('pushing ...')
        push(client, image, REMOTE_IMAGE)
        remote = run(client, f'sha256sum {REMOTE_IMAGE}').split()[0]
        if remote != got:
            raise SystemExit(f'push corrupted the image: {remote} != {got}')
        print('push verified on the device')

        if check_only:
            run(client, f'rm -f {REMOTE_IMAGE}')
            print('--check: stopped before sysupgrade')
            return

        print('flashing, the box will reboot')
        try:
            run(client, f'sysupgrade -k -u {REMOTE_IMAGE}', timeout=30)
        except Exception as exc:
            print('  connection dropped as expected:', type(exc).__name__)
        try:
            client.close()
        except Exception:
            pass

        deadline = time.time() + 300
        while time.time() < deadline:
            time.sleep(8)
            try:
                client = connect(timeout=6)
                print('back: ' + run(client, '/usr/bin/dmrhub --version').strip())
                print('      ' + run(client, '/usr/sbin/dmrhub-ota status 2>&1 | tail -1').strip())
                client.close()
                return
            except Exception:
                print('.', end='', flush=True)
        raise SystemExit('the device did not come back within five minutes')


if __name__ == '__main__':
    main()
