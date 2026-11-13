"""Quick checks of the site's JavaScript, run by the Tests workflow (.github/workflows/tests.yml).

1. Every `import ... from './x.js'` points to a file that exists (a deleted or renamed module would
   otherwise break the page without any error in the Python tests).
2. Every module parses (Node's syntax check, as an ES module).

Usage: python scripts/check_js.py      (needs Node.js; exits with 1 on the first kind of problem found)
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORT = re.compile(r"""^\s*import\s[^'"]*['"](\.{1,2}/[^'"]+)['"]""", re.M)


def missing_imports(files):
    problems = []
    for f in files:
        for target in IMPORT.findall(f.read_text(encoding="utf-8")):
            if not (f.parent / target).resolve().exists():
                problems.append(f"{f.relative_to(ROOT)}: imports {target}, which does not exist")
    return problems


def syntax_errors(files):
    problems = []
    for f in files:
        result = subprocess.run(["node", "--input-type=module", "--check"], input=f.read_bytes(),
                                capture_output=True)
        if result.returncode:
            problems.append(f"{f.relative_to(ROOT)}: {result.stderr.decode(errors='replace').strip().splitlines()[-1]}")
    return problems


def main():
    files = sorted((ROOT / "assets" / "js").rglob("*.js"))
    problems = missing_imports(files) + syntax_errors(files)
    for p in problems:
        print(p)
    print(f"{len(files)} JavaScript files checked, {len(problems)} problem(s).")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
