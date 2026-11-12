# Privacy policy

*Lecture Library for PoliTo* is an unofficial browser extension. This policy describes what it does with data.

## What is stored

Only on your own device, in Chrome's local extension storage (`chrome.storage.local`):

| Data | Purpose |
|---|---|
| Playback speed | Reapply your preferred speed to every lecture |
| Lecture progress: position, duration and watched flag, keyed by the portal's recording identifier | Show progress, resume playback, mark lectures as watched |
| Focus mode on/off | Reopen the page in the mode you last used |

Nothing else is stored. In particular, no names, student numbers, credentials, cookies or browsing history.

## What is sent

Nothing. The extension makes no network requests, has no analytics or telemetry, and shares no data with the developers or third parties.

## Permissions

- `storage`: to keep the data listed above.
- Content scripts on course pages of the teaching portal (`https://didattica.polito.it/pls/portal30/sviluppo.pagina_corso*`): to add the library and controls to the **Virtual classroom**. They act only when the recordings list is on the page, and they control only the lecture player. The extension is not loaded on any other page or site.

## Removing your data

Uninstalling the extension deletes everything it stored. To keep the extension and only reset progress, remove and reinstall it.

## Contact

Open an issue in this repository.
