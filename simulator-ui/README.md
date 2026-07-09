# Sanctuary Simulator UI

A standalone browser interface for running Sanctuary simulator studies locally in
the browser. It is separate from the playable game UI and reuses the existing
simulator and game-rule modules.

## GitHub Pages deployment

This repository includes a GitHub Actions workflow that builds and publishes the
simulator UI to GitHub Pages. After the workflow completes, the Pages URL appears
in the repository's **Settings → Pages** screen and in the completed deployment's
summary in the **Actions** tab.

Simulations execute locally in the user's browser through a Web Worker. GitHub
Actions is used only to build and publish the static application; it does not run
individual simulations. Generated datasets are created in the browser and
downloaded to the user's computer rather than being committed to the repository.
