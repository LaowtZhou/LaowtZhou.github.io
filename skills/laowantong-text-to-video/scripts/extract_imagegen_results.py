#!/usr/bin/env python3
"""Extract Codex built-in image_gen PNG results from a session JSONL file.

Use immediately after each image_gen call for long Remotion video jobs:
save one image, update manifest, then continue generating the next image.
"""

from __future__ import annotations

import argparse
import base64
import struct
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PNG_HEADER = b"\x89PNG\r\n\x1a\n"


def png_size(data: bytes) -> tuple[int, int]:
    if not data.startswith(PNG_HEADER):
        raise ValueError("not a PNG")
    if data[12:16] != b"IHDR":
        raise ValueError("missing PNG IHDR chunk")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def load_imagegen_items(session: Path, prompt_filter: str | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with session.open("r", encoding="utf-8") as handle:
        for line in handle:
            if "image_generation_call" not in line or "result" not in line:
                continue
            obj = json.loads(line)
            payload = obj.get("payload", {})
            if payload.get("type") != "image_generation_call" or not payload.get("result"):
                continue
            prompt = payload.get("revised_prompt") or ""
            if prompt_filter and prompt_filter not in prompt:
                continue
            items.append(
                {
                    "timestamp": obj.get("timestamp"),
                    "call_id": payload.get("id"),
                    "prompt": prompt,
                    "result": payload["result"],
                }
            )
    return items


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "items": []}
    return json.loads(path.read_text(encoding="utf-8"))


def upsert_manifest_item(manifest: dict[str, Any], record: dict[str, Any]) -> None:
    items = manifest.setdefault("items", [])
    for index, existing in enumerate(items):
        if existing.get("filename") == record["filename"]:
            items[index] = {**existing, **record}
            return
    items.append(record)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", required=True, type=Path, help="Codex session JSONL path")
    parser.add_argument("--out-dir", required=True, type=Path, help="Directory to write PNG files")
    parser.add_argument("--count", type=int, default=1, help="Number of latest images to extract")
    parser.add_argument("--start-index", type=int, default=1, help="First scene index for output filenames")
    parser.add_argument("--prefix", default="scene", help="Output filename prefix")
    parser.add_argument("--filename", default=None, help="Exact output filename when --count is 1")
    parser.add_argument("--prompt-filter", default=None, help="Only extract imagegen calls whose revised prompt contains this text")
    parser.add_argument("--manifest", type=Path, default=None, help="Manifest JSON path; defaults to <out-dir>/manifest.json")
    parser.add_argument("--min-width", type=int, default=0, help="Reject images narrower than this")
    parser.add_argument("--min-height", type=int, default=0, help="Reject images shorter than this")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing PNGs")
    args = parser.parse_args()

    if args.count < 1:
        raise SystemExit("--count must be >= 1")
    if args.filename and args.count != 1:
        raise SystemExit("--filename can only be used with --count 1")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.manifest or args.out_dir / "manifest.json"

    items = load_imagegen_items(args.session, args.prompt_filter)
    if len(items) < args.count:
        raise SystemExit(f"Expected at least {args.count} matching imagegen results, found {len(items)}")

    selected = items[-args.count :]
    manifest = load_manifest(manifest_path)
    saved_at = datetime.now(timezone.utc).isoformat()

    for offset, item in enumerate(selected):
        scene_index = args.start_index + offset
        filename = args.filename if args.filename else f"{args.prefix}-{scene_index:03d}.png"
        target = args.out_dir / filename
        if target.exists() and not args.overwrite:
            raise SystemExit(f"Refusing to overwrite existing file without --overwrite: {target}")

        data = base64.b64decode(item["result"])
        try:
            width, height = png_size(data)
        except ValueError as exc:
            raise SystemExit(f"Decoded result for {filename} is invalid: {exc}") from exc
        if width < args.min_width or height < args.min_height:
            raise SystemExit(
                f"Refusing undersized image for {filename}: {width}x{height}, "
                f"required at least {args.min_width}x{args.min_height}"
            )
        target.write_bytes(data)

        record = {
            "sceneIndex": scene_index,
            "filename": filename,
            "status": "saved",
            "bytes": target.stat().st_size,
            "width": width,
            "height": height,
            "callId": item["call_id"],
            "imagegenTimestamp": item["timestamp"],
            "savedAt": saved_at,
            "prompt": item["prompt"],
        }
        upsert_manifest_item(manifest, record)
        print(f"saved {filename}\t{width}x{height}\t{record['bytes']}\t{record['callId']}")

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"manifest {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
