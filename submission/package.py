"""Package submission files without local credentials, dependencies or exploratory outputs."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / "submission-run" / "Innodata_Track2.zip"
output.parent.mkdir(parents=True, exist_ok=True)
root_names = {
    "README.md", "Dockerfile", ".dockerignore", ".gitignore", ".gitattributes", "package.json",
    "package-lock.json", "tsconfig.json", "example.env",
}
files = [p for p in root.iterdir() if p.is_file() and (p.suffix == ".ts" or p.name in root_names)]
for directory in ("agents", "dashboard", "eval", "validate", "generator", "submission",
                  "tasks/final", "results/final", "tests", "docs"):
    files.extend(p for p in (root / directory).rglob("*")
                 if p.is_file() and "__pycache__" not in p.parts and p.name != ".env")
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, path.relative_to(root).as_posix())
print(output)
