---
description: "Deploy the app to GitHub Pages — git add, commit, push to upstream main"
agent: "agent"
tools: [terminal]
---

Deploy the project to GitHub Pages by running these commands in the terminal:

```
cd c:\moje\stabledifiuson
git add -A
git commit -m "${input:Commit message}"
git push upstream main
```

After pushing, confirm the push succeeded. The site will be live at https://siven-samuel.github.io/stabledifiusion/ after ~90s (GitHub Actions builds and deploys automatically).
