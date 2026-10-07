#!/usr/bin/env python3
"""Evaluate transcription + diarization against a speaker-labelled reference.

Compares two hypotheses on the SAME audio (e.g. before/after a model or
config change, or the service output vs a corrected reference). Three metrics:

1. WER ......... plain word error rate (transcription accuracy, ignores speakers)
2. DER ......... diarization error rate vs reference speaker turns
               (frame-based, 0.25s collar, approximate — for formal scoring
               use pyannote.metrics on RTTM exports instead)
3. cpWER ....... concatenated minimum-permutation WER (speaker-attributed
               transcription accuracy). Concatenates each speaker's words and
               takes the best speaker mapping, so moving "Terrible." from the
               client to the therapist is penalised even when plain WER is 0.

Reference format (JSON):
    [{"start": 0.0, "end": 2.1, "speaker": "SPEAKER_00", "text": "How did ..."}, ...]

Usage:
    # score two saved hypothesis files against a reference
    python3 compare_backends.py --ref ref.json \\
        --hyp-a baseline.json --hyp-b candidate.json

    # end-to-end: transcribe audio with the running service, then score it
    python3 compare_backends.py --ref ref.json --audio session.wav \\
        --api http://localhost:8000 --num-speakers 2

Hypothesis format (same as GET /status result.result):
    {"segments": [{"start":..,"end":..,"text":..,"speaker":..}], "language": "en"}

Stdlib only — no model downloads, safe for CI.
"""

import argparse
import itertools
import json
import sys
import time
import urllib.request
from typing import Dict, List, Tuple


# --------------------------------------------------------------------------
# text utils
# --------------------------------------------------------------------------

def normalize(text: str) -> List[str]:
    import re
    import string

    text = text.lower()
    text = text.translate(str.maketrans("", "", string.punctuation))
    text = re.sub(r"\s+", " ", text).strip()
    return text.split() if text else []


def edit_distance(ref: List[str], hyp: List[str]) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i]
        for j, h in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = cur
    return prev[len(hyp)]


def wer(ref_words: List[str], hyp_words: List[str]) -> Tuple[float, int, int]:
    """Return (wer, errors, ref_len)."""
    if not ref_words:
        return (0.0 if not hyp_words else 1.0), len(hyp_words), 0
    return edit_distance(ref_words, hyp_words) / len(ref_words), edit_distance(
        ref_words, hyp_words
    ), len(ref_words)


# --------------------------------------------------------------------------
# hypothesis / reference loading
# --------------------------------------------------------------------------

def load_segments(path: str) -> List[dict]:
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "segments" in data:
        data = data["segments"]
    return data


def words_of(segments: List[dict]) -> List[str]:
    out: List[str] = []
    for seg in segments:
        out.extend(normalize(seg.get("text", "")))
    return out


def per_speaker_text(segments: List[dict]) -> Dict[str, List[str]]:
    grouped: Dict[str, List[str]] = {}
    for seg in segments:
        spk = seg.get("speaker") or "UNKNOWN"
        grouped.setdefault(spk, []).extend(normalize(seg.get("text", "")))
    return grouped


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------

def metric_wer(ref: List[dict], hyp: List[dict]) -> dict:
    ref_w, hyp_w = words_of(ref), words_of(hyp)
    score, errors, n = wer(ref_w, hyp_w)
    return {"wer": round(score, 4), "errors": errors, "ref_words": n}


def metric_cpwer(ref: List[dict], hyp: List[dict]) -> dict:
    """Concatenated minimum-permutation WER across speaker mappings."""
    ref_spk = per_speaker_text(ref)
    hyp_spk = per_speaker_text(hyp)
    ref_ids, hyp_ids = list(ref_spk), list(hyp_spk)
    if not ref_ids or not hyp_ids:
        return {"cpwer": None, "note": "missing speaker labels"}
    # Try every mapping from hyp speakers onto ref speakers (pad/truncate).
    best = None
    import itertools as _it

    pool = hyp_ids + [""] * max(0, len(ref_ids) - len(hyp_ids))
    for perm in set(_it.permutations(pool, len(ref_ids))):
        total_err, total_n = 0, 0
        for rid, hid in zip(ref_ids, perm):
            hw = hyp_spk.get(hid, [])
            e = edit_distance(ref_spk[rid], hw)
            total_err += e
            total_n += len(ref_spk[rid])
        score = total_err / total_n if total_n else 0.0
        if best is None or score < best[0]:
            best = (score, dict(zip(ref_ids, perm)), total_err, total_n)
    assert best is not None
    return {
        "cpwer": round(best[0], 4),
        "mapping": best[1],
        "errors": best[2],
        "ref_words": best[3],
    }


