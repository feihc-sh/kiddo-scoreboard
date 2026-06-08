#!/usr/bin/env python3
"""Append a failure incident to docs/INCIDENTS.md and commit+push.

Usage: python3 record_incident.py <kind>  (kind = "backup" or "deploy")
Reads GitHub env vars GITHUB_SHA, GITHUB_ACTOR, GITHUB_RUN_ID, GITHUB_REF.
"""
import os
import subprocess
import sys
from datetime import datetime, timezone

INCIDENT_FILE = "docs/INCIDENTS.md"
HEADER = """# 🚨 kiddo-scoreboard Deploy Incidents

> 每次 backup / deploy 失败, Action 会自动追加一行在这里。
> 不要删这个文件, 它是 fail-safe 信号。 看 commit history 即可追踪所有失败。

"""

TEMPLATES = {
    "backup": """## {ts} - Pre-deploy D1 backup FAILED
- **Commit**: {sha}
- **Actor**: {actor}
- **Run**: {run}
- **Branch**: {ref}
- **Action**: Deploy blocked (backup is mandatory)
- **Check**: GitHub Actions run log
- **Recovery**: `wrangler d1 export kiddo-scoreboard-db --remote --output=remote-backup/manual-$(date +%Y-%m-%d).sql`

""",
    "deploy": """## {ts} - Deploy or smoke test FAILED
- **Commit**: {sha}
- **Actor**: {actor}
- **Run**: {run}
- **Branch**: {ref}
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Recovery**: Roll back to last known good deploy via Cloudflare dashboard

""",
}


def main():
    kind = sys.argv[1]
    if kind not in TEMPLATES:
        print(f"Unknown kind: {kind}", file=sys.stderr)
        sys.exit(1)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry = TEMPLATES[kind].format(
        ts=ts,
        sha=os.environ["GITHUB_SHA"],
        actor=os.environ["GITHUB_ACTOR"],
        run=os.environ["GITHUB_RUN_ID"],
        ref=os.environ["GITHUB_REF"],
    )

    os.makedirs("docs", exist_ok=True)
    if not os.path.exists(INCIDENT_FILE):
        with open(INCIDENT_FILE, "w", encoding="utf-8") as f:
            f.write(HEADER)
    with open(INCIDENT_FILE, "a", encoding="utf-8") as f:
        f.write(entry)

    # Git commit + push
    subprocess.run(["git", "config", "user.name", "pm-bot"], check=True)
    subprocess.run(["git", "config", "user.email", "pm-bot@users.noreply.github.com"], check=True)
    subprocess.run(["git", "add", INCIDENT_FILE], check=True)

    diff_result = subprocess.run(["git", "diff", "--cached", "--quiet"])
    if diff_result.returncode == 0:
        print("No changes to INCIDENTS.md")
        return

    commit_msg = f"incident({kind}): failure at {ts} ({os.environ['GITHUB_SHA'][:7]})"
    subprocess.run(["git", "commit", "-m", commit_msg], check=True)
    subprocess.run(["git", "push"], check=True)
    print(f"✅ Incident recorded to {INCIDENT_FILE}")


if __name__ == "__main__":
    main()
