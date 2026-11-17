# Logbook (web app)

A lightweight, mobile-first logbook for climbs, hikes and trip ideas.
It reads and writes the `Logbook` folder in your own OneDrive (same files as the Mac app):

```
Logbook/
  logbook.json   all outings
  ideas.json     trip ideas
  gpx/           GPX tracks
  photos/        photos
```

No data is stored here — this repository only contains the app.

## Setup
1. Register an app at https://portal.azure.com → *App registrations* → *New registration*
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: platform **Single-page application (SPA)**, URL of this site (e.g. `https://<user>.github.io/logbook/`)
   - API permissions: Microsoft Graph → delegated → `Files.ReadWrite`
2. Paste the *Application (client) ID* into `config.js`.
3. On iPhone, open the site in Safari → Share → **Add to Home Screen**.

Try it without signing in: append `?demo` to the URL.