def metric_der(
    ref: List[dict], hyp: List[dict], collar: float = 0.25, frame: float = 0.01
) -> dict:
    """Approximate frame-based DER with a no-score collar around ref boundaries."""
    if not ref:
        return {"der": None, "note": "empty reference"}
    end = max(max(s["end"] for s in ref), max((s["end"] for s in hyp), default=0.0))
    boundaries = sorted({s["start"] for s in ref} | {s["end"] for s in ref})

    def speaker_at(segments: List[dict], t: float):
        for s in segments:
            if s["start"] <= t < s["end"]:
                return s.get("speaker")
        return None

    def in_collar(t: float) -> bool:
        return any(abs(t - b) < collar for b in boundaries)

    fa = miss = conf = total = 0
    t = 0.0
    while t < end:
        if in_collar(t):
            t += frame
            continue
        r, h = speaker_at(ref, t), speaker_at(hyp, t)
        if r is None and h is None:
            pass
        elif r is None:
            fa += 1
            total += 1
        elif h is None:
            miss += 1
            total += 1
        else:
            total += 1
            if r != h:
                # Speaker IDs are arbitrary: remap by best global permutation.
                conf += 1
        t += frame
    # Confusion over-counts when hyp labels are permuted; fix with a global
    # majority mapping pass.
    mapping = _speaker_mapping(ref, hyp, frame)
    conf2 = fa2 = miss2 = total2 = 0
    t = 0.0
    while t < end:
        if in_collar(t):
            t += frame
            continue
        r, h = speaker_at(ref, t), speaker_at(hyp, t)
        h_mapped = mapping.get(h, h) if h is not None else None
        if r is None and h is None:
            pass
        elif r is None:
            fa2 += 1
            total2 += 1
        elif h is None:
            miss2 += 1
            total2 += 1
        else:
            total2 += 1
            if r != h_mapped:
                conf2 += 1
        t += frame
    der = (fa2 + miss2 + conf2) / total2 if total2 else 0.0
    return {
        "der": round(der, 4),
        "false_alarm": round(fa2 / total2, 4) if total2 else 0.0,
        "missed": round(miss2 / total2, 4) if total2 else 0.0,
        "confusion": round(conf2 / total2, 4) if total2 else 0.0,
        "mapping": mapping,
        "collar": collar,
    }


def _speaker_mapping(ref: List[dict], hyp: List[dict], frame: float = 0.05) -> dict:
    overlap: Dict[Tuple[str, str], float] = {}
    end = max(max(s["end"] for s in ref), max((s["end"] for s in hyp), default=0.0))
    t = 0.0
    while t < end:
        r = next((s.get("speaker") for s in ref if s["start"] <= t < s["end"]), None)
        h = next((s.get("speaker") for s in hyp if s["start"] <= t < s["end"]), None)
        if r is not None and h is not None:
            overlap[(r, h)] = overlap.get((r, h), 0.0) + frame
        t += frame
    # Greedy assignment of hyp speakers to ref speakers.
    mapping: Dict[str, str] = {}
    used = set()
    for (r, h), _ in sorted(overlap.items(), key=lambda kv: -kv[1]):
        if h not in mapping and r not in used:
            mapping[h] = r
            used.add(r)
    return mapping


def score_all(ref: List[dict], hyp: List[dict]) -> dict:
    return {
        **metric_wer(ref, hyp),
        **{f"cp_{k}": v for k, v in metric_cpwer(ref, hyp).items()},
        **{f"der_{k}": v for k, v in metric_der(ref, hyp).items()},
    }


# --------------------------------------------------------------------------
# end-to-end transcription via the service
# --------------------------------------------------------------------------

def _post_multipart(url: str, audio_path: str, fields: dict) -> dict:
    import os
    import uuid

    boundary = uuid.uuid4().hex
    body = b""
    for k, v in fields.items():
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n"
        ).encode()
    with open(audio_path, "rb") as f:
        raw = f.read()
    body += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="{os.path.basename(audio_path)}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + raw + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def transcribe_and_wait(
    api: str, audio: str, num_speakers: int, tag: str = "service"
) -> dict:
    print(f"[{tag}] submitting num_speakers={num_speakers} ...")
    sub = _post_multipart(
        f"{api}/transcribe",
        audio,
        {
            "model_name": "parakeet-tdt-0.6b-v2",
            "num_speakers": str(num_speakers),
        },
    )
    job_id = sub["job_id"]
    while True:
        with urllib.request.urlopen(f"{api}/status/{job_id}", timeout=30) as resp:
            st = json.load(resp)
        print(f"[{tag}] {st['status']} {st.get('progress')} {st.get('message') or ''}")
        if st["status"] in ("completed", "failed", "canceled"):
            if st["status"] != "completed":
                raise RuntimeError(f"[{tag}] job failed: {st.get('error')}")
            return st["result"]
        time.sleep(5)


# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ref", required=True, help="reference JSON path")
    ap.add_argument("--hyp-a", help="first hypothesis JSON path (e.g. baseline)")
    ap.add_argument("--hyp-b", help="second hypothesis JSON path (e.g. candidate)")
    ap.add_argument("--audio", help="audio file for end-to-end mode")
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--num-speakers", type=int, default=2)
    args = ap.parse_args()

    ref = load_segments(args.ref)
    results = {}
    if args.audio:
        out = transcribe_and_wait(args.api, args.audio, args.num_speakers)
        results["service"] = score_all(ref, out["segments"])
    else:
        if not args.hyp_a or not args.hyp_b:
            ap.error("need --hyp-a + --hyp-b, or --audio for end-to-end mode")
        results["a"] = score_all(ref, load_segments(args.hyp_a))
        results["b"] = score_all(ref, load_segments(args.hyp_b))

    print(json.dumps(results, indent=2))
    keys = list(results)
    if len(keys) == 2:
        for metric in ("wer", "cp_cpwer", "der_der"):
            a, b = results[keys[0]].get(metric), results[keys[1]].get(metric)
            if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                print(f"{metric}: {keys[0]}={a} {keys[1]}={b} delta={round(b - a, 4)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
