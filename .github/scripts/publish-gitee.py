#!/usr/bin/env python3
"""Publish the build artifacts to the Gitee OTA repository.

Gitee carries the OTA side of a release: the script on the device reads
version.json from this repository, so github.com never has to be reachable for
an update to work.

The large assets are uploaded on a budget. A GitHub runner reaches Gitee over a
slow international link, and a 38 MB image can take longer than the whole
build, so an upload that runs out of time is skipped and the manifest keeps
pointing at the GitHub copy of that asset. The device falls back to GitHub on
its own when a Gitee asset is missing, so either way the update works.

The token is optional. Without it the step reports that it skipped rather than
failing a build that has already published to GitHub.
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = 'https://gitee.com/api/v5'
TOKEN = os.environ.get('GITEE_TOKEN', '').strip()
REPO = os.environ.get('GITEE_REPO', 'xyinmaster/DMRHub-ota')
GITHUB_REPO = os.environ.get('GITHUB_REPO', '1083808255/DMRHub-openwrt')
BRANCH = os.environ.get('GITEE_BRANCH', 'master')
TAG = os.environ.get('RELEASE_TAG', '').strip()
ARTIFACTS = os.environ.get('ARTIFACTS_DIR', 'artifacts')
BIG_TIMEOUT = int(os.environ.get('GITEE_BIG_TIMEOUT', '600'))

SMALL = ['Packages', 'Packages.gz', 'Packages.sig', 'checksums.sha256', 'version.json']


def die(msg):
    print('Gitee: ' + msg, file=sys.stderr)
    sys.exit(1)


def call(method, path, payload=None, retries=3):
    url = f'{API}{path}'
    url += ('&' if '?' in url else '?') + f'access_token={TOKEN}'
    for attempt in range(1, retries + 1):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read().decode()
            return json.loads(body) if body.strip() else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()[:200]
            if exc.code < 500 or attempt == retries:
                raise SystemExit(f'Gitee: {method} {path} -> {exc.code} {detail}')
            time.sleep(3 * attempt)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == retries:
                raise SystemExit(f'Gitee: {method} {path} -> {exc}')
            time.sleep(3 * attempt)


def find_release():
    for rel in call('GET', f'/repos/{REPO}/releases?per_page=100'):
        if rel.get('tag_name') == TAG:
            return rel
    return None


def ensure_release():
    rel = find_release()
    if rel:
        print(f'Gitee: release {TAG} already exists (id {rel["id"]})')
        return rel
    rel = call('POST', f'/repos/{REPO}/releases', {
        'tag_name': TAG,
        'name': f'DMRHub {TAG}',
        'target_commitish': BRANCH,
        'body': 'OpenWrt 24.10.8 x86_64 固件与 DMRHub 应用包，供设备端 OTA 使用。',
        'prerelease': False,
    })
    print(f'Gitee: created release {TAG} (id {rel["id"]})')
    return rel


def upload(release_id, path, existing, budget):
    """Return True when Gitee holds the file after this call."""
    name = os.path.basename(path)
    if name in existing:
        print(f'Gitee: {name} already attached')
        return True
    url = f'{API}/repos/{REPO}/releases/{release_id}/attach_files?access_token={TOKEN}'
    for attempt in range(1, 3):
        proc = subprocess.run(
            ['curl', '-sS', '--max-time', str(budget), '-X', 'POST', url,
             '-F', f'file=@{path}'],
            capture_output=True, text=True)
        if proc.returncode != 0:
            print(f'Gitee: {name} not uploaded within {budget}s '
                  f'(curl exit {proc.returncode})')
            return False
        body = proc.stdout.strip()
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {'message': body[:200]}
        if data.get('browser_download_url'):
            print(f'Gitee: uploaded {name}')
            return True
        if attempt == 2:
            print(f'Gitee: {name} upload failed: {body[:200]}')
            return False
        time.sleep(5)
    return False


def update_manifest(attached):
    """Point the repository copy of version.json at this release.

    The device reads it from raw/<branch>/version.json, so this file is what
    makes a release visible to OTA. Each asset names its own URL, because only
    some of them made it onto Gitee.
    """
    src = os.path.join(ARTIFACTS, 'version.json')
    with open(src, encoding='utf-8') as fh:
        manifest = json.load(fh)

    gitee_base = f'https://gitee.com/{REPO}/releases/download/{TAG}'
    github_base = f'https://github.com/{GITHUB_REPO}/releases/download/{TAG}'

    for field, url_field in (('app_file', 'app_url'), ('firmware_file', 'firmware_url')):
        name = manifest[field]
        if name in attached:
            manifest[url_field] = f'{gitee_base}/{name}'
        else:
            manifest[url_field] = f'{github_base}/{name}'
            print(f'Gitee: {name} stays on GitHub')

    manifest['release_url'] = f'https://gitee.com/{REPO}/releases/tag/{TAG}'

    payload = {
        'content': base64.b64encode(
            json.dumps(manifest, ensure_ascii=False, indent=2).encode()).decode(),
        'message': f'OTA manifest for {TAG}',
        'branch': BRANCH,
    }
    current = call('GET', f'/repos/{REPO}/contents/version.json?ref={BRANCH}')
    if isinstance(current, dict) and current.get('sha'):
        # The contents API refuses to overwrite a file without its blob sha.
        payload['sha'] = current['sha']
        call('PUT', f'/repos/{REPO}/contents/version.json', payload)
        print('Gitee: updated version.json')
    else:
        call('POST', f'/repos/{REPO}/contents/version.json', payload)
        print('Gitee: created version.json')
    return manifest


def main():
    if not TOKEN:
        print('Gitee: GITEE_TOKEN is not set, skipping the Gitee mirror')
        return
    if not TAG:
        die('RELEASE_TAG is not set')

    release = ensure_release()
    existing = {a['name'] for a in release.get('assets') or []}
    attached = set(existing)

    names = list(SMALL)
    for name in sorted(os.listdir(ARTIFACTS)):
        if name.endswith('.img.gz') or name.endswith('.ipk'):
            names.append(name)

    for name in names:
        path = os.path.join(ARTIFACTS, name)
        if not os.path.exists(path):
            continue
        big = name.endswith('.img.gz') or name.endswith('.ipk')
        if upload(release['id'], path, existing, BIG_TIMEOUT if big else 300):
            attached.add(name)
        else:
            attached.discard(name)

    manifest = update_manifest(attached)
    print(f'Gitee: {TAG} is live, build {manifest["build_tag"]}')


if __name__ == '__main__':
    main()
