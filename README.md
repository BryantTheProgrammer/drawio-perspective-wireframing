# draw.io + Page Explorer (Self-Hosted)

A local, self-hosted copy of [draw.io](https://www.drawio.com/) running in Docker, with:

- **Page Explorer**: a dockable sidebar for navigating, adding, renaming, duplicating, deleting, and drag-and-drop reordering of pages and sections.
- **Ignition Perspective shape library**: loaded automatically for wireframing.
- **One-click launcher**: starts Docker and opens draw.io in its own app window.

> **Note:** Use the browser version this repo serves. The plugin does **not** work in draw.io Desktop, Confluence, or Jira.

---

## Contents

| File / Folder | Purpose |
|---|---|
| `page-explorer.js` | The Page Explorer plugin |
| `loader.js` | Loads the plugin automatically for every user (added to the image at build time) |
| `libraries/` | Shape libraries (`.xml`), served at `http://localhost:8080/custom-libs/` |
| `Dockerfile` | Builds the draw.io image with the plugin and libraries |
| `docker-compose.yml` | Runs the container; mounts the plugin and libraries for live edits |
| `Launch-DrawIO.bat` | One-click launcher for Windows |

---

## Fresh Machine Setup (Windows)

### 1. Install the prerequisites

| Tool | Download | Notes |
|---|---|---|
| **Docker Desktop** | https://www.docker.com/products/docker-desktop/ | Use the default **WSL 2** option during install |
| **Git** | https://git-scm.com/download/win | Default options are fine |
| **Microsoft Edge** or **Chrome** | Usually already installed | Needed to save directly to files on disk |

After installing Docker Desktop:

1. **Restart** your computer if prompted.
2. Open **Docker Desktop** and wait until the bottom-left shows **Engine running**.
3. If it asks you to update WSL, open an **admin** terminal and run:
   ```bash
   wsl --update
   ```
4. Recommended: **Settings → General → Start Docker Desktop when you sign in**.

> **Running inside a Hyper-V VM?** The VM needs nested virtualization. On the **host**, with the VM shut down, run in admin PowerShell:
> ```powershell
> Set-VMProcessor -VMName "<VMName>" -ExposeVirtualizationExtensions $true
> ```

### 2. Clone the repo

```bash
cd C:\dev
git clone https://github.com/<org-or-user>/drawio-docker.git
cd drawio-docker
```

### 3. Build and start

```bash
docker compose up -d --build
```

The first build downloads the draw.io image and takes a few minutes. Confirm it is running:

```bash
docker ps
```

You should see a container named `drawio`.

### 4. Open draw.io

**Option A: launcher (recommended)**

Double-click `Launch-DrawIO.bat`. It will:

1. Start Docker Desktop if needed and wait for it.
2. Start the `drawio` container, or build it if it does not exist.
3. Open draw.io in its own window with the Perspective library loaded.

To make a desktop shortcut: right-click `Launch-DrawIO.bat` → **Show more options → Create shortcut**, then move the shortcut to your desktop or pin it.

**Option B: browser**

```text
http://localhost:8080/?https=0
```

> **Do not add `offline=1`** to the URL. It stops the plugin from loading.

### 5. Verify

- The **Page Explorer** panel appears on the left. If not, press **Ctrl+Shift+E**.
- The **Extras** menu has **Page Explorer** entries.
- The Perspective library shows in the shape panel. If not, use **File → Open Library from → URL** with:
  ```text
  http://localhost:8080/custom-libs/ignition-perspective.xml
  ```

---

## Using Page Explorer

### Panel

| Action | How |
|---|---|
| Show / hide | **Ctrl+Shift+E**, the **☰ Pages** tab on the left edge, or **Extras → Page Explorer** |
| Dock left / right / floating | Dock button in the panel header, or **Extras → Page Explorer: Change Dock** |
| Resize | Drag the panel's inner edge |
| Filter | Type in the search box; **Enter** opens the first match |
| Expand / collapse all | **⊞ / ⊟** in the header |
| Reset panel layout | **Extras → Page Explorer: Reset Layout** |

### Pages

| Action | How |
|---|---|
| Open | Click the page |
| Add | **+** in the header, or hover a section and click its **+** |
| Rename | Double-click the page, or hover and click **✎** |
| Duplicate | Hover and click **⧉** |
| Delete | Hover and click **🗑** |
| Reorder / move between sections | Drag the page; drop on a section header to move to the end of it |

### Sections

| Action | How |
|---|---|
| Add | **📁** in the header |
| Rename | Hover the section header and click **✎** |
| Duplicate | Hover and click **⧉** (copies all its pages) |
| Delete | Hover and click **🗑** (deletes the section **and its pages**) |
| Reorder | Drag the section header |

Most actions can be undone with **Ctrl+Z**.

---

## Saving Your Work

The browser version saves differently from draw.io Desktop. To save directly to a file on disk:

1. Use **Edge** or **Chrome**.
2. Open diagrams with **File → Open from → Device**.
3. After your first save, check the file in File Explorer and confirm its modified time changed.

> If **File → Save** downloads a new copy instead of updating your file, your work is only in the browser tab until you save it. Save often.

---

## Making Changes

`docker-compose.yml` mounts `page-explorer.js` and `libraries/` into the container, so **no rebuild is needed** for these:

| Change | What to do |
|---|---|
| Edit `page-explorer.js` | Save, then **Ctrl+F5** in draw.io |
| Add or update a library in `libraries/` | Save, then **Ctrl+F5** |
| Edit `Dockerfile` or `loader.js` | `docker compose up -d --build`, then **Ctrl+F5** |
| Change doesn't appear | `docker compose restart`, then **Ctrl+F5** |

### Adding a shape library

1. In draw.io, save the library as an `.xml` file into `libraries/`.
2. To auto-load it, add its URL to `LIB_URL` in `Launch-DrawIO.bat`, separated by `;`:
   ```bat
   set "LIB_URL=http://localhost:%PORT%/custom-libs/ignition-perspective.xml;http://localhost:%PORT%/custom-libs/other.xml"
   ```
3. Commit the `.xml` file so others get it.

---

## Updating to the Latest Repo Version

```bash
cd C:\dev\drawio-docker
git pull
docker compose up -d --build
```

Then press **Ctrl+F5** in draw.io.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `error during connect` / `cannot find the file specified` | Docker Desktop is not running. Start it and wait for **Engine running**. |
| Docker stuck on "Starting" | Tray icon → **Restart**, or reboot. Run `wsl --update` in an admin terminal. |
| Docker is in Windows containers mode | Tray icon → **Switch to Linux containers** |
| Port 8080 already in use | Change `"8080:8080"` to `"8081:8080"` in `docker-compose.yml` and `PORT=8081` in the launcher |
| Page Explorer missing | Make sure the URL has no `offline=1`; press **Ctrl+F5**; check `http://localhost:8080/plugins/page-explorer.js` loads |
| Panel closed and won't return | Click the **☰ Pages** tab, press **Ctrl+Shift+E**, or run `localStorage.removeItem('pageExplorer.state')` in the browser console (F12) and reload |
| Canvas shifted / layout broken | **Extras → Page Explorer: Reset Layout** |
| Section actions show "could not…" messages | Run **Extras → Page Explorer: Debug Page Data**, copy the console output (F12), and open an issue |

---

## Sharing on a Network

To let teammates use one server instead of running their own:

1. Run this on a shared machine or VM.
2. Allow inbound TCP **8080** in that machine's Windows Firewall.
3. Teammates open `http://<server-ip>:8080/?https=0` and use the server IP in `LIB_URL`.

---

## Notes

- **Version pinning:** the `Dockerfile` should use a specific draw.io version instead of `latest`, because the plugin uses draw.io internals that can change. Test before bumping the version.
- **Licensing:** jgraph describes the public Docker image as intended for testing and evaluation. Check with your manager or IT before relying on it for production use.
- **Plugin support:** draw.io plugins are unofficial. A draw.io update may require plugin fixes.
