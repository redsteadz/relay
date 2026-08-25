from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from graphify.analyze import god_nodes, suggest_questions, surprising_connections
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.detect import detect
from graphify.diagnostics import diagnose_extraction
from graphify.export import to_json
from graphify.report import generate


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and validate Relay's directed Graphify artifact"
    )
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--allow-code-only", action="store_true")
    return parser.parse_args()


def source_commit(root: Path) -> str:
    commit = os.environ.get("GITHUB_SHA")
    if commit:
        return commit
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    output_dir = root / "graphify-out"
    graph_path = output_dir / "graph.json"
    report_path = output_dir / "GRAPH_REPORT.md"
    detection = detect(root)

    raw: dict[str, Any] = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes = raw.get("nodes", [])
    edges = raw.get("edges", [])
    require(isinstance(nodes, list) and nodes, "Graphify extraction produced no nodes")
    require(isinstance(edges, list) and edges, "Graphify extraction produced no edges")
    if not args.allow_code_only:
        require(
            raw.get("input_tokens", 0) > 0,
            "Semantic extraction consumed no input tokens",
        )
        require(
            raw.get("output_tokens", 0) > 0,
            "Semantic extraction produced no output tokens",
        )
        expected_sources = {
            Path(source).resolve().relative_to(root).as_posix()
            for category in ("document", "paper", "image")
            for source in detection.get("files", {}).get(category, [])
        }
        extracted_sources = {
            Path(source).as_posix()
            for item in [*nodes, *(raw.get("hyperedges", []) or [])]
            if isinstance(item, dict)
            if (source := item.get("source_file"))
        }
        missing_sources = expected_sources - extracted_sources
        require(
            not missing_sources,
            f"Semantic extraction omitted {len(missing_sources)} detected source files",
        )

    health = diagnose_extraction(raw, directed=True, root=root)
    fatal_health = {
        "non_object_edges": health.get("non_object_edges", 0),
        "missing_endpoint_edges": health.get("missing_endpoint_edges", 0),
        "self_loop_edges": health.get("self_loop_edges", 0),
    }
    require(not health.get("post_build_error"), "Directed graph construction failed")
    require(
        not any(fatal_health.values()),
        "Graphify extraction failed structural health checks",
    )

    graph = build_from_json(raw, directed=True, root=root)
    require(graph.is_directed(), "Graphify artifact is not directed")
    require(graph.number_of_nodes() > 0, "Directed graph contains no nodes")
    require(graph.number_of_edges() > 0, "Directed graph contains no edges")

    communities = cluster(graph)
    labels = {community_id: f"Community {community_id}" for community_id in communities}
    questions = suggest_questions(graph, communities, labels)
    commit = source_commit(root)
    report = generate(
        graph,
        communities,
        score_all(graph.to_undirected(), communities),
        labels,
        god_nodes(graph),
        surprising_connections(graph, communities),
        detection,
        {"input": raw.get("input_tokens", 0), "output": raw.get("output_tokens", 0)},
        str(root),
        suggested_questions=questions,
        built_at_commit=commit,
    )

    wrote = to_json(
        graph,
        communities,
        str(graph_path),
        force=True,
        built_at_commit=commit,
        community_labels=labels,
    )
    require(wrote, "Graphify refused to write the directed artifact")
    report_path.write_text(report, encoding="utf-8")

    final: dict[str, Any] = json.loads(graph_path.read_text(encoding="utf-8"))
    final_nodes = final.get("nodes", [])
    final_edges = final.get("links", [])
    node_ids = [node.get("id") for node in final_nodes]
    node_id_set = set(node_ids)
    require(final.get("directed") is True, "Final Graphify artifact is not directed")
    require(
        final.get("built_at_commit") == commit,
        "Graphify commit provenance is incorrect",
    )
    require(len(node_ids) == len(node_id_set), "Graphify node IDs are not unique")
    require(
        all(
            edge.get("source") in node_id_set and edge.get("target") in node_id_set
            for edge in final_edges
        ),
        "Final Graphify artifact contains dangling edges",
    )
    require(report_path.stat().st_size > 0, "Graphify report is empty")

    digest = hashlib.sha256(graph_path.read_bytes()).hexdigest()
    print("graphify_version=0.9.49")
    print(f"mode={'code-only' if args.allow_code_only else 'deep'}")
    print("directed=true")
    print(f"nodes={len(final_nodes)}")
    print(f"edges={len(final_edges)}")
    print(f"external_endpoint_edges={health.get('dangling_endpoint_edges', 0)}")
    print(
        f"collapsed_relation_variants={health.get('directed_same_endpoint_collapsed_edges', 0)}"
    )
    print("health_errors=0")
    print(f"graph_sha256={digest}")
    print(f"report_bytes={report_path.stat().st_size}")
    print(f"source_commit={commit}")


if __name__ == "__main__":
    main()
