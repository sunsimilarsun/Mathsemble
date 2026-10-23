# Windows: upload the release-candidate source to GitHub

The signed-in maintainer must run this locally. **Review the source before pushing. The copyright holder approved MIT on 2026-10-23 and the extracted package includes `LICENSE`.**

1. Download and unzip `Mathsemble_v0.1.9_MIT_完整开源发布工程.zip`. It contains a `Mathsemble/` folder.
2. Open PowerShell. Adjust both paths below to where the extracted files and your repository actually live.

```powershell
$source = 'D:\Downloads\Mathsemble_v0.1.9_MIT_完整开源发布工程\Mathsemble'
$repo = 'D:\Documents\git\Mathsemble'

# If you do not already have the repository:
# git clone https://github.com/sunsimilarsun/Mathsemble.git $repo

Set-Location $repo
git pull --ff-only origin main
Copy-Item -Path "$source\*" -Destination $repo -Recurse -Force
# Hidden .github must also be copied explicitly:
Copy-Item -Path "$source\.github" -Destination $repo -Recurse -Force
Copy-Item -Path "$source\.gitignore" -Destination $repo -Force

npm ci
npm run prepublish-check

git status --short
git add LICENSE README.md manifest.json main.js styles.css src package.json package-lock.json scripts tests docs .github .gitignore
git commit -m 'chore: import reviewed Mathsemble 0.1.9 source and release pipeline'
git push origin main
```

3. MIT is already approved and included. Check `LICENSE` and confirm the published GitHub repository displays the MIT license. Run `npm run prepublish-check` before tagging.
4. Check the GitHub Actions **Build and test** workflow succeeds. To publish the first GitHub release using the included workflow, push a tag **exactly** matching `manifest.json`:

```powershell
git tag 0.1.9
git push origin 0.1.9
```

5. Verify that GitHub Release `0.1.9` exists and separately contains `main.js`, `manifest.json`, and `styles.css`; compare SHA-256 with `release/SHA256SUMS.txt` if the build did not change.
6. Sign in at https://community.obsidian.md and submit the repository with your connected GitHub account.

**Note:** The source package is intentionally a conservative reconstruction. `src/main.js` is a readable, large JavaScript baseline and `npm run build` copies it unchanged. It should not be mistaken for a modularized TypeScript refactor.
