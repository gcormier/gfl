#!/usr/bin/env python3
"""
hardware-gen: headless hardware 3D/2D generation pipeline.

Subcommands
-----------
generate  (default)
    uv run generate.py                       # process all YAML files in ./config/
    uv run generate.py config/bolts_screws.yaml
    uv run generate.py --engine freecad --verbose config/nuts.yaml

scaffold  <ID>
    hardware-gen scaffold ISO8752            # emit a ready-to-paste render snippet
    hardware-gen scaffold ISO8752 --list     # show all valid sizes and lengths

dump-caps
    hardware-gen dump-caps                   # regenerate fastener_capabilities.json
                                             # and docs/fastener-parameters.md
                                             # (requires FreeCAD)

The ``generate`` subcommand runs a two-stage pipeline per fastener:
  Stage 1 – generate a 3D solid (STEP or .FCStd) → ./build/
  Stage 2 – project 2D SVG views                 → ./output/
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

import yaml  # PyYAML

from pipeline.build123d_engine import Build123dEngine  # noqa: F401
from pipeline.capabilities import (
    get_standard_info,
    pick_default_length,
    pick_default_size,
)
from pipeline.engine_base import CADEngine, get_engine

# Load both engine modules so their @register_engine decorators fire.
from pipeline.freecad_engine import FreeCADEngine  # noqa: F401
from pipeline.models import FastenerSpec, HardwareConfig
from pipeline.standards import (
    UnknownStandardError,
    resolve_standard,
    validate_standard,
)

# ── Paths ─────────────────────────────────────────────────────────────────────

_ROOT              = Path(__file__).parent
_CONFIG_DIR        = _ROOT / "config"
_BUILD_DIR         = _ROOT / "build"
_OUTPUT_DIR        = _ROOT / "output"
_CAPABILITIES_JSON = _ROOT / "pipeline" / "fastener_capabilities.json"
_PARAMETERS_MD     = _ROOT / "docs" / "fastener-parameters.md"

# ── Subcommand names (used for backward-compat defaulting) ───────────────────

_SUBCOMMANDS = {"generate", "scaffold", "dump-caps"}


# ── CLI ───────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="hardware-gen",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="command", metavar="SUBCOMMAND")

    # ── generate ──────────────────────────────────────────────────────────────
    gen = sub.add_parser(
        "generate",
        help="Run the 3D/2D generation pipeline (default when no subcommand given).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    gen.add_argument(
        "config_files",
        nargs="*",
        metavar="CONFIG",
        help=(
            "YAML config file(s) to process. "
            "If omitted, all *.yaml files in ./config/ are discovered automatically."
        ),
    )
    gen.add_argument(
        "--engine",
        default="freecad",
        choices=["freecad", "build123d"],
        help="CAD engine backend to use (default: freecad).",
    )
    gen.add_argument(
        "--build-dir",
        default=str(_BUILD_DIR),
        metavar="DIR",
        help="Directory for intermediate 3D artifacts (default: ./build/).",
    )
    gen.add_argument(
        "--output-dir",
        default=str(_OUTPUT_DIR),
        metavar="DIR",
        help="Directory for final SVG outputs (default: ./output/).",
    )
    gen.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable DEBUG-level logging (includes full freecadcmd output).",
    )
    gen.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate configs but do not call the CAD engine.",
    )

    # ── scaffold ──────────────────────────────────────────────────────────────
    scaf = sub.add_parser(
        "scaffold",
        help="Emit a ready-to-paste YAML render snippet for a standard.",
    )
    scaf.add_argument(
        "standard_id",
        metavar="ID",
        help="Standard identifier, e.g. ISO8752 or iso4762.",
    )
    scaf.add_argument(
        "--list",
        action="store_true",
        dest="list_all",
        help="List all available sizes and lengths instead of emitting a snippet.",
    )

    # ── dump-caps ─────────────────────────────────────────────────────────────
    dump = sub.add_parser(
        "dump-caps",
        help=(
            "Regenerate pipeline/fastener_capabilities.json and "
            "docs/fastener-parameters.md (requires FreeCAD)."
        ),
    )
    dump.add_argument(
        "--out",
        default=str(_CAPABILITIES_JSON),
        metavar="PATH",
        help=f"Output path for the capabilities JSON (default: {_CAPABILITIES_JSON}).",
    )

    return p


# ── YAML loading ──────────────────────────────────────────────────────────────

def _load_config(path: Path) -> HardwareConfig:
    with path.open("r", encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f) or {}
    return HardwareConfig.from_dict(raw, source_file=str(path))


def _discover_configs(config_dir: Path) -> list[Path]:
    found = sorted(
        list(config_dir.glob("*.yaml")) + list(config_dir.glob("*.yml"))
    )
    if not found:
        raise FileNotFoundError(
            f"No YAML files found in config directory: {config_dir}\n"
            "Create a YAML file there or pass a file path explicitly."
        )
    return found


# ── Standards resolution ──────────────────────────────────────────────────────

def _resolve_spec_standards(spec: FastenerSpec) -> FastenerSpec:
    """
    Normalise *spec.standard* to its canonical workbench name and validate it.

    Raises :class:`UnknownStandardError` if the resolved name is not a FreeCAD
    Fasteners workbench standard. Only renders reach here, so catalog-only
    entries are never validated against the workbench.
    """
    spec.standard = resolve_standard(spec.standard)
    validate_standard(spec.standard)
    return spec


# ── Pipeline orchestration ────────────────────────────────────────────────────

def _run_pipeline(
    spec: FastenerSpec,
    engine: CADEngine | None,
    dry_run: bool,
    log: logging.Logger,
) -> bool:
    log.info("── %s [%s %s] ──", spec.name, spec.standard, spec.size)

    if dry_run:
        log.info("  [dry-run] would generate views: %s", spec.views)
        return True

    assert engine is not None
    try:
        model_path = engine.generate_3d(spec)

        if spec.views:
            svg_paths = engine.generate_2d(spec, model_path)
            for p in svg_paths:
                log.info("  → %s", p)
        else:
            log.info("  No 2D views requested; skipping Stage 2.")

        return True

    except Exception as exc:  # noqa: BLE001
        log.error("FAILED %s: %s", spec.name, exc)
        return False


# ── generate subcommand ───────────────────────────────────────────────────────

def _cmd_generate(args: argparse.Namespace, log: logging.Logger) -> int:
    if args.config_files:
        config_paths = [Path(p) for p in args.config_files]
        missing = [p for p in config_paths if not p.exists()]
        if missing:
            for m in missing:
                log.error("Config file not found: %s", m)
            return 1
    else:
        try:
            config_paths = _discover_configs(_CONFIG_DIR)
        except FileNotFoundError as exc:
            log.error("%s", exc)
            return 1

    log.info("Config files: %s", [str(p) for p in config_paths])

    engine: CADEngine | None = None
    if not args.dry_run:
        engine_cls = get_engine(args.engine)
        try:
            engine = engine_cls(
                build_dir=Path(args.build_dir),
                output_dir=Path(args.output_dir),
            )
            log.info("Engine: %s", engine.name)
        except RuntimeError as exc:
            log.error("Engine init failed: %s", exc)
            return 1

    total = passed = failed = 0

    for config_path in config_paths:
        log.info("=== Processing: %s ===", config_path)
        try:
            config = _load_config(config_path)
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to load config '%s': %s", config_path, exc)
            failed += 1
            continue

        specs = config.fastener_specs()
        if not specs:
            log.warning("No renders defined in: %s", config_path)
            continue

        for spec in specs:
            total += 1
            try:
                spec = _resolve_spec_standards(spec)
            except UnknownStandardError as exc:
                log.error("── %s ── %s", spec.name, exc)
                failed += 1
                continue
            ok = _run_pipeline(spec, engine, dry_run=args.dry_run, log=log)
            if ok:
                passed += 1
            else:
                failed += 1

    log.info("=" * 60)
    log.info("Done. Total: %d  Passed: %d  Failed: %d", total, passed, failed)
    return 0 if failed == 0 else 1


# ── scaffold subcommand ───────────────────────────────────────────────────────

def _cmd_scaffold(args: argparse.Namespace) -> int:
    std_id = resolve_standard(args.standard_id)
    info = get_standard_info(std_id)

    if info is None:
        print(
            f"error: '{std_id}' not found in the fastener capabilities snapshot.\n"
            "Check that it is a valid FreeCAD Fasteners workbench standard.\n"
            "If you recently upgraded FreeCAD/Fasteners, regenerate: hardware-gen dump-caps",
            file=sys.stderr,
        )
        return 1

    sizes: list[str] = info["sizes"]
    lengths_by_size: dict[str, list[str]] = info["lengths_by_size"]
    category: str = info["category"]

    if args.list_all:
        print(f"Standard: {std_id}  (category: {category})")
        print(f"{'Size':<12}  Lengths")
        print("-" * 60)
        for size in sizes:
            lengths = lengths_by_size.get(size, [])
            lengths_str = ", ".join(lengths) if lengths else "—"
            print(f"  {size:<10}  {lengths_str}")
        return 0

    # Emit YAML snippet
    default_size = pick_default_size(sizes)
    lengths_for_size = lengths_by_size.get(default_size, [])
    default_length = pick_default_length(lengths_for_size)

    size_comment = f"# median of {len(sizes)} sizes ({sizes[0]} .. {sizes[-1]})"
    snippet_lines = [
        f"# Scaffold for {std_id} — {category}",
        f"# {len(sizes)} available sizes: {sizes[0]} .. {sizes[-1]}",
        "# Edit size/length to match your use case.",
        f"# Run `hardware-gen scaffold {std_id} --list` to see all sizes and lengths.",
        "renders:",
        f"  - size: {default_size}    {size_comment}",
    ]

    if default_length is not None:
        available_preview = ", ".join(lengths_for_size[:6])
        if len(lengths_for_size) > 6:
            available_preview += ", …"
        snippet_lines.append(
            f"    length: {default_length}"
            f"    # ~10th percentile for {default_size} (available: {available_preview})"
        )

    snippet_lines.append("    views: [iso, top]")

    print("\n".join(snippet_lines))
    return 0


# ── dump-caps subcommand ──────────────────────────────────────────────────────

def _render_parameters_md(capabilities_json_path: Path, md_path: Path) -> None:
    """Generate docs/fastener-parameters.md from the capabilities JSON."""
    data = json.loads(capabilities_json_path.read_text(encoding="utf-8"))
    standards: dict[str, dict[str, Any]] = data.get("standards", {})
    version: str = data.get("freecad_version", "unknown")

    # Group by category
    by_category: dict[str, list[str]] = {}
    for std_name, info in sorted(standards.items()):
        cat = info.get("category", "Other")
        by_category.setdefault(cat, []).append(std_name)

    lines = [
        "# Fastener Parameter Reference",
        "",
        f"_Generated from FreeCAD Fasteners workbench v{version} — do not edit by hand._",
        "_Regenerate: `hardware-gen dump-caps`_",
        "",
    ]

    for category in sorted(by_category):
        lines += [f"## {category}", ""]
        lines += ["| Standard | Available Sizes | Length range per size |",
                  "|----------|-----------------|-----------------------|"]
        for std_name in by_category[category]:
            info = standards[std_name]
            sizes: list[str] = info["sizes"]
            lbs: dict[str, list[str]] = info["lengths_by_size"]

            sizes_str = ", ".join(sizes) if len(sizes) <= 6 else f"{sizes[0]}, …, {sizes[-1]}"

            if not lbs:
                length_str = "N/A"
            else:
                parts = []
                for size in sizes:
                    if size in lbs:
                        ls = lbs[size]
                        parts.append(f"{size}: {ls[0]}–{ls[-1]}")
                # Show at most 4 entries to keep the table readable
                if len(parts) > 4:
                    length_str = " · ".join(parts[:2]) + " · … · " + parts[-1]
                else:
                    length_str = " · ".join(parts)

            lines.append(f"| {std_name} | {sizes_str} | {length_str} |")
        lines.append("")

    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text("\n".join(lines), encoding="utf-8")


def _cmd_dump_caps(args: argparse.Namespace, log: logging.Logger) -> int:
    out_path = Path(args.out)

    # Use the FreeCAD engine's script runner to call dump_fastener_capabilities.py
    try:
        engine = FreeCADEngine(build_dir=_BUILD_DIR, output_dir=_OUTPUT_DIR)
    except RuntimeError as exc:
        log.error("FreeCAD not available: %s", exc)
        return 1

    script = _ROOT / "freecad_scripts" / "dump_fastener_capabilities.py"
    params = {"mode": "dump", "path": str(out_path)}

    log.info("Running dump_fastener_capabilities.py → %s", out_path)
    try:
        engine._run_freecad_script(script, params)
    except Exception as exc:  # noqa: BLE001
        log.error("dump-caps failed: %s", exc)
        return 1

    log.info("Generated %s", out_path)

    # Render the human-readable markdown table from the JSON just written
    log.info("Rendering %s", _PARAMETERS_MD)
    try:
        _render_parameters_md(out_path, _PARAMETERS_MD)
    except Exception as exc:  # noqa: BLE001
        log.error("Failed to render parameters markdown: %s", exc)
        return 1

    log.info("Generated %s", _PARAMETERS_MD)
    return 0


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    # Backward-compat: if the first argument is not a known subcommand, default
    # to "generate" so that existing calls like `hardware-gen config/nuts.yaml`
    # and `hardware-gen --verbose` continue to work unchanged.
    if not (len(sys.argv) > 1 and sys.argv[1] in _SUBCOMMANDS):
        sys.argv.insert(1, "generate")

    parser = _build_parser()
    args   = parser.parse_args()

    # generate has its own verbose flag; other subcommands use INFO by default
    verbose = getattr(args, "verbose", False)
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("hw-gen")

    if args.command == "scaffold":
        return _cmd_scaffold(args)

    if args.command == "dump-caps":
        return _cmd_dump_caps(args, log)

    # generate (default)
    return _cmd_generate(args, log)
