#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parents[1]
ARTICLE_DIR = ROOT / "content" / "articles"
IMAGE_DIR = ROOT / "public" / "images" / "articles"
REDIRECTS_PATH = ROOT / "src" / "lib" / "slug-redirects.ts"
YEAR_SLUG = re.compile(r"^(?P<base>.+)-20\d\d$")
IMAGE_YEAR_SEGMENT = re.compile(r"/images/articles/[^/]*-20\d\d/")
PREFIXED_LOCALES = ("es", "pt", "fr", "de", "it")


def fail(message: str) -> NoReturn:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def run_git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        fail(f"git {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


def build_rename_map() -> dict[str, str]:
    renames: dict[str, str] = {}
    for path in sorted(ARTICLE_DIR.glob("*.json")):
        match = YEAR_SLUG.match(path.stem)
        if match:
            renames[path.stem] = match.group("base")
    return dict(sorted(renames.items()))


def assert_clean_worktree() -> None:
    status = run_git(["status", "--porcelain"])
    if status.strip():
        fail("working tree is not clean; refusing --write\n" + status.rstrip())


def preflight(renames: dict[str, str], *, write: bool) -> None:
    if len(renames) != 24:
        fail(f"expected 24 year-suffixed article slugs, found {len(renames)}")

    new_values = list(renames.values())
    duplicates = sorted({slug for slug in new_values if new_values.count(slug) > 1})
    if duplicates:
        fail(f"de-yeared slug duplicates: {', '.join(duplicates)}")

    for old, new in renames.items():
        if (ARTICLE_DIR / f"{new}.json").exists():
            fail(f"target article already exists for {old}: content/articles/{new}.json")
        if (IMAGE_DIR / new).exists():
            fail(f"target image dir already exists for {old}: public/images/articles/{new}/")
        if not (IMAGE_DIR / old).is_dir():
            fail(f"missing image dir for {old}: public/images/articles/{old}/")

    if write:
        assert_clean_worktree()


def occurrence_is_allowed(text: str, index: int) -> bool:
    prefix = text[max(0, index - 30) : index]
    return (
        "/images/articles/" in prefix
        or prefix.endswith("travelplaninfo.com/")
        or prefix.endswith('"slug": "')
        or prefix.endswith("/")
    )


def rewrite_article(old: str, new: str, *, write: bool) -> tuple[int, int]:
    old_path = ARTICLE_DIR / f"{old}.json"
    new_path = ARTICLE_DIR / f"{new}.json"
    text = old_path.read_text(encoding="utf-8")
    indexes = [match.start() for match in re.finditer(re.escape(old), text)]

    for index in indexes:
        if not occurrence_is_allowed(text, index):
            context = text[max(0, index - 80) : index + len(old) + 80].replace("\n", "\\n")
            fail(f"unsafe occurrence in {old} at byte {index}: {context}")

    rewritten = text.replace(old, new)
    try:
        parsed: object = json.loads(rewritten)
    except json.JSONDecodeError as exc:
        fail(f"rewritten JSON is invalid for {old}: {exc}")

    if not isinstance(parsed, dict):
        fail(f"rewritten JSON root is not an object for {old}")

    if parsed.get("slug") != new:
        fail(f"rewritten slug mismatch for {old}: {parsed.get('slug')!r} != {new!r}")

    canonical = parsed.get("seo", {}).get("canonical")
    expected_canonical = f"https://travelplaninfo.com/{new}/"
    if canonical != expected_canonical:
        fail(f"canonical mismatch for {old}: {canonical!r} != {expected_canonical!r}")

    for key_path in (("featuredImage",), ("seo", "ogImage")):
        value: object = parsed
        for key in key_path:
            value = value.get(key) if isinstance(value, dict) else None
        if isinstance(value, str) and IMAGE_YEAR_SEGMENT.search(value):
            fail(f"{'.'.join(key_path)} still contains year-suffixed image dir for {old}: {value}")

    src_rewrites = len(re.findall(rf"/images/articles/{re.escape(old)}/", text))

    if write:
        run_git(["mv", str(old_path.relative_to(ROOT)), str(new_path.relative_to(ROOT))])
        new_path.write_text(rewritten, encoding="utf-8")

    return len(indexes), src_rewrites


def rename_images(old: str, new: str, *, write: bool) -> int:
    old_dir = IMAGE_DIR / old
    new_dir = IMAGE_DIR / new
    prefixed_files = sorted(path for path in old_dir.iterdir() if path.is_file() and path.name.startswith(old))

    if write:
        run_git(["mv", str(old_dir.relative_to(ROOT)), str(new_dir.relative_to(ROOT))])
        for path in sorted(new_dir.iterdir()):
            if path.is_file() and path.name.startswith(old):
                target = path.with_name(new + path.name[len(old) :])
                run_git(["mv", str(path.relative_to(ROOT)), str(target.relative_to(ROOT))])

    return len(prefixed_files)


def render_redirects(renames: dict[str, str]) -> str:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    entries = ",\n".join(f'  "{old}": "{new}"' for old, new in renames.items())
    return f'''// GENERATED by scripts/rename_evergreen_slugs.py on {generated_at} — do not hand-edit.
// Checked in deliberately: after the rename the old slugs no longer exist on disk,
// so this map cannot be re-derived. It is the source of truth for the 301/308s.
export const SLUG_RENAMES: Readonly<Record<string, string>> = {{
{entries},
}};

// Non-default locales get an explicit prefix; `en` is served bare (localePrefix: "as-needed").
export const PREFIXED_LOCALES = ["es", "pt", "fr", "de", "it"] as const;

export interface SlugRedirect {{
  source: string;
  destination: string;
  permanent: boolean;
}}

export function buildSlugRedirects(): SlugRedirect[] {{
  return Object.entries(SLUG_RENAMES).flatMap(([oldSlug, newSlug]) => [
    {{ source: `/${{oldSlug}}/`, destination: `/${{newSlug}}/`, permanent: true }},
    ...PREFIXED_LOCALES.map((locale) => ({{
      source: `/${{locale}}/${{oldSlug}}/`,
      destination: `/${{locale}}/${{newSlug}}/`,
      permanent: true,
    }})),
  ]);
}}
'''


def remaining_year_image_refs() -> int:
    count = 0
    for path in ARTICLE_DIR.glob("*.json"):
        count += len(IMAGE_YEAR_SEGMENT.findall(path.read_text(encoding="utf-8")))
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Rename TPI year-suffixed article slugs to evergreen slugs.")
    parser.add_argument("--write", action="store_true", help="Apply the rename plan. Defaults to dry run.")
    args = parser.parse_args()

    renames = build_rename_map()
    preflight(renames, write=args.write)

    total_occurrences = 0
    total_src_rewrites = 0
    image_files_renamed = 0

    print(f"Mode: {'WRITE' if args.write else 'DRY RUN'}")
    print(f"Article renames: {len(renames)}")
    for old, new in renames.items():
        occurrence_count, src_rewrites = rewrite_article(old, new, write=args.write)
        renamed_files = rename_images(old, new, write=args.write)
        total_occurrences += occurrence_count
        total_src_rewrites += src_rewrites
        image_files_renamed += renamed_files
        print(f"  {old} -> {new} ({occurrence_count} text replacements, {src_rewrites} src rewrites, {renamed_files} image file renames)")

    if args.write:
        REDIRECTS_PATH.write_text(render_redirects(renames), encoding="utf-8")

    remaining = remaining_year_image_refs()
    if args.write and remaining != 0:
        fail(f"remaining /images/articles/*-20[0-9][0-9]/ strings across content/articles: {remaining}")

    print("Post-flight report:")
    print(f"  files_renamed: {len(renames) if args.write else 0}")
    print(f"  image_dirs_renamed: {len(renames) if args.write else 0}")
    print(f"  image_files_renamed: {image_files_renamed if args.write else 0}")
    print(f"  total_src_rewrites: {total_src_rewrites}")
    print(f"  remaining_year_image_dir_refs: {remaining}")


if __name__ == "__main__":
    main()
