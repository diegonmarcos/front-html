#!/usr/bin/env python3
"""Generate pages.json: every PUBLIC repo of the owner that publishes GitHub Pages. Nothing is typed.

Source of truth is the GitHub API, read through the `gh` CLI (env GH overrides the binary):
  users/<owner>/repos            -> the owner's public repos, kept when has_pages
  repos/<owner>/<repo>/pages     -> html_url (the URL), source {branch,path}, build_type, public

  gen-pages.py            rewrite pages.json
  gen-pages.py --check    write nothing; exit 1 when pages.json differs from the API (drift)

The output is deterministic (sorted by repo, no timestamp), so a diff means the API changed.
Cloud Browser (Favourites > GH Pages) reads this file at runtime from raw.githubusercontent.com.
"""
import json, os, subprocess, sys

OWNER = os.environ.get("PAGES_OWNER", "diegonmarcos")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pages.json")
GH = os.environ.get("GH", "gh")


def api(path, paginate=False):
    cmd = [GH, "api", path] + (["--paginate"] if paginate else [])
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    if paginate:   # gh prints one JSON array per page
        dec, i, rows = json.JSONDecoder(), 0, []
        while i < len(out):
            if out[i].isspace():
                i += 1
                continue
            page, i = dec.raw_decode(out, i)
            rows += page
        return rows
    return json.loads(out)


def derive():
    pages = []
    for r in api("users/%s/repos?per_page=100&type=owner" % OWNER, paginate=True):
        if r.get("private") or not r.get("has_pages"):
            continue
        try:
            p = api("repos/%s/%s/pages" % (OWNER, r["name"]))
        except subprocess.CalledProcessError:
            continue   # has_pages but the site is gone or not readable: not a link worth listing
        if not p.get("public") or not p.get("html_url", "").startswith("https://"):
            continue
        pages.append({"repo": r["name"], "url": p["html_url"],
                      "source": {"branch": (p.get("source") or {}).get("branch"), "path": (p.get("source") or {}).get("path"),
                                 "build_type": p.get("build_type")},
                      "public": True})
    pages.sort(key=lambda x: x["repo"].lower())
    return {"_generated": "DO NOT EDIT: scripts/gen-pages.py derives this from the GitHub API", "owner": OWNER, "pages": pages}


def main(argv):
    text = json.dumps(derive(), indent=2, ensure_ascii=False) + "\n"
    if "--check" in argv:
        have = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if have != text:
            sys.stderr.write("pages.json drifted from the GitHub API: run scripts/gen-pages.py and commit\n")
            return 1
        print("pages.json up to date")
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote %s" % os.path.normpath(OUT))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
