# Changelog

## 1.1.0

- The settings page now uses the declarative settings API of Obsidian 1.13, so the settings show up in the Obsidian settings search. This raises the minimum Obsidian version to 1.13.0. Older versions stay on 1.0.3.

## 1.0.3

- Cleaner code for the automated review: typed forces and no `any` in the layout code, fewer unnecessary type assertions, promises handled explicitly in the settings.
- Release files are now built by a GitHub Actions workflow and carry an artifact attestation, so everyone can verify that they come from this repository.

## 1.0.2

- Fixes from the automated review: minimum Obsidian version is now 1.8.7 (revealLeaf, local storage API), the graph view is no longer detached when the plugin unloads, the settings heading uses the Setting API, inline styles replaced by CSS classes, and smaller code cleanups.
- The remembered view state is now stored with the Obsidian local storage API.

## 1.0.1

- The plugin id is now `stellar-graph` to follow the manifest rules (lowercase letters and hyphens only). Folder name for manual installs: `stellar-graph`.

## 1.0.0

First public version.

- 3D galaxy view of the vault graph with glow, star dust, folder nebulae, comets along links and shooting stars
- Search, fly-to, focus mode, hover cards, minimap, clickable legend with custom folder colors
- Time travel (by creation order), age colors, expansion layout, rotating spiral with tilt and spin sliders
- Route between two notes, tag constellations, cinema mode, photo and video recording
- Dark matter (links to missing notes), moons (open tasks), planets (attachments), black holes with gravitational lensing
- Live updates, remembered view, settings page, English and German interface
- Optional ambient sound, performance mode and automatic throttling
