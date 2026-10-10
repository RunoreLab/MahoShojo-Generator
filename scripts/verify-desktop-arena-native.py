#!/usr/bin/env python3
"""Compile real Desktop Rust modules headlessly, with reproducible source/lock evidence.

This does not validate Tauri IPC/ACL/UI, Windows, OS keyring, or a deployed service.
The synthetic loopback tests never use user credentials or a configurable production origin.
Usage: CARGO_TARGET_DIR=... python3 scripts/verify-desktop-arena-native.py --work-dir /tmp/arena-native
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = ROOT / "apps/desktop/src-tauri"
MODULES = ["ai", "blob", "cloud", "library", "local_card", "maintenance", "provider_profile",
           "provider_target", "public_cache", "secret", "sse", "store", "web_package",
           "package_path", "arena_hosted", "arena_story", "backup", "restore", "export"]
TEST_MODULES = ["ai_contract_tests", "ai_e2e_tests", "test_fixture"]


def run(command, work, log):
    with log.open("w") as output:
        result = subprocess.run(command, cwd=work, stdout=output, stderr=subprocess.STDOUT, check=False)
    if result.returncode:
        raise RuntimeError(f"{command[0]} failed ({result.returncode}); inspect {log}")


def lock_packages(text):
    result = set()
    for block in text.split("[[package]]")[1:]:
        fields = dict(re.findall(r'^(name|version|source|checksum) = "([^"\n]+)"$', block, re.MULTILINE))
        if fields.get("source"):
            result.add(tuple(fields.get(k) for k in ("name", "version", "source", "checksum")))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--cargo", default="cargo")
    parser.add_argument("--all-tests", action="store_true", help="Also run all existing modules' regression tests")
    args = parser.parse_args()
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    manifest = (PRODUCT / "Cargo.toml").read_text()
    manifest = re.sub(r"\[build-dependencies\]\n.*?(?=\n\[)", "", manifest, flags=re.DOTALL)
    manifest = re.sub(r"\[lib\]\n.*?(?=\n\[)", '[lib]\npath = "lib.rs"\n', manifest, flags=re.DOTALL)
    manifest = re.sub(r"^tauri = .*\n", "", manifest, flags=re.MULTILINE)
    (work / "Cargo.toml").write_text(manifest)
    lock = (PRODUCT / "Cargo.lock").read_text()
    (work / "Cargo.lock").write_text(lock)
    facade = '''// Only entry-point callers are absent, so their unused helpers are expected.
#![allow(dead_code)]
extern crate self as tauri;
pub mod ipc {
    pub struct Channel<T>(std::marker::PhantomData<T>);
    impl<T> Channel<T> {
        pub fn send(&self, _: T) -> Result<(), std::convert::Infallible> {
            panic!("Headless tests must exercise the real production test sinks, never this facade")
        }
    }
}
'''
    for name in MODULES + TEST_MODULES:
        if name in TEST_MODULES:
            facade += "#[cfg(test)]\n"
        facade += f'#[path = {json.dumps(str(PRODUCT / "src" / (name + ".rs")))}]\nmod {name};\n'
    (work / "lib.rs").write_text(facade)
    # Cargo only prunes unused platform dependencies; every resolved registry tuple must
    # remain exactly in the production lock. Never permit a quiet dependency upgrade.
    run([args.cargo, "metadata", "--offline", "--format-version", "1"], work, work / "metadata.log")
    if not lock_packages((work / "Cargo.lock").read_text()) <= lock_packages(lock):
        raise RuntimeError("headless dependencies drifted from the production Cargo.lock")
    command = [args.cargo, "test", "--offline", "--locked"]
    if not args.all_tests:
        command.append("arena_hosted")
    command += ["--", "--test-threads=4", "--nocapture"]
    run(command, work, work / "tests.log")
    run([args.cargo, "clippy", "--offline", "--locked", "--all-targets", "--", "-D", "warnings"], work, work / "clippy.log")
    paths = [PRODUCT / "src" / f"{name}.rs" for name in MODULES + TEST_MODULES + ["arena_hosted_tests", "arena_hosted_json", "arena_hosted_json_tests"]]
    paths += sorted((PRODUCT / "src").glob("arena_hosted_*.rs"))
    paths += sorted((PRODUCT / "src").glob("arena_story_*.rs"))
    paths += sorted((PRODUCT / "src/generated").glob("*.json"))
    paths += sorted((ROOT / "packages/contracts/fixtures").glob("desktop-story-*.json"))
    paths += [ROOT / "packages/contracts/fixtures/desktop-arena-hosted.json",
              ROOT / "packages/contracts/fixtures/arena-companion.json", ROOT / "packages/contracts/fixtures/desktop-arena-hosted-json.json",
              ROOT / "packages/contracts/fixtures/arena-companion-utf16.json", ROOT / "packages/contracts/fixtures/arena-companion-error-utf16.json", PRODUCT / "Cargo.toml", PRODUCT / "Cargo.lock", Path(__file__).resolve()]
    hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    (work / "source-verification.json").write_text(json.dumps({
        "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "tree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip(),
        "workingTreeDirty": subprocess.run(["git", "diff", "--quiet", "HEAD"], cwd=ROOT, check=False).returncode != 0,
        "sourceSha256": hashes,
        "harnessSha256": hashlib.sha256(facade.encode()).hexdigest(),
        "productionLockSubsetVerified": True,
        "tests": "all real imported modules" if args.all_tests else "arena_hosted",
        "pending": ["Tauri IPC/ACL/UI", "Windows", "OS keyring", "deployed Hono", "real account and BYOK"],
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"Verified real Rust sources; evidence: {work / 'source-verification.json'}")


if __name__ == "__main__":
    main()
